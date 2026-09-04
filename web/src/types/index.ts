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

/** GET /users/me/tracker — is the local tracker reporting for this account? */
export interface TrackerStatus {
  connected: boolean;
  lastSeenAt: string | null;
  activeTokens: number;
  /** Tool ids seen in the last 30 days, most recent first (e.g. "claude_code"). */
  tools: string[];
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

export interface Presence {
  username: string;
  status: PresenceStatus;
  activity: Activity | null;
}

export interface StatByModel {
  model: string;
  tool: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
}

export interface GithubCommitDay {
  date: string;
  commitCount: number;
}

export interface UserStats {
  byModel: StatByModel[];
  topModel: string | null;
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
