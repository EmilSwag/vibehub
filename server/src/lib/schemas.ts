import { z } from "zod";

// Enums are validated here as plain strings on purpose — the SQLite dev schema has
// no native enum type, so the app layer is the single source of truth for both
// (docs/ARCHITECTURE.md §2.15).
export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,24}$/, "username must be 3-24 chars, lowercase letters/digits/hyphens only");

export const devLoginSchema = z.object({ username: usernameSchema });

// Self-selected onboarding role cards (User.roles, multi-select, stored as CSV).
// Archetype stays computed separately.
export const USER_ROLES = ["designer", "developer", "gamedev", "creator", "founder"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const rolesSchema = z
  .array(z.enum(USER_ROLES))
  .min(1)
  .max(USER_ROLES.length)
  .transform((list) => [...new Set(list)]);

export const patchMeSchema = z.object({
  username: usernameSchema.optional(),
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(500).nullable().optional(),
  roles: rolesSchema.optional(),
});

/** CSV column ⇄ array helpers (single source of truth for the encoding). */
export const rolesToCsv = (roles: readonly string[]) => roles.join(",");
export const rolesFromCsv = (csv: string | null | undefined): UserRole[] =>
  (csv ?? "")
    .split(",")
    .filter((r): r is UserRole => (USER_ROLES as readonly string[]).includes(r));

export const suggestedUsersQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const linkInputSchema = z.object({
  url: z.string().url().max(2048),
  label: z.string().max(80).optional(),
});
export const putLinksSchema = z.object({ links: z.array(linkInputSchema).max(20) });

export const createTrackerTokenSchema = z.object({ label: z.string().min(1).max(60) });

export const sendFriendRequestSchema = z.object({ targetUsername: usernameSchema });

export const wallBodySchema = z.object({ body: z.string().min(1).max(1000) });

export const MAX_PROJECT_IMAGES = 8;

// Screenshot URLs may be absolute (AI agents posting hosted images) or our own
// upload paths ("/uploads/..."), so `url()` alone is too strict.
const imageUrlSchema = z
  .string()
  .max(2048)
  .refine((s) => /^https?:\/\//.test(s) || s.startsWith("/uploads/"), "must be an http(s) URL or an /uploads path");
const imageUrlsSchema = z.array(imageUrlSchema).max(MAX_PROJECT_IMAGES);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  repoUrl: z.string().url().max(2048).optional(),
  liveUrl: z.string().url().max(2048).optional(),
  coverImageUrl: imageUrlSchema.optional(),
  imageUrls: imageUrlsSchema.optional(),
  isPublic: z.boolean().optional(),
});
export const patchProjectSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  repoUrl: z.string().url().max(2048).nullable().optional(),
  liveUrl: z.string().url().max(2048).nullable().optional(),
  coverImageUrl: imageUrlSchema.nullable().optional(),
  imageUrls: imageUrlsSchema.optional(),
  isPublic: z.boolean().optional(),
});

/** JSON column ⇄ array helpers for Project.imageUrls. */
export const imageUrlsToJson = (urls: readonly string[]) => JSON.stringify(urls);
export const imageUrlsFromJson = (json: string | null | undefined): string[] => {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
};

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
