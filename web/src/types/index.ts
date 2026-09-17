// TS types mirroring docs/ARCHITECTURE.md §2 (data model) and §5 (REST/WS contract).
// Frozen contract — do not add fields the server doesn't document.

export type Archetype = "CODER" | "ARTIST" | "DIRECTOR" | "GENERALIST";
export type FriendRequestStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELED";
export type PresenceStatus = "active" | "idle" | "offline";

export type UserRole = "designer" | "developer" | "gamedev" | "creator" | "founder";

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  githubUsername: string | null;
  archetype: Archetype | null;
  /** Self-selected in onboarding step 2; multi-select, empty until chosen. */
  roles: UserRole[];
  /** Only present on /auth/me responses; null until onboarding is finished. */
  onboardedAt?: string | null;
}

/** GET /users/suggested row — public user plus derived account level. */
export interface SuggestedUser extends User {
  level: number;
}

/** One (tool, model) pair the tracker has reported in the last 7 days. */
export interface TrackerSource {
  /** Tool id as the tracker sends it, e.g. "claude-code". */
  tool: string;
  /** Raw model id ("claude-fable-5-1"); null for presence-only tools — the server
   * folds "<synthetic>"/""/"unknown" to null. Render via humanizeModel(). */
  model: string | null;
  lastSeenAt: string;
  tokensToday: number;
  tokens7d: number;
  activeSecondsToday: number;
}

/** A non-revoked tracker token, i.e. one machine the tracker is installed on. */
export interface TrackerDevice {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * A **revoked** token of this account was presented to the heartbeat endpoint within the
 * last 10 minutes: some machine is still running a tracker whose token no longer works.
 *
 * Without this the site can only say "Offline", which is the same word it uses for a
 * laptop that is shut — and it sends the person to start a tracker that is already
 * running. `label` is the device the revoked token belonged to; it is carried for later
 * and deliberately not rendered (see the round-10 web plan's non-goals).
 */
export interface StaleTracker {
  lastRejectedAt: string;
  label: string | null;
  revokedAt: string;
}

/** GET /users/me/tracker (v2) — is the local tracker reporting for this account,
 * and from where? v1 fields are kept verbatim; the v2 additions are what the
 * Settings/Home connect blocks render. usersApi.trackerStatus fills v2 defaults
 * when an older server omits them, so every field is safe to read. */
export interface TrackerStatus {
  /** Heartbeat within SESSION_IDLE_TIMEOUT (presence.status !== "offline"). */
  connected: boolean;
  /** Last heartbeat of any kind. */
  lastSeenAt: string | null;
  activeTokens: number;
  /** Compat: tool ids seen recently, most recent first (e.g. "claude-code"). */
  tools: string[];
  tokenLastUsedAt: string | null;
  /** How often the tracker is expected to report; the UI can size its own polling on it. */
  heartbeatIntervalMs: number;
  /**
   * The viewer's own presence, same shape PresenceBlock takes. `lastSeenAt` is
   * optional (like `tools?`) rather than required: `GET /users/me/tracker`'s
   * `presence` block does carry it server-side (see
   * `[#plans.vibehub-presence-last-seen]`), and `usersApi.trackerStatus()` normalizes
   * a missing key to `null` for a live response — but keeping it optional here means
   * a narrower object literal (e.g. `lib/__checks__/trackerPing.check.ts`'s
   * `TrackerStatus` test fixtures, which predate this field) stays valid without
   * edits. Not currently read by any UI in this codebase (the self tracker panel,
   * TrackingStatus.tsx, is out of scope for the friend-surface/profile "last online"
   * line); present for contract completeness and future use.
   */
  presence: { status: PresenceStatus; activity: Activity | null; tools?: PresenceTool[]; lastSeenAt?: string | null };
  /** Every (tool, model) pair seen in the last 7 days, most recently seen first. */
  sources: TrackerSource[];
  devices: TrackerDevice[];
  /**
   * Optional on purpose: a server that predates this omits the key entirely, and every
   * caller must read correctly without it. `null` = nothing stale seen recently.
   * `usersApi.trackerStatus` normalises the missing key to null.
   */
  staleTracker?: StaleTracker | null;
}

export interface LevelBreakdown {
  level: number;
  xp: number;
  activeHours: number;
  totalTokens: number;
  projects: number;
  friends: number;
  commits: number;
}

export interface ExternalLink {
  id: string;
  url: string;
  label: string | null;
  icon: string;
  order: number;
}

export interface FriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: FriendRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  // populated by GET /friends/requests for display without extra round-trips
  sender?: User;
  receiver?: User;
}

export interface Friend {
  user: User;
  since: string;
  daysAsFriends: number;
}

export interface WallComment {
  id: string;
  wallOwnerId: string;
  authorId: string;
  author?: User;
  body: string;
  createdAt: string;
}

export interface Project {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string | null;
  repoUrl: string | null;
  liveUrl: string | null;
  coverImageUrl: string | null;
  /** Screenshots (max 8); the first one is the default cover. */
  imageUrls: string[];
  isPublic: boolean;
  likeCount: number;
  createdAt: string;
}

/** GET /projects/:id/commits — recent pushes parsed from the GitHub repo URL. */
export interface RepoCommit {
  sha: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  committedAt: string;
  url: string;
  /** null when GitHub rate-limited the per-commit stats call. */
  additions: number | null;
  deletions: number | null;
  filesChanged: number | null;
}

/** Most recent GitHub Actions run for the repo, or null (no Actions / unreachable). */
export interface RepoBuild {
  status: string;
  url: string;
  branch: string;
  headSha: string;
  updatedAt: string;
}

/** Latest published GitHub release, or null (none / unreachable). */
export interface RepoRelease {
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
}

export interface RepoActivity {
  repo: { owner: string; repo: string } | null;
  commits: RepoCommit[];
  lastPushAt: string | null;
  build: RepoBuild | null;
  latestRelease: RepoRelease | null;
}

/** One row of `GET /projects/:id/repo` — a file or folder at the requested path. */
export interface RepoEntry {
  name: string;
  type: "dir" | "file";
  /** Byte size for files; null for directories. */
  size: number | null;
  /** github.com URL for the entry. */
  url: string;
}

/** Language share of the repo, 0–1, biggest first. */
export interface RepoLanguage {
  name: string;
  share: number;
}

/** README with markdown syntax stripped — plain text, ~600 chars. */
export interface RepoReadme {
  excerpt: string;
  url: string;
}

/**
 * GET /projects/:id/repo?path= — one directory level of the linked GitHub repo's
 * default branch (round 7). `languages`/`readme` describe the whole repo and are
 * only sent for the root listing (`path === ""`); they are null deeper in.
 * Non-GitHub repo → 404, GitHub rate-limited/unreachable → 503.
 */
export interface RepoTree {
  repo: { owner: string; repo: string };
  defaultBranch: string;
  path: string;
  entries: RepoEntry[];
  languages: RepoLanguage[] | null;
  readme: RepoReadme | null;
}

/** GET /projects/:id/digest — optional GitHub enrichment for a project card. */
export interface RepoDigest {
  repo: { owner: string; repo: string };
  url: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  languages: RepoLanguage[] | null;
  topics: string[];
  license: string | null;
  defaultBranch: string;
  createdAt: string | null;
  pushedAt: string | null;
  readme: RepoReadme | null;
  socialImageUrl: string;
  fetchedAt: string;
}

/** GET /users/me/github/repos row — the signed-in user's own GitHub repos (repo picker). */
export interface GithubRepoSummary {
  fullName: string;
  name: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  pushedAt: string | null;
  defaultBranch: string;
  language: string | null;
  stars: number;
}

export interface Activity {
  projectAlias: string;
  tool: string;
  /** null when the tool exposes no model (presence-only tools: Cursor, Quadcode, Grok, ChatGPT). */
  model: string | null;
  startedAt: string;
}

/**
 * Round 6: one tool the person has open right now. People sit in several terminals
 * and IDEs at once, so presence lists the whole stack — but hours and tokens still
 * accrue only to the primary, which is `activity` and always `tools[0]`.
 *
 * Not to be confused with `TrackerStatus.tools`, which is a flat list of tool *ids*
 * seen recently. This one is per-tool presence detail.
 */
export interface PresenceTool {
  tool: string;
  /** null when that tool exposes no model (Cursor, ChatGPT app, a fresh Quadcode chat). */
  model: string | null;
  /** null when unknown, or when the user hid that project — the tool still shows. */
  projectAlias: string | null;
}

export interface Presence {
  username: string;
  status: PresenceStatus;
  activity: Activity | null;
  /**
   * Optional because a server older than round 6 does not send it. Never read it
   * directly — use `toolsOf(presence)` from lib/api.ts, which falls back to the
   * primary activity.
   */
  tools?: PresenceTool[];
  /**
   * "Last online" — server-computed max(heartbeat incl. ENDED, connect receipt),
   * ISO-8601, never verification time (see `[#plans.vibehub-presence-last-seen]`).
   * Always present (never `undefined`) on the app-level `Presence` a component
   * reads: normalized to `null` at every ingest point — `presenceApi.friends()`
   * fills a missing/omitted key from an older server, and `RealtimeContext`'s WS
   * merge keeps the previously known value when a `presence:update` event omits
   * the key, only ever defaulting to `null` when there was no prior value either.
   * Read via `lastOnlineLabel()` (lib/lastOnline.ts), not directly.
   */
  lastSeenAt: string | null;
}

export interface StatByModel {
  model: string;
  tool: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
  /**
   * Round 7: newest moment this (tool, model) pair was seen inside the range —
   * ISO, day-granular for closed rollups. Optional because a server older than
   * round 7 does not send it; `RecentModels` then sorts by hours and prints no
   * "last used" date rather than inventing one.
   */
  lastActiveAt?: string | null;
}

/**
 * One tool, summed across every model used inside it — the per-tool counterpart to
 * `StatByModel`. `lastActiveAt` is always present (unlike `StatByModel`'s optional
 * one) because a `UserStats` that sends `byTool` at all sends it fully computed;
 * `null` means "known to have no activity in range", not "not computed".
 */
export interface StatByTool {
  tool: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
  lastActiveAt: string | null;
}

export interface GithubCommitDay {
  date: string;
  commitCount: number;
}

export interface UserStats {
  byModel: StatByModel[];
  /**
   * Pre-aggregated per-tool rollup. Optional because a server that predates this
   * field doesn't send it — `lib/topTool.ts`'s `toolBuckets()` then aggregates
   * `byModel` per `tool` client-side (summed tokens/activeSeconds, latest
   * `lastActiveAt`) as an equivalent fallback, same convention as
   * `StatByModel.lastActiveAt`'s own optionality. An explicitly empty `[]` is a real
   * "nothing in range" answer and is used as-is, never treated as absent.
   * See `[#plans.public-last-online-top-tool]`.
   */
  byTool?: StatByTool[];
  topModel: string | null;
  /**
   * Optional companion to `byTool` — the server's own precomputed leader. Omitted (or
   * explicitly `null`) on a server that predates it, or one that sends `byTool` without
   * a leader; `lib/topTool.ts`'s `topToolOf()` then falls back to the highest-ranked
   * `toolBuckets()` entry either way — `??` treats an explicit `null` the same as a
   * missing field here, deliberately: a leader is either named or derived, never left
   * unresolved when the underlying data exists to derive one.
   */
  topTool?: string | null;
  totalTokens: number;
  totalActiveSeconds: number;
  streak: { currentStreak: number; longestStreak: number };
  githubCommits: GithubCommitDay[];
}

export interface TrackerToken {
  id: string;
  label: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// ---- WebSocket contract (ARCHITECTURE.md §5.9) ----

export type WsClientMessage = {
  type: "subscribe";
  channels: string[];
};

export type WsServerEvent =
  | {
      type: "presence:update";
      username: string;
      status: PresenceStatus;
      activity: Activity | null;
      /** Round 6; absent from servers that predate it — see `toolsOf` in lib/api.ts. */
      tools?: PresenceTool[];
      /**
       * Optional on the wire only: absent when the server predates it. Missing here
       * means "unchanged", not "unknown" — `RealtimeContext`'s merge keeps whatever
       * `lastSeenAt` it already had for this username rather than overwriting with
       * `null`. See `Presence.lastSeenAt` for the always-present app-level contract.
       */
      lastSeenAt?: string | null;
    }
  | {
      type: "wall:new-comment";
      wallOwner: string;
      comment: WallComment;
    }
  | {
      type: "friend-request:incoming";
      request: FriendRequest;
    };
