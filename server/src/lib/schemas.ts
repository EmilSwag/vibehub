import { z } from "zod";

// Enums are validated here as plain strings on purpose — the SQLite dev schema has
// no native enum type, so the app layer is the single source of truth for both
// (docs/ARCHITECTURE.md §2.15).
export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,24}$/, "username must be 3-24 chars, lowercase letters/digits/hyphens only");

export const devLoginSchema = z.object({ username: usernameSchema });

// Round 5 Phase 6: feature-flagged prod QA login (routes/auth.ts POST /auth/qa-login).
// Scoped to a fixed prefix so it can never collide with/impersonate a real username.
export const qaLoginSchema = z.object({
  username: z.string().regex(/^vh-qa-[a-z0-9-]{1,20}$/, "must match ^vh-qa-[a-z0-9-]{1,20}$"),
});

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

// `replaceUnused` (connect flow, ARCHITECTURE.md §5.2): revoke every token of mine that
// never authenticated anything (lastUsedAt null) before minting this one, so a user
// retrying "New token" ends up with one live token, not a pile. Used tokens (real
// devices) are never touched.
export const createTrackerTokenSchema = z.object({
  label: z.string().min(1).max(60),
  replaceUnused: z.boolean().optional(),
});

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

// Model strings travel as 0..60 chars (not min(1)) so the tracker can send "" for
// "no model" and the server normalizes it — together with the "unknown" and
// "<synthetic>" sentinels — to null via lib/sessions.ts's normalizeModel(). Rejecting
// "" with a 400 would drop the whole heartbeat (and presence with it) over a field
// that only degrades.
const modelSchema = z.string().max(60).nullable().optional();

// Heartbeat v2 (ARCHITECTURE.md §4.3): precise per-source token attribution. One entry
// per (tool, model) the tracker read tokens from since its last heartbeat — which may
// differ from the top-level presence tool (Claude Code open in the terminal while a
// Codex log also grows). When `usage` is present the server folds these straight into
// DailyStat and IGNORES the top-level deltas for token accounting; the tracker still
// sends those as a legacy sum so servers that predate `usage` keep working.
// Round 6 multi-tool presence (ARCHITECTURE.md §4.3): every tool the tracker can see
// open at this moment, primary first. People sit in several terminals and IDEs at once,
// so presence shows the whole stack — but time and tokens still accrue only to the
// primary (the top-level tool/model). Presence data only; never token accounting.
export const MAX_TOOL_ENTRIES = 10;
export const toolEntrySchema = z.object({
  tool: z.string().min(1).max(60),
  model: modelSchema,
  /** null when unknown, or when the user hid that project — the tool still shows. */
  projectAlias: z.string().max(200).nullable().optional(),
});

export const MAX_USAGE_ENTRIES = 30;
export const usageEntrySchema = z.object({
  tool: z.string().min(1).max(60),
  model: modelSchema,
  // Round 6: the tracker sets this when the counts were derived rather than reported
  // (Quadcode logs carry no token numbers, so its adapter estimates from character
  // counts). Accepted and echoed into the ActivityEvent payload; it does not change
  // accounting. Any surface that shows these numbers must label them "est.".
  estimated: z.boolean().optional(),
  tokensInputDelta: z.number().int().nonnegative(),
  tokensOutputDelta: z.number().int().nonnegative(),
});
export type UsageEntryInput = z.infer<typeof usageEntrySchema>;

// ARCHITECTURE.md §4.3: session_start/session_end omit token deltas, git_commit only
// adds repoAlias — kept loose (optional) here and enforced per-eventType in the route.
export const heartbeatSchema = z.object({
  eventType: z.enum(HEARTBEAT_EVENT_TYPES),
  projectAlias: z.string().min(1).max(200),
  tool: z.string().min(1).max(60).optional(),
  // null for presence-only tools (no model knowable); omitted by older trackers.
  model: modelSchema,
  tokensInputDelta: z.number().int().nonnegative().optional(),
  tokensOutputDelta: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
  repoAlias: z.string().min(1).max(200).optional(),
  usage: z.array(usageEntrySchema).max(MAX_USAGE_ENTRIES).optional(),
  tools: z.array(toolEntrySchema).max(MAX_TOOL_ENTRIES).optional(),
});
