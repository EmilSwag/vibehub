// TS types mirroring docs/ARCHITECTURE.md §2 (data model) and §5 (REST/WS contract).
// Frozen contract — do not add fields the server doesn't document.

export type Archetype = "CODER" | "ARTIST" | "DIRECTOR" | "GENERALIST";
export type FriendRequestStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELED";
export type PresenceStatus = "active" | "idle" | "offline";

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  bio: string | null;
  githubUsername: string | null;
  archetype: Archetype | null;
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
  isPublic: boolean;
  likeCount: number;
}

export interface Activity {
  projectAlias: string;
  tool: string;
  model: string;
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
