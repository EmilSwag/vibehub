import { z } from "zod";

// Enums are validated here as plain strings on purpose — the SQLite dev schema has
// no native enum type, so the app layer is the single source of truth for both
// (docs/ARCHITECTURE.md §2.15).
export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,24}$/, "username must be 3-24 chars, lowercase letters/digits/hyphens only");

export const devLoginSchema = z.object({ username: usernameSchema });

export const patchMeSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(500).nullable().optional(),
});

export const linkInputSchema = z.object({
  url: z.string().url().max(2048),
  label: z.string().max(80).optional(),
});
export const putLinksSchema = z.object({ links: z.array(linkInputSchema).max(20) });

export const createTrackerTokenSchema = z.object({ label: z.string().min(1).max(60) });

export const sendFriendRequestSchema = z.object({ targetUsername: usernameSchema });

export const wallBodySchema = z.object({ body: z.string().min(1).max(1000) });

export const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  repoUrl: z.string().url().max(2048).optional(),
  liveUrl: z.string().url().max(2048).optional(),
});
export const patchProjectSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  repoUrl: z.string().url().max(2048).nullable().optional(),
  liveUrl: z.string().url().max(2048).nullable().optional(),
  coverImageUrl: z.string().url().max(2048).nullable().optional(),
  isPublic: z.boolean().optional(),
});

export const HEARTBEAT_EVENT_TYPES = ["heartbeat", "session_start", "session_end", "git_commit"] as const;

// ARCHITECTURE.md §4.3: session_start/session_end omit token deltas, git_commit only
// adds repoAlias — kept loose (optional) here and enforced per-eventType in the route.
export const heartbeatSchema = z.object({
  eventType: z.enum(HEARTBEAT_EVENT_TYPES),
  projectAlias: z.string().min(1).max(200),
  tool: z.string().min(1).max(60).optional(),
  model: z.string().min(1).max(60).optional(),
  tokensInputDelta: z.number().int().nonnegative().optional(),
  tokensOutputDelta: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
  repoAlias: z.string().min(1).max(200).optional(),
});
