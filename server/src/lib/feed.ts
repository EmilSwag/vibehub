import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { ACHIEVEMENT_TITLES, isAchievementId, type AchievementId } from "./achievements";
import { normalizeModel } from "./sessions";

// Vibe Feed — meta/plans/vibehub-honest-achievements-feed.md, "Contract" → REST.
//
// Real events of self + friends, each backed by a row: finished sessions (Session),
// badge unlocks (UserAchievement), new / updated projects (Project), GitHub commit days
// (GithubCommitDay) and new friendships (Friendship). No event type exists that a row
// cannot back — the web used to ship hard-coded fixtures ("Phil Mac unlocked Opus
// Tamer", "12m ago") on a public site, and this replaces them.
//
// Every event has a stable `id` that doubles as its reaction target, so a reaction
// survives reloads and is visible from any account (FeedReaction rows, folded in with
// one groupBy). The shaping (`buildFeedEvents`, `pageEvents`, `foldReactions`) is pure
// so lib/__checks__/feed.check.ts pins ids, thresholds, ordering and paging without a
// database; `listFeed` / `toggleReaction` are the Prisma-touching entry points.

export const FEED_EVENT_TYPES = ["session", "achievement", "project", "commits", "friendship"] as const;
export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];

export const REACTION_KINDS = ["respect", "flame"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** A reaction target is an event id: `<type>:<key>` with a bounded, URL-safe key. */
export const REACTION_TARGET_RE = /^(session|achievement|project|commits|friendship):[A-Za-z0-9:_-]{1,120}$/;
export const isReactionTarget = (value: unknown): value is string =>
  typeof value === "string" && REACTION_TARGET_RE.test(value);

// Window, cap and thresholds — the contract, as constants so the check pins the same numbers.
export const FEED_WINDOW_DAYS = 30;
export const FEED_CAP = 200;
export const FEED_DEFAULT_LIMIT = 30;
export const FEED_MAX_LIMIT = 100;
/** A finished session shorter than this is not worth a line; open sessions show as live regardless. */
export const FEED_MIN_SESSION_SECONDS = 600;
/** Project.updatedAt within this of createdAt is the creation itself, not an update. */
export const PROJECT_UPDATE_GAP_MS = 3_600_000;

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).default(FEED_DEFAULT_LIMIT),
  /** ISO instant; only events strictly older than it are returned (the previous page's nextBefore). */
  before: z.string().datetime({ offset: true }).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const feedReactionSchema = z.object({
  target: z.string().regex(REACTION_TARGET_RE, "target must be <session|achievement|project|commits|friendship>:<key>"),
  kind: z.enum(REACTION_KINDS),
});

// ---- wire shapes ----

export interface FeedUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface FeedReactionSummary {
  respect: number;
  flame: number;
  mine: { respect: boolean; flame: boolean };
}

/** An event before its reactions are folded in — what the pure shaping produces. */
export interface FeedEventCore {
  /** Stable target key, also the reaction target — see REACTION_TARGET_RE. */
  id: string;
  type: FeedEventType;
  /** ISO — the sort key and the paging cursor. */
  at: string;
  /** Present (true) only while the session is still open and its tracker still beating. */
  live?: true;
  user: FeedUser;
  /** The other party — friendship events only. */
  other?: FeedUser;
  title: string;
  /** session: "Claude Code · Claude Opus 5"; project: its description; otherwise null. */
  description: string | null;
  badgeId?: AchievementId;
  projectId?: string;
}

export interface FeedEvent extends FeedEventCore {
  reactions: FeedReactionSummary;
}

// ---- row shapes the shaping reads (selected by loadFeedRows, built by the check) ----

export interface FeedSessionRow {
  id: string;
  userId: string;
  projectAlias: string;
  tool: string;
  model: string | null;
  /** "ACTIVE" | "IDLE" | "ENDED" */
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

/** Only public projects are ever loaded — a friend's private project must not leak. */
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
  /** UTC midnight of the day (GithubCommitDay.date). */
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
  /** Every user an event may name — the scope plus the other side of each friendship. */
  users: ReadonlyMap<string, FeedUser>;
  sessions: readonly FeedSessionRow[];
  achievements: readonly FeedAchievementRow[];
  projects: readonly FeedProjectRow[];
  commitDays: readonly FeedCommitDayRow[];
  friendships: readonly FeedFriendshipRow[];
}

export interface FeedScope {
  /** Whose events: the viewer + accepted friends (/feed) or one user (/users/:u/feed). */
  userIds: readonly string[];
  now: Date;
  /** An open session silent for longer than this is not live — same edge presence uses. */
  idleTimeoutMs: number;
}

// ---- labels: the same human names the web prints (web/src/lib/format.ts), so a feed line
// ---- and the profile never disagree about what "codex" or "claude-opus-5" is called.

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
      // 1–2 digit tokens are version parts; anything longer is a date stamp.
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

/** "claude-opus-5" → "Claude Opus 5", "gpt-5-codex" → "GPT-5 Codex"; null for no model. */
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

/** "1h 24m" / "10m" — whole minutes, the resolution a feed line needs. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const ymd = (date: Date): string => date.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

// ---- shaping ----

/**
 * Every event the rows support for the scope, newest first, deduped by id, inside the
 * 30-day window and capped at FEED_CAP. Pure: no clock but `scope.now`.
 */
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
    // Live means open AND still beating: a row the sweep has not closed yet but whose
    // tracker vanished is a finished session that ended at its last beat, not a pulse.
    const live = s.status !== "ENDED" && now - s.lastHeartbeatAt.getTime() <= scope.idleTimeoutMs;
    const end = live ? s.lastHeartbeatAt : s.endedAt ?? s.lastHeartbeatAt;
    const seconds = Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 1000));
    if (!live && seconds < FEED_MIN_SESSION_SECONDS) continue;
    const model = modelLabel(s.model);
    // A session the tracker could not name gets no "in …" — never a literal "unknown".
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
    // One "updated" line per project per day — the id carries the day so reactions stick.
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
    // The in-scope side is `user`; when both are (two friends of the viewer, or the
    // viewer and a friend) the A side wins, so the same row always yields one event.
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

/**
 * Cursor paging over an already-sorted list: strictly older than `before`, then `limit`.
 * A page never splits an `at` tie: the cursor is strictly-older-than, so an event that
 * shares the last one's instant but fell past `limit` would never be reachable (one sync
 * stamps several unlocks with the same `now`; every commit day of a date is midnight).
 * The page extends over the whole tie instead — bounded by FEED_CAP, and in practice a
 * handful of rows.
 */
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
      s = { respect: 0, flame: 0, mine: { respect: false, flame: false } };
      summary.set(target, s);
    }
    return s;
  };
  const isKind = (kind: string): kind is ReactionKind => (REACTION_KINDS as readonly string[]).includes(kind);
  for (const row of counts) if (isKind(row.kind)) of(row.target)[row.kind] = Math.max(0, row.count);
  for (const row of mine) if (isKind(row.kind)) of(row.target).mine[row.kind] = true;
  return events.map((event) => ({ ...event, reactions: of(event.id) }));
}

// ---- Prisma: rows in, page out ----

const USER_SELECT = { id: true, username: true, displayName: true, avatarUrl: true } as const;

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
    // updatedAt ≥ createdAt always, so this one filter covers both the new and the updated event.
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
  // The other side of a friendship may be outside the scope (a friend's new friend).
  const missing = new Set<string>();
  for (const f of friendships) for (const id of [f.userAId, f.userBId]) if (!users.has(id)) missing.add(id);
  if (missing.size > 0) {
    const others = await prisma.user.findMany({ where: { id: { in: [...missing] } }, select: USER_SELECT });
    for (const u of others) users.set(u.id, { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl });
  }

  return { users, sessions, achievements, projects, commitDays, friendships };
}

/** Counts via one groupBy over the page's targets, plus the viewer's own rows when signed in. */
export async function attachReactions(events: readonly FeedEventCore[], viewerId: string | null): Promise<FeedEvent[]> {
  if (events.length === 0) return [];
  const targets = events.map((e) => e.id);
  const [counts, mine] = await Promise.all([
    prisma.feedReaction.groupBy({
      by: ["target", "kind"],
      where: { target: { in: targets } },
      _count: { _all: true },
    }),
    viewerId
      ? prisma.feedReaction.findMany({ where: { userId: viewerId, target: { in: targets } }, select: { target: true, kind: true } })
      : Promise.resolve([]),
  ]);
  return foldReactions(
    events,
    counts.map((row) => ({ target: row.target, kind: row.kind, count: row._count._all })),
    mine
  );
}

export async function listFeed(
  userIds: readonly string[],
  viewerId: string | null,
  query: FeedQuery
): Promise<{ events: FeedEvent[]; nextBefore: string | null }> {
  const now = new Date();
  const rows = await loadFeedRows(userIds, new Date(now.getTime() - FEED_WINDOW_DAYS * DAY_MS));
  const all = buildFeedEvents(rows, { userIds, now, idleTimeoutMs: env.sessionIdleTimeoutMs });
  const page = pageEvents(all, query.limit, query.before ? new Date(query.before) : null);
  return { events: await attachReactions(page.events, viewerId), nextBefore: page.nextBefore };
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
  const count = await prisma.feedReaction.count({ where: { target, kind } });
  return { target, kind, active, count };
}
