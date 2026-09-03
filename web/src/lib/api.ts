// Typed REST client — one function per endpoint in docs/ARCHITECTURE.md §5.
// Base URL from env (never hardcoded), httpOnly cookie auth via credentials: "include".

import type {
  Archetype,
  Friend,
  FriendRequest,
  LevelBreakdown,
  Project,
  Presence,
  SuggestedUser,
  TrackerToken,
  User,
  UserRole,
  UserStats,
  WallComment,
} from "../types";

const BASE_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json", ...init.headers }
        : init?.headers,
    ...init,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : undefined;

  if (!res.ok) {
    // Server error middleware (server/src/lib/http-error.ts) responds with `{ error }`;
    // accept `{ message }` too for forward-compat.
    const message =
      (data && typeof data === "object" && "error" in data && String(data.error)) ||
      (data && typeof data === "object" && "message" in data && String(data.message)) ||
      `Request failed: ${res.status}`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

// ---- Auth (§5.1) ----

export const githubLoginUrl = () => `${BASE_URL}/api/v1/auth/github`;

export type AuthCapabilities = { github: boolean; devLogin: boolean };

export const authApi = {
  /** Which sign-in methods this server instance actually has configured. */
  capabilities: async (): Promise<AuthCapabilities> => {
    const health = await request<{ auth?: Partial<AuthCapabilities> }>("/api/v1/health");
    return { github: health.auth?.github ?? true, devLogin: health.auth?.devLogin ?? false };
  },
  me: () => request<{ user: User | null }>("/api/v1/auth/me"),
  /** Exchange the one-time GitHub ticket for the session cookie (same origin hop as dev-login). */
  claim: (ticket: string) => request<{ user: User }>("/api/v1/auth/claim", json({ ticket })),
  devLogin: (username: string) =>
    request<{ user: User }>("/api/v1/auth/dev-login", json({ username })),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
};

// ---- Users & profile (§5.2) ----

export const usersApi = {
  get: (username: string) =>
    request<{
      user: User;
      links: { id: string; url: string; label: string | null; icon: string; order: number }[];
      archetype: Archetype | null;
      friendCount: number;
      level: number;
      levelBreakdown: LevelBreakdown;
    }>(`/api/v1/users/${encodeURIComponent(username)}`),

  /** People you might know (not me, not friends, no pending request). `invitedIds` = already invited by me. */
  suggested: (q?: string, limit = 30) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (q) params.set("q", q);
    return request<{ users: SuggestedUser[]; invitedIds: string[] }>(
      `/api/v1/users/suggested?${params.toString()}`
    );
  },

  updateMe: (body: { username?: string; displayName?: string; bio?: string; role?: UserRole | null }) =>
    request<{ user: User }>("/api/v1/users/me", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),

  completeOnboarding: () =>
    request<{ user: User }>("/api/v1/users/me/onboarding/complete", { method: "POST" }),

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ avatarUrl: string }>("/api/v1/users/me/avatar", {
      method: "POST",
      body: form,
    });
  },

  putLinks: (links: { url: string; label?: string }[]) =>
    request<{ links: { id: string; url: string; label: string | null; icon: string; order: number }[] }>(
      "/api/v1/users/me/links",
      { method: "PUT", body: JSON.stringify({ links }), headers: { "Content-Type": "application/json" } }
    ),

  createTrackerToken: (label: string) =>
    request<{ token: string; tokenId: string }>(
      "/api/v1/users/me/tracker-tokens",
      json({ label })
    ),

  listTrackerTokens: () => request<{ tokens: TrackerToken[] }>("/api/v1/users/me/tracker-tokens"),

  revokeTrackerToken: (id: string) =>
    request<void>(`/api/v1/users/me/tracker-tokens/${id}`, { method: "DELETE" }),
};

// ---- Friends (§5.3) ----

export const friendsApi = {
  list: () => request<{ friends: Friend[] }>("/api/v1/friends"),
  requests: () =>
    request<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>("/api/v1/friends/requests"),
  sendRequest: (targetUsername: string) =>
    request<{ request: FriendRequest }>("/api/v1/friends/requests", json({ targetUsername })),
  acceptRequest: (id: string) =>
    request<{ friendship: unknown }>(`/api/v1/friends/requests/${id}/accept`, { method: "POST" }),
  declineRequest: (id: string) =>
    request<void>(`/api/v1/friends/requests/${id}/decline`, { method: "POST" }),
  unfriend: (username: string) =>
    request<void>(`/api/v1/friends/${encodeURIComponent(username)}`, { method: "DELETE" }),
};

// ---- Wall (§5.4) ----

export const wallApi = {
  list: (username: string, cursor?: string, limit = 20) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request<{ comments: WallComment[]; nextCursor: string | null }>(
      `/api/v1/users/${encodeURIComponent(username)}/wall?${params.toString()}`
    );
  },
  post: (username: string, body: string) =>
    request<{ comment: WallComment }>(
      `/api/v1/users/${encodeURIComponent(username)}/wall`,
      json({ body })
    ),
  remove: (commentId: string) =>
    request<void>(`/api/v1/wall/${commentId}`, { method: "DELETE" }),
};

// ---- Projects (§5.5) ----

export const projectsApi = {
  list: (username: string) =>
    request<{ projects: Project[] }>(`/api/v1/users/${encodeURIComponent(username)}/projects`),
  create: (body: { name: string; description?: string; repoUrl?: string; liveUrl?: string }) =>
    request<{ project: Project }>("/api/v1/projects", json(body)),
  update: (id: string, body: Partial<{ name: string; description: string; repoUrl: string; liveUrl: string; isPublic: boolean }>) =>
    request<{ project: Project }>(`/api/v1/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  remove: (id: string) => request<void>(`/api/v1/projects/${id}`, { method: "DELETE" }),
  like: (id: string) =>
    request<{ likeCount: number }>(`/api/v1/projects/${id}/like`, { method: "POST" }),
  unlike: (id: string) =>
    request<{ likeCount: number }>(`/api/v1/projects/${id}/like`, { method: "DELETE" }),
};

// ---- Stats (§5.6) ----

export const statsApi = {
  get: (username: string, range = "30d") =>
    request<UserStats>(`/api/v1/users/${encodeURIComponent(username)}/stats?range=${range}`),
  compare: (username: string, withUsername: string, range = "30d") =>
    request<{ a: UserStats; b: UserStats }>(
      `/api/v1/users/${encodeURIComponent(username)}/stats/compare?with=${encodeURIComponent(withUsername)}&range=${range}`
    ),
};

// ---- Presence (§5.7) ----

export const presenceApi = {
  friends: () => request<{ presences: Presence[] }>("/api/v1/presence/friends"),
};
