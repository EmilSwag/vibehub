import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { ACHIEVEMENT_TITLES, isAchievementId, type AchievementId } from "./achievements";
import { HttpError } from "./http-error";
import { normalizeModel } from "./sessions";

// Vibe Feed — posts-only feed (meta/plans/vibehub-round21-feed-posts-polish.md).
//
// People's posts only: compose on Home and Profile, friends as followers, algorithmic
// recommendations (~1 in 4, suggested), likes (heart), reactions (respect, flame),
// unique on-screen views, delete own post.
// Existing event sources (sessions, achievements, projects) are preserved for profile/stats
// data, but the feed surfaces exclusively posts written by people.

export const FEED_EVENT_TYPES = ["post", "session", "achievement", "project", "commits", "friendship"] as const;
export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];

export const REACTION_KINDS = ["like", "respect", "flame"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** A reaction target is an event id: `<type>:<key>` with a bounded, URL-safe key. */
export const REACTION_TARGET_RE = /^(post|session|achievement|project|commits|friendship):[A-Za-z0-9:_-]{1,120}$/;
export const isReactionTarget = (value: unknown): value is string =>
  typeof value === "string" && REACTION_TARGET_RE.test(value);

// Window, cap and thresholds — the contract constants.
export const FEED_WINDOW_DAYS = 30;
export const FEED_CAP = 200;
export const FEED_DEFAULT_LIMIT = 30;
export const FEED_MAX_LIMIT = 100;
export const FEED_MIN_SESSION_SECONDS = 600;
export const PROJECT_UPDATE_GAP_MS = 3_600_000;

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).default(FEED_DEFAULT_LIMIT),
  /** ISO instant; only events strictly older than it are returned. */
  before: z.string().datetime({ offset: true }).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const feedReactionSchema = z.object({
  target: z.string().regex(REACTION_TARGET_RE, "target must be <post|session|achievement|project|commits|friendship>:<key>"),
  kind: z.enum(REACTION_KINDS),
});

// ---- wire shapes ----

export interface FeedUser {
  id?: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface FeedReactionSummary {
  like: number;
  respect: number;
  flame: number;
  mine: { like: boolean; respect: boolean; flame: boolean };
}

/** An event before its reactions are folded in. */
export interface FeedEventCore {
  id: string;
  type: FeedEventType;
  at: string;
  live?: true;
  user: FeedUser;
  other?: FeedUser;
  title: string;
  content?: string;
  description: string | null;
  suggested?: boolean;
  views?: number;
  canDelete?: boolean;
  badgeId?: AchievementId;
  projectId?: string;
}

export interface FeedEvent extends FeedEventCore {
  reactions: FeedReactionSummary;
  views: number;
}

// ---- Algorithmic recommendation ranking ----

/**
 * Ranks candidate recommended posts.
 * Score combines engagement (likes * 3 + reactions * 2 + views * 0.5 + 1),
 * exponential recency decay (1 / (1 + ageHours / 24)^1.5),
 * plus a small random jitter (+-10%) so the feed varies on refresh.
 */
export function scoreRecommendedPost(
  post: {
    likes: number;
    reactions: number;
    views: number;
    createdAt: Date;
  },
  now = Date.now(),
  jitter = Math.random()
): number {
  const ageHours = Math.max(0, (now - post.createdAt.getTime()) / 3_600_000);
  const engagement = post.likes * 3 + post.reactions * 2 + post.views * 0.5 + 1;
  const recencyDecay = 1 / Math.pow(1 + ageHours / 24, 1.5);
  const randomFactor = 0.9 + jitter * 0.2; // 0.9 to 1.1 (+-10% jitter)
  return engagement * recencyDecay * randomFactor;
}

/**
 * Mixes recommended posts into connected posts at approximately 1 in 4.
 * Guarantees no duplicates within a page, preserves connected ordering, and places
 * suggested posts at positions 3, 7, 11, ... (0-indexed). If connected posts run out,
 * remaining recommended posts append to avoid an empty feed.
 */
export function interleaveRecommended<T extends { id: string }>(
  connected: readonly T[],
  recommended: readonly T[],
  limit: number
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  let cIdx = 0;
  let rIdx = 0;

  while (result.length < limit && (cIdx < connected.length || rIdx < recommended.length)) {
    // Every 4th item (indices 3, 7, 11, ...) takes from recommended if available
    const wantRecommended = result.length % 4 === 3 && rIdx < recommended.length;
    if (wantRecommended || cIdx >= connected.length) {
      while (rIdx < recommended.length && seen.has(recommended[rIdx].id)) {
        rIdx++;
      }
      if (rIdx < recommended.length) {
        const item = recommended[rIdx++];
        seen.add(item.id);
        result.push(item);
        continue;
      }
    }

    while (cIdx < connected.length && seen.has(connected[cIdx].id)) {
      cIdx++;
    }
    if (cIdx < connected.length) {
      const item = connected[cIdx++];
      seen.add(item.id);
      result.push(item);
    } else if (rIdx < recommended.length) {
      while (rIdx < recommended.length && seen.has(recommended[rIdx].id)) {
        rIdx++;
      }
      if (rIdx < recommended.length) {
        const item = recommended[rIdx++];
        seen.add(item.id);
        result.push(item);
      }
    }
  }

  return result;
}

// ---- reactions and views fold ----

const USER_SELECT = { id: true, username: true, displayName: true, avatarUrl: true } as const;

// In-memory unique views tracking for projects: Map<projectId, Set<viewerKey>>
const projectViewsMap = new Map<string, Set<string>>();

export interface ReactionCountRow {
  target: string;
  kind: string;
  count: number;
}
export interface ReactionMineRow {
  target: string;
  kind: string;
}

/** Attach counts (one groupBy row per target × kind) and the viewer's own toggles. */
export function foldReactions(
  events: readonly FeedEventCore[],
  counts: readonly ReactionCountRow[],
  mine: readonly ReactionMineRow[]
): FeedEvent[] {
  const summary = new Map<string, FeedReactionSummary>();
  const of = (target: string): FeedReactionSummary => {
    let s = summary.get(target);
    if (!s) {
      s = { like: 0, respect: 0, flame: 0, mine: { like: false, respect: false, flame: false } };
      summary.set(target, s);
    }
    return s;
  };
  const isKind = (kind: string): kind is ReactionKind => (REACTION_KINDS as readonly string[]).includes(kind);
  for (const row of counts) if (isKind(row.kind)) of(row.target)[row.kind] = Math.max(0, row.count);
  for (const row of mine) if (isKind(row.kind)) of(row.target).mine[row.kind] = true;
  return events.map((event) => ({
    ...event,
    views: event.views ?? 0,
    reactions: of(event.id),
  }));
}

/** Attach unique view counts and folded reactions in single batch queries. */
export async function attachViewsAndReactions(
  events: readonly FeedEventCore[],
  viewerId: string | null
): Promise<FeedEvent[]> {
  if (events.length === 0) return [];
  const targets = events.map((e) => e.id);
  const postIds = events
    .filter((e) => e.type === "post")
    .map((e) => (e.id.startsWith("post:") ? e.id.slice(5) : e.id));
  const projectIds = events
    .filter((e) => e.type === "project")
    .map((e) => (e.id.startsWith("project:") ? e.id.slice(8) : e.id));

  const [counts, mine, viewCounts, projectLikes, projectRows] = await Promise.all([
    prisma.feedReaction.groupBy({
      by: ["target", "kind"],
      where: { target: { in: targets } },
      _count: { _all: true },
    }),
    viewerId
      ? prisma.feedReaction.findMany({
          where: { userId: viewerId, target: { in: targets } },
          select: { target: true, kind: true },
        })
      : Promise.resolve([]),
    postIds.length > 0
      ? prisma.postView.groupBy({
          by: ["postId"],
          where: { postId: { in: postIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    viewerId && projectIds.length > 0
      ? prisma.like.findMany({
          where: { userId: viewerId, projectId: { in: projectIds } },
          select: { projectId: true },
        })
      : Promise.resolve([]),
    projectIds.length > 0
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, likeCount: true },
        })
      : Promise.resolve([]),
  ]);

  const viewMap = new Map<string, number>();
  for (const v of viewCounts) {
    viewMap.set(v.postId, v._count._all);
  }

  const projectLikeCountMap = new Map<string, number>();
  for (const p of projectRows) {
    projectLikeCountMap.set(p.id, p.likeCount);
  }
  const userLikedProjects = new Set(projectLikes.map((l) => l.projectId));

  const withViews: FeedEventCore[] = events.map((e) => {
    let views = e.views ?? 0;
    if (e.type === "post") {
      const rawId = e.id.startsWith("post:") ? e.id.slice(5) : e.id;
      views = viewMap.get(rawId) ?? views;
    } else if (e.type === "project") {
      const rawId = e.id.startsWith("project:") ? e.id.slice(8) : e.id;
      views = projectViewsMap.get(rawId)?.size ?? views;
    }
    return { ...e, views };
  });

  const folded = foldReactions(
    withViews,
    counts.map((row) => ({ target: row.target, kind: row.kind, count: row._count._all })),
    mine
  );

  return folded.map((ev) => {
    if (ev.type === "project") {
      const rawId = ev.id.startsWith("project:") ? ev.id.slice(8) : ev.id;
      const baseLikes = projectLikeCountMap.get(rawId) ?? 0;
      const alreadyLiked = userLikedProjects.has(rawId);
      return {
        ...ev,
        reactions: {
          ...ev.reactions,
          like: ev.reactions.like + baseLikes,
          mine: {
            ...ev.reactions.mine,
            like: ev.reactions.mine.like || alreadyLiked,
          },
        },
      };
    }
    return ev;
  });
}

// ---- Post operations (CRUD, view) ----

export async function createPost(authorId: string, content: string): Promise<FeedEvent> {
  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  });
  if (!author) throw new HttpError(404, "User not found");

  const post = await prisma.post.create({
    data: {
      authorId,
      content,
    },
  });

  return {
    id: `post:${post.id}`,
    type: "post",
    at: post.createdAt.toISOString(),
    user: author,
    title: post.content,
    content: post.content,
    description: null,
    suggested: false,
    views: 0,
    canDelete: true,
    reactions: {
      like: 0,
      respect: 0,
      flame: 0,
      mine: { like: false, respect: false, flame: false },
    },
  };
}

export async function deletePost(postId: string, userId: string): Promise<void> {
  const rawId = postId.startsWith("project:")
    ? postId.slice(8)
    : postId.startsWith("post:")
    ? postId.slice(5)
    : postId;

  // Try post
  const post = await prisma.post.findUnique({
    where: { id: rawId },
    select: { authorId: true },
  });
  if (post) {
    if (post.authorId !== userId) {
      throw new HttpError(403, "You can only delete your own posts");
    }
    await prisma.feedReaction.deleteMany({ where: { target: `post:${rawId}` } });
    await prisma.post.delete({ where: { id: rawId } });
    return;
  }

  // Try project
  const project = await prisma.project.findUnique({
    where: { id: rawId },
    select: { ownerId: true },
  });
  if (project) {
    if (project.ownerId !== userId) {
      throw new HttpError(403, "You can only delete your own posts");
    }
    await prisma.feedReaction.deleteMany({ where: { target: `project:${rawId}` } });
    await prisma.project.delete({ where: { id: rawId } });
    return;
  }

  throw new HttpError(404, "Post not found");
}

export async function recordPostView(
  postId: string,
  viewerId: string | null,
  viewerKey: string
): Promise<{ postId: string; views: number }> {
  const rawId = postId.startsWith("project:")
    ? postId.slice(8)
    : postId.startsWith("post:")
    ? postId.slice(5)
    : postId;

  // 1. Try post
  const post = await prisma.post.findUnique({
    where: { id: rawId },
    select: { id: true, authorId: true },
  });

  if (post) {
    // Never count the author's own views
    if (viewerId && viewerId === post.authorId) {
      const views = await prisma.postView.count({ where: { postId: post.id } });
      return { postId: rawId, views };
    }

    await prisma.postView
      .create({
        data: {
          postId: post.id,
          userId: viewerId,
          viewerKey,
        },
      })
      .catch((err: unknown) => {
        if ((err as { code?: string }).code !== "P2002") throw err;
      });

    const views = await prisma.postView.count({ where: { postId: post.id } });
    return { postId: rawId, views };
  }

  // 2. Try project
  const project = await prisma.project.findUnique({
    where: { id: rawId },
    select: { id: true, ownerId: true },
  });

  if (project) {
    if (viewerId && viewerId === project.ownerId) {
      const views = projectViewsMap.get(project.id)?.size ?? 0;
      return { postId: rawId, views };
    }

    let set = projectViewsMap.get(project.id);
    if (!set) {
      set = new Set<string>();
      projectViewsMap.set(project.id, set);
    }
    set.add(viewerKey);
    return { postId: rawId, views: set.size };
  }

  throw new HttpError(404, "Post not found");
}

// ---- Feed listing ----

/** Home feed: mine + friends' posts/projects + recommended posts/projects from others (~1 in 4). */
export async function listFeed(
  connectedUserIds: readonly string[],
  viewerId: string | null,
  query: FeedQuery
): Promise<{ events: FeedEvent[]; nextBefore: string | null }> {
  const limit = query.limit;
  const beforeDate = query.before ? new Date(query.before) : null;

  // 1. Fetch connected posts and public projects (mine + friends)
  const connectedPostWhere: Record<string, unknown> = {
    authorId: { in: [...connectedUserIds] },
  };
  const connectedProjectWhere: Record<string, unknown> = {
    ownerId: { in: [...connectedUserIds] },
    isPublic: true,
  };
  if (beforeDate) {
    connectedPostWhere.createdAt = { lt: beforeDate };
    connectedProjectWhere.createdAt = { lt: beforeDate };
  }

  const [connectedPosts, connectedProjects] = await Promise.all([
    prisma.post.findMany({
      where: connectedPostWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        author: { select: USER_SELECT },
      },
    }),
    prisma.project.findMany({
      where: connectedProjectWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        owner: { select: USER_SELECT },
      },
    }),
  ]);

  const toPostCore = (p: typeof connectedPosts[0], suggested = false): FeedEventCore => ({
    id: `post:${p.id}`,
    type: "post",
    at: p.createdAt.toISOString(),
    user: {
      id: p.author.id,
      username: p.author.username,
      displayName: p.author.displayName,
      avatarUrl: p.author.avatarUrl,
    },
    title: p.content,
    content: p.content,
    description: null,
    suggested,
    views: 0,
    canDelete: viewerId === p.authorId,
  });

  const toProjectCore = (p: typeof connectedProjects[0], suggested = false): FeedEventCore => ({
    id: `project:${p.id}`,
    type: "project",
    at: p.createdAt.toISOString(),
    user: {
      id: p.owner.id,
      username: p.owner.username,
      displayName: p.owner.displayName,
      avatarUrl: p.owner.avatarUrl,
    },
    title: p.name,
    content: p.description ?? "",
    description: p.description,
    projectId: p.id,
    suggested,
    views: 0,
    canDelete: viewerId === p.ownerId,
  });

  const allConnectedCores: FeedEventCore[] = [
    ...connectedPosts.map((p) => toPostCore(p, false)),
    ...connectedProjects.map((p) => toProjectCore(p, false)),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  // 2. Fetch candidate recommended posts and projects from others (skip connected, skip self)
  const recommendedPostWhere: Record<string, unknown> = {
    authorId: { notIn: [...connectedUserIds] },
  };
  const recommendedProjectWhere: Record<string, unknown> = {
    ownerId: { notIn: [...connectedUserIds] },
    isPublic: true,
  };
  if (beforeDate) {
    recommendedPostWhere.createdAt = { lt: beforeDate };
    recommendedProjectWhere.createdAt = { lt: beforeDate };
  }

  const [candidatePosts, candidateProjects] = await Promise.all([
    prisma.post.findMany({
      where: recommendedPostWhere,
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        author: { select: USER_SELECT },
        views: { select: { id: true } },
      },
    }),
    prisma.project.findMany({
      where: recommendedProjectWhere,
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        owner: { select: USER_SELECT },
      },
    }),
  ]);

  // Score candidate recommended posts and projects
  type ScoredCore = FeedEventCore & { score: number };
  let scoredRecommended: ScoredCore[] = [];

  const candidateTargets = [
    ...candidatePosts.map((p) => `post:${p.id}`),
    ...candidateProjects.map((p) => `project:${p.id}`),
  ];

  if (candidateTargets.length > 0) {
    const reactionCounts = await prisma.feedReaction.groupBy({
      by: ["target", "kind"],
      where: { target: { in: candidateTargets } },
      _count: { _all: true },
    });

    const reactionMap = new Map<string, { likes: number; reactions: number }>();
    for (const r of reactionCounts) {
      const cur = reactionMap.get(r.target) ?? { likes: 0, reactions: 0 };
      if (r.kind === "like") cur.likes += r._count._all;
      else cur.reactions += r._count._all;
      reactionMap.set(r.target, cur);
    }

    const now = Date.now();

    const scoredPosts: ScoredCore[] = candidatePosts.map((p) => {
      const r = reactionMap.get(`post:${p.id}`) ?? { likes: 0, reactions: 0 };
      const views = p.views.length;
      const score = scoreRecommendedPost(
        { likes: r.likes, reactions: r.reactions, views, createdAt: p.createdAt },
        now
      );
      return { ...toPostCore(p, true), score };
    });

    const scoredProjects: ScoredCore[] = candidateProjects.map((p) => {
      const r = reactionMap.get(`project:${p.id}`) ?? { likes: 0, reactions: 0 };
      const views = projectViewsMap.get(p.id)?.size ?? 0;
      const totalLikes = r.likes + p.likeCount;
      const score = scoreRecommendedPost(
        { likes: totalLikes, reactions: r.reactions, views, createdAt: p.createdAt },
        now
      );
      return { ...toProjectCore(p, true), score };
    });

    scoredRecommended = [...scoredPosts, ...scoredProjects].sort((a, b) => b.score - a.score);
  }

  // Interleave recommended posts (~1 in 4)
  const interleaved = interleaveRecommended(allConnectedCores, scoredRecommended, limit);

  // Attach views and reactions
  const events = await attachViewsAndReactions(interleaved, viewerId);

  // Determine nextBefore cursor from the last item
  const nextBefore = events.length >= limit ? events[events.length - 1].at : null;

  return { events, nextBefore };
}

/** Profile feed: that user's own posts and projects only. */
export async function listUserPosts(
  username: string,
  viewerId: string | null,
  query: FeedQuery
): Promise<{ events: FeedEvent[]; nextBefore: string | null }> {
  const user = await prisma.user.findUnique({
    where: { username },
    select: USER_SELECT,
  });
  if (!user) throw new HttpError(404, "User not found");

  const limit = query.limit;
  const beforeDate = query.before ? new Date(query.before) : null;

  const postWhere: Record<string, unknown> = { authorId: user.id };
  const projectWhere: Record<string, unknown> = {
    ownerId: user.id,
    ...(viewerId === user.id ? {} : { isPublic: true }),
  };
  if (beforeDate) {
    postWhere.createdAt = { lt: beforeDate };
    projectWhere.createdAt = { lt: beforeDate };
  }

  const [posts, projects] = await Promise.all([
    prisma.post.findMany({
      where: postWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.project.findMany({
      where: projectWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const postCores: FeedEventCore[] = posts.map((p) => ({
    id: `post:${p.id}`,
    type: "post",
    at: p.createdAt.toISOString(),
    user,
    title: p.content,
    content: p.content,
    description: null,
    suggested: false,
    views: 0,
    canDelete: viewerId === user.id,
  }));

  const projectCores: FeedEventCore[] = projects.map((p) => ({
    id: `project:${p.id}`,
    type: "project",
    at: p.createdAt.toISOString(),
    user,
    title: p.name,
    content: p.description ?? "",
    description: p.description,
    projectId: p.id,
    suggested: false,
    views: 0,
    canDelete: viewerId === user.id,
  }));

  const allCores = [...postCores, ...projectCores]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  const events = await attachViewsAndReactions(allCores, viewerId);
  const nextBefore = events.length >= limit ? events[events.length - 1].at : null;

  return { events, nextBefore };
}

/** Toggle one (viewer, target, kind); returns the new state and the target's live count. */
export async function toggleReaction(
  userId: string,
  target: string,
  kind: ReactionKind
): Promise<{ target: string; kind: ReactionKind; active: boolean; count: number }> {
  const where = { userId_target_kind: { userId, target, kind } };
  const existing = await prisma.feedReaction.findUnique({ where, select: { id: true } });
  let active: boolean;
  if (existing) {
    await prisma.feedReaction.deleteMany({ where: { id: existing.id } });
    active = false;
  } else {
    // Two fast taps race the unique index; the second create is the same "on" state.
    await prisma.feedReaction.create({ data: { userId, target, kind } }).catch((err: unknown) => {
      if ((err as { code?: string }).code !== "P2002") throw err;
    });
    active = true;
  }
  let count = await prisma.feedReaction.count({ where: { target, kind } });
  if (target.startsWith("project:") && kind === "like") {
    const rawProjectId = target.slice(8);
    const proj = await prisma.project.findUnique({ where: { id: rawProjectId }, select: { likeCount: true } });
    if (proj) count += proj.likeCount;
  }
  return { target, kind, active, count };
}

// ---- Backward-compatible helpers & row types (used by existing checks) ----

export interface FeedSessionRow {
  id: string;
  userId: string;
  projectAlias: string;
  tool: string;
  model: string | null;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  lastHeartbeatAt: Date;
}
export interface FeedAchievementRow {
  userId: string;
  achievementId: string;
  unlockedAt: Date;
}
export interface FeedProjectRow {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface FeedCommitDayRow {
  userId: string;
  date: Date;
  commitCount: number;
}
export interface FeedFriendshipRow {
  id: string;
  userAId: string;
  userBId: string;
  since: Date;
}
export interface FeedRows {
  users: ReadonlyMap<string, FeedUser>;
  sessions: readonly FeedSessionRow[];
  achievements: readonly FeedAchievementRow[];
  projects: readonly FeedProjectRow[];
  commitDays: readonly FeedCommitDayRow[];
  friendships: readonly FeedFriendshipRow[];
}
export interface FeedScope {
  userIds: readonly string[];
  now: Date;
  idleTimeoutMs: number;
}

const TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Windsurf",
  zed: "Zed",
  quadcode: "Quadcode AI",
  chatgpt: "ChatGPT",
  grok: "Grok",
};
const CLAUDE_FAMILIES = new Set(["fable", "opus", "sonnet", "haiku", "instant"]);
const capWord = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const titleCase = (id: string): string => id.split(/[-_\s]+/).filter(Boolean).map(capWord).join(" ");
const isDateish = (t: string): boolean => /^\d{2,}$/.test(t);

export function toolLabel(tool: string): string {
  const id = tool.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!id || id === "unknown") return "Unknown tool";
  return TOOL_LABELS[id] ?? titleCase(id);
}

function humanizeClaude(id: string): string {
  let family: string | null = null;
  const version: string[] = [];
  const extras: string[] = [];
  for (const t of id.split(/[-_.]/).filter(Boolean)) {
    if (t === "claude" || t === "latest") continue;
    if (CLAUDE_FAMILIES.has(t)) {
      family = t;
      continue;
    }
    if (/^\d+$/.test(t)) {
      if (t.length <= 2 && version.length < 2) version.push(t);
      continue;
    }
    extras.push(capWord(t));
  }
  return ["Claude", family && capWord(family), version.length ? version.join(".") : null, ...extras]
    .filter(Boolean)
    .join(" ");
}

function humanizeOpenAI(id: string): string {
  if (/^o\d/.test(id)) return id;
  const isChat = id.startsWith("chatgpt");
  const [version, ...tail] = id.replace(/^(?:chat)?gpt-?/, "").split(/[-_]/).filter(Boolean);
  const prefix = isChat ? "ChatGPT" : "GPT";
  if (!version) return prefix;
  const words = tail.filter((t) => t !== "latest" && !isDateish(t)).map(capWord);
  return [`${prefix}-${version}`, ...words].join(" ");
}

function humanizeBranded(brand: string, key: string, id: string): string {
  const words = id
    .split(/[-_]/)
    .filter((t) => t && t !== key && t !== "latest" && !isDateish(t))
    .map(capWord);
  return [brand, ...words].join(" ");
}

export function modelLabel(model: string | null | undefined): string | null {
  const id = (normalizeModel(model) ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/^(?:[a-z0-9_.-]+\/)+/, "")
    .replace(/^(?:[a-z]+\.)*anthropic\./, "")
    .replace(/\[\d+[mk]\]$/, "")
    .replace(/-v\d+(?::\d+)?$/, "")
    .replace(/@\d{6,}$/, "");
  if (!id) return null;
  if (id.includes("claude") || /^(fable|opus|sonnet|haiku)(?![a-z])/.test(id)) return humanizeClaude(id);
  if (id.includes("gpt") || /^o\d/.test(id)) return humanizeOpenAI(id);
  if (id.includes("gemini")) return humanizeBranded("Gemini", "gemini", id);
  if (id.includes("grok")) return humanizeBranded("Grok", "grok", id);
  return titleCase(id);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const ymd = (date: Date): string => date.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

export function buildFeedEvents(rows: FeedRows, scope: FeedScope): FeedEventCore[] {
  const inScope = new Set(scope.userIds);
  const now = scope.now.getTime();
  const since = now - FEED_WINDOW_DAYS * DAY_MS;
  const events = new Map<string, FeedEventCore>();
  const push = (event: FeedEventCore) => {
    if (Date.parse(event.at) < since) return;
    if (!events.has(event.id)) events.set(event.id, event);
  };
  const userOf = (id: string): FeedUser | null => (inScope.has(id) ? rows.users.get(id) ?? null : null);

  for (const s of rows.sessions) {
    const user = userOf(s.userId);
    if (!user) continue;
    const live = s.status !== "ENDED" && now - s.lastHeartbeatAt.getTime() <= scope.idleTimeoutMs;
    const end = live ? s.lastHeartbeatAt : s.endedAt ?? s.lastHeartbeatAt;
    const seconds = Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 1000));
    if (!live && seconds < FEED_MIN_SESSION_SECONDS) continue;
    const model = modelLabel(s.model);
    const alias = s.projectAlias.trim();
    const where = alias && alias.toLowerCase() !== "unknown" ? ` in ${alias}` : "";
    push({
      id: `session:${s.id}`,
      type: "session",
      at: end.toISOString(),
      ...(live ? { live: true } : {}),
      user,
      title: live ? `Coding${where || " now"}` : `Coded ${formatDuration(seconds)}${where}`,
      description: model ? `${toolLabel(s.tool)} · ${model}` : toolLabel(s.tool),
    });
  }

  for (const a of rows.achievements) {
    const user = userOf(a.userId);
    if (!user || !isAchievementId(a.achievementId)) continue;
    push({
      id: `achievement:${a.userId}:${a.achievementId}`,
      type: "achievement",
      at: a.unlockedAt.toISOString(),
      user,
      title: `Unlocked ${ACHIEVEMENT_TITLES[a.achievementId]}`,
      description: null,
      badgeId: a.achievementId,
    });
  }

  for (const p of rows.projects) {
    const user = userOf(p.ownerId);
    if (!user) continue;
    push({
      id: `project:${p.id}:new`,
      type: "project",
      at: p.createdAt.toISOString(),
      user,
      title: `New project: ${p.name}`,
      description: p.description,
      projectId: p.id,
    });
    if (p.updatedAt.getTime() - p.createdAt.getTime() > PROJECT_UPDATE_GAP_MS) {
      push({
        id: `project:${p.id}:upd:${ymd(p.updatedAt)}`,
        type: "project",
        at: p.updatedAt.toISOString(),
        user,
        title: `Updated ${p.name}`,
        description: p.description,
        projectId: p.id,
      });
    }
  }

  for (const c of rows.commitDays) {
    const user = userOf(c.userId);
    if (!user || c.commitCount <= 0) continue;
    push({
      id: `commits:${c.userId}:${ymd(c.date)}`,
      type: "commits",
      at: c.date.toISOString(),
      user,
      title: `Pushed ${c.commitCount} commit${c.commitCount === 1 ? "" : "s"}`,
      description: null,
    });
  }

  for (const f of rows.friendships) {
    const [userId, otherId] = inScope.has(f.userAId) ? [f.userAId, f.userBId] : [f.userBId, f.userAId];
    const user = userOf(userId);
    const other = rows.users.get(otherId);
    if (!user || !other) continue;
    push({
      id: `friendship:${f.id}`,
      type: "friendship",
      at: f.since.toISOString(),
      user,
      other,
      title: "became friends",
      description: null,
    });
  }

  return [...events.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, FEED_CAP);
}

export function pageEvents<T extends { at: string }>(
  events: readonly T[],
  limit: number,
  before: Date | null = null
): { events: T[]; nextBefore: string | null } {
  const cutoff = before ? before.getTime() : Number.POSITIVE_INFINITY;
  const older = before ? events.filter((e) => Date.parse(e.at) < cutoff) : [...events];
  let end = Math.min(Math.max(0, limit), older.length);
  while (end > 0 && end < older.length && older[end].at === older[end - 1].at) end += 1;
  const page = older.slice(0, end);
  return { events: page, nextBefore: older.length > page.length ? page[page.length - 1].at : null };
}

export async function loadFeedRows(userIds: readonly string[], since: Date): Promise<FeedRows> {
  const ids = [...userIds];
  const [scopeUsers, sessions, achievements, projects, commitDays, friendships] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: USER_SELECT }),
    prisma.session.findMany({
      where: { userId: { in: ids }, lastHeartbeatAt: { gte: since } },
      select: {
        id: true,
        userId: true,
        projectAlias: true,
        tool: true,
        model: true,
        status: true,
        startedAt: true,
        endedAt: true,
        lastHeartbeatAt: true,
      },
    }),
    prisma.userAchievement.findMany({
      where: { userId: { in: ids }, unlockedAt: { gte: since } },
      select: { userId: true, achievementId: true, unlockedAt: true },
    }),
    prisma.project.findMany({
      where: { ownerId: { in: ids }, isPublic: true, updatedAt: { gte: since } },
      select: { id: true, ownerId: true, name: true, description: true, createdAt: true, updatedAt: true },
    }),
    prisma.githubCommitDay.findMany({
      where: { userId: { in: ids }, date: { gte: since }, commitCount: { gt: 0 } },
      select: { userId: true, date: true, commitCount: true },
    }),
    prisma.friendship.findMany({
      where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }], since: { gte: since } },
      select: { id: true, userAId: true, userBId: true, since: true },
    }),
  ]);

  const users = new Map<string, FeedUser>();
  for (const u of scopeUsers) users.set(u.id, { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl });
  const missing = new Set<string>();
  for (const f of friendships) for (const id of [f.userAId, f.userBId]) if (!users.has(id)) missing.add(id);
  if (missing.size > 0) {
    const others = await prisma.user.findMany({ where: { id: { in: [...missing] } }, select: USER_SELECT });
    for (const u of others) users.set(u.id, { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl });
  }

  return { users, sessions, achievements, projects, commitDays, friendships };
}
