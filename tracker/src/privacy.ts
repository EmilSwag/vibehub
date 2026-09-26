import type { HeartbeatPayload, HeartbeatUsage } from "./types";

/** Always on. No config flag can re-enable host observation or legacy replay. */
export const COLLECTION_POLICY = "ai-session-metadata-v1";
/**
 * Protocol name of the explicitly opt-in metadata receiver (`adapters/attested.ts`).
 * The receiver is OFF unless `config.json` turns it on. While it is off the
 * `ai-session-metadata-v1` guarantee above is bit-for-bit unchanged, which is why
 * the policy marker itself does not move; `StatusFile.attestedReceiver` reports the
 * switch instead. Turning it on adds exactly one evidence class — records a separate,
 * user-installed producer wrote — and no new observation of the host.
 */
export const ATTESTED_PROTOCOL = "attested-metadata-v1";

/**
 * Tools a first-party log adapter in this repository may emit.
 *
 * Round 4: `quadcode` joined this list. Its chat log cannot *date* a reply from the
 * record itself — the `timestamp` is local ISO with no zone and, on an LLM record,
 * marks the turn *start* (one measured record spanned 3h47m). The native adapter
 * therefore never treats that stamp as an instant: it dates activity by **observing
 * the append** of a completed LLM record while the daemon is running, and uses the
 * record's own stamp only to discard turns older than a day. See §4.5/§4.7.
 */
export const NATIVE_TOOLS = ["claude-code", "codex", "quadcode"] as const;
/**
 * Tools the explicitly opt-in receiver may accept records for. This is NOT the
 * complement of `NATIVE_TOOLS`: `quadcode` is in both, because a user who installs a
 * producer that genuinely measured a turn may still report it, while the native
 * adapter covers activity and model on its own. Claude Code and Codex are absent
 * deliberately — a file another process writes must never assert their activity.
 *
 * Round 5: `cursor` and `windsurf` join as receiver-ONLY ids. Both vendors publish an
 * official hook system (Cursor Agent Hooks, Windsurf Cascade Hooks) that hands a
 * process the fact that an AI turn started or finished. That process is a producer the
 * *user* installs (`vibehub-tracker hooks install <tool>`, see `src/hooks/`); this
 * repository still reads no Cursor or Windsurf file, directory, process or window. The
 * daemon's only contact with them remains `~/.vibehub/attested.jsonl`, read-only.
 */
export const ATTESTED_TOOLS = ["quadcode", "cursor", "windsurf"] as const;
/**
 * Tools for which NO measured token count exists in any source this repo reads.
 * Their usage is not "zero" — it is unknown, and unknown never becomes a number.
 * Any usage entry naming one of these is rejected outright rather than zeroed.
 *
 * Cursor and Windsurf hooks document a model and an event, and no token counter at all
 * (Round 3 matrix, rows 3 and 5a). So they are tokenless for the same reason Quadcode
 * is, and the vendors' team/billing APIs — which do report tokens — are receivers, not
 * local sources, and are deliberately not consulted.
 */
export const TOKENLESS_TOOLS = ["quadcode", "cursor", "windsurf"] as const;
/**
 * Every id that may appear on the wire: what an adapter here can collect, plus what the
 * opt-in receiver can accept. Derived from the two tables above rather than restated,
 * so a tool can never be receiver-eligible yet rejected by the outgoing projection.
 */
export const SUPPORTED_TOOLS = [...NATIVE_TOOLS, "cursor", "windsurf"] as const;
export type SupportedTool = (typeof SUPPORTED_TOOLS)[number];
export type NativeTool = (typeof NATIVE_TOOLS)[number];
export type AttestedTool = (typeof ATTESTED_TOOLS)[number];
export type TokenlessTool = (typeof TOKENLESS_TOOLS)[number];
/** Turns older than this are historical, never live activity, whatever appended them. */
export const MAX_RECORD_AGE_MS = 24 * 60 * 60_000;
export const MAX_EVENT_AGE_MS = 5 * 60_000;
export const MAX_FUTURE_SKEW_MS = 5_000;
export const MAX_TOKEN_COUNT = 1_000_000_000;
export const MAX_USAGE_ENTRIES = 30;
/** Widest UTC offset in use is 14 h; anything beyond it is not a zone and is dropped. */
export const MAX_TZ_OFFSET_MINUTES = 840;

// Model ids are accepted by a SAFE SHAPE, not an allowlist (QA fix, R1): an allowlist
// went stale the day a new model shipped (`claude-opus-5-5`) and every token it wrote
// was booked with model null, so no name and no ~$. The shapes below admit a provider's
// API id in its documented form and nothing else - lowercase, bounded, no spaces, no
// vendor display ids ("claude-4.5-sonnet", "gpt-5-high"). Pricing stays exact on the
// server: an id it has no verified price for shows its name and no ~$, never a guess.
const MAX_MODEL_ID_LENGTH = 60;
// claude-<family>-<major>[-<minor>[-<patch>]][-<YYYYMMDD>]: claude-opus-5-5, claude-haiku-4-5-20251001.
const CLAUDE_MODEL = /^claude-[a-z]{3,12}(?:-\d{1,2}){1,3}(?:-\d{8})?$/;
// gpt-<major>[.<minor>][-<word>|-<YYYY-MM-DD>]*: gpt-6-sol, gpt-5.1-codex-max, gpt-4o-2024-08-06.
const GPT_MODEL = /^gpt-\d{1,2}(?:\.\d{1,2})?o?(?:-(?:[a-z]{2,12}|\d{4}-\d{2}-\d{2}))*$/;
// Reasoning-effort suffixes are how vendors DISPLAY a setting, not an API model id.
const EFFORT_SUFFIX = /-(?:minimal|low|medium|high|xhigh)(?:-|$)/;
// The o-series is closed: no new ids have shipped in years, so it stays an exact list.
const O_SERIES = new Set(["o1", "o1-pro", "o3", "o3-pro", "o3-mini", "o4-mini"]);

function claudeModel(value: string): boolean { return CLAUDE_MODEL.test(value); }
function codexModel(value: string): boolean {
  return O_SERIES.has(value) || (GPT_MODEL.test(value) && !EFFORT_SUFFIX.test(value));
}

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Membership is read straight off the tables above. Each set is built once from a
// frozen literal tuple, so a predicate cannot drift from the table it claims to
// enforce, and no runtime value can widen one.
const supported = new Set<string>(SUPPORTED_TOOLS);
const native = new Set<string>(NATIVE_TOOLS);
const attested = new Set<string>(ATTESTED_TOOLS);
const tokenless = new Set<string>(TOKENLESS_TOOLS);

export function isSupportedTool(tool: unknown): tool is SupportedTool {
  return typeof tool === "string" && supported.has(tool);
}

/** A tool a log adapter in this repo is allowed to produce. */
export function isNativeTool(tool: unknown): tool is NativeTool {
  return typeof tool === "string" && native.has(tool);
}

/** A tool the opt-in receiver may accept records for. Never Claude Code or Codex. */
export function isAttestedTool(tool: unknown): tool is AttestedTool {
  return typeof tool === "string" && attested.has(tool);
}

/** A tool with no measured token count in any source. Usage stays unknown, never 0. */
export function isTokenlessTool(tool: unknown): tool is TokenlessTool {
  return typeof tool === "string" && tokenless.has(tool);
}

export function safeModel(value: unknown, tool?: SupportedTool): string | null {
  if (typeof value !== "string" || value.length > MAX_MODEL_ID_LENGTH) return null;
  const accepted = tool === "claude-code" ? claudeModel(value)
    : tool === "codex" ? codexModel(value)
    // Multi-model hosts (Quadcode, Cursor, Windsurf, and the receiver in general) can
    // drive either provider, so either shape applies. A vendor's hook reports the id
    // that vendor DISPLAYS, which is not always the provider's API id; those fail both
    // shapes and the tool is reported with no model rather than a mapped guess.
    : claudeModel(value) || codexModel(value);
  return accepted ? value : null;
}

export function isCount(value: unknown, maximum = MAX_TOKEN_COUNT): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

/** A whole number of minutes within +-14 h; nothing else is a UTC offset. */
export function isTzOffsetMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= MAX_TZ_OFFSET_MINUTES;
}

/**
 * Minutes to ADD to UTC to get this host's local time - the sign-flipped
 * `Date#getTimezoneOffset()` (+180 for UTC+3). Read fresh for every payload so a
 * laptop that crosses a zone mid-session reports the zone it is in now. `undefined`
 * (never a guess) on the off chance the runtime reports something that is not a zone.
 */
export function localTzOffsetMinutes(now = new Date()): number | undefined {
  const offset = -now.getTimezoneOffset();
  return isTzOffsetMinutes(offset) ? offset : undefined;
}

/** Never round malformed counters or convert strings to numbers. */
export function countOrZero(value: unknown): number {
  return isCount(value) ? value : 0;
}

export function eventTime(value: unknown, now: number, maxAgeMs = MAX_EVENT_AGE_MS): number | null {
  return eventTimeWithin(value, now, Math.min(maxAgeMs, MAX_EVENT_AGE_MS));
}

/**
 * QA fix (R3): the timestamp of a record the tailer JUST read (it was appended since the
 * last poll), for COUNTING its tokens only. A record can be minutes old by the time it
 * is read - a slow tick, a network outage, a big backlog caught up in chunks - and
 * dropping it lost real usage. Presence never uses this: activity stays on eventTime's
 * 5-minute freshness, and nothing older than MAX_RECORD_AGE_MS is ever counted.
 */
export function countTime(value: unknown, now: number): number | null {
  return eventTimeWithin(value, now, MAX_RECORD_AGE_MS);
}

function eventTimeWithin(value: unknown, now: number, maxAgeMs: number): number | null {
  if (typeof value !== "string" || value.length > 35 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + MAX_FUTURE_SKEW_MS && at >= now - maxAgeMs ? Math.min(at, now) : null;
}

/** A user-controlled display identifier, never a path, URL, control sequence or free-form body. */
export function safeAlias(value: unknown): string | null {
  return typeof value === "string" && value.length <= 64 &&
    /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_. -]/.test(value) && value.trim() === value && !value.includes("..") &&
    !["__proto__", "prototype", "constructor"].includes(value) ? value : null;
}

/** String-only extraction from an AI record. Never stat, open or inspect this path. */
export function folderFromCwd(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return null;
  if (!/^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(value)) return null;
  const parts = value.replace(/\\/g, "/").split("/");
  if (parts.some((part) => part === "." || part === "..")) return null;
  return safeAlias(parts.filter(Boolean).at(-1));
}

/** The setup-selected destination only: no URL paths, credentials or redirects. */
export function safeApiOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export function safeDeviceToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 512 &&
    !/[^A-Za-z0-9._~-]/.test(value);
}

/** Optional cache counters: absent, or a bounded count. Anything else rejects the entry. */
function optionalCount(value: unknown): value is number | undefined {
  return value === undefined || isCount(value);
}

export function projectUsage(value: unknown): HeartbeatUsage | null {
  const u = objectRecord(value);
  // A tokenless tool has no measured counter anywhere, so an entry claiming one is
  // wrong by construction. Rejecting beats zeroing: a zero would read as "measured
  // nothing", which is a different, false claim.
  if (!u || !isSupportedTool(u.tool) || u.estimated === true || isTokenlessTool(u.tool) ||
      !isCount(u.tokensInputDelta) || !isCount(u.tokensOutputDelta) ||
      !optionalCount(u.tokensCacheReadDelta) || !optionalCount(u.tokensCacheWriteDelta)) return null;
  // Cache writes are billed input: they are a SUBSET of tokensInputDelta, never extra.
  if ((u.tokensCacheWriteDelta ?? 0) > u.tokensInputDelta) return null;
  const result: HeartbeatUsage = {
    tool: u.tool, model: safeModel(u.model, u.tool),
    tokensInputDelta: u.tokensInputDelta, tokensOutputDelta: u.tokensOutputDelta,
  };
  if (u.tokensCacheReadDelta) result.tokensCacheReadDelta = u.tokensCacheReadDelta;
  if (u.tokensCacheWriteDelta) result.tokensCacheWriteDelta = u.tokensCacheWriteDelta;
  return result;
}

/** Any counter at all: fresh input, output or cache reads. */
export function hasUsage(u: { tokensInputDelta: number; tokensOutputDelta: number; tokensCacheReadDelta?: number }): boolean {
  return u.tokensInputDelta > 0 || u.tokensOutputDelta > 0 || (u.tokensCacheReadDelta ?? 0) > 0;
}

/** Final outgoing projection. Callers cannot serialize extra properties or old event kinds. */
export function projectHeartbeat(value: unknown, now = Date.now()): HeartbeatPayload | null {
  const p = objectRecord(value);
  if (!p || !isSupportedTool(p.tool) || !["heartbeat", "session_start", "session_end"].includes(String(p.eventType))) return null;
  const alias = safeAlias(p.projectAlias);
  const at = eventTime(p.occurredAt, now);
  if (!alias || at === null) return null;
  const result: HeartbeatPayload = {
    eventType: p.eventType as HeartbeatPayload["eventType"], projectAlias: alias, tool: p.tool,
    model: safeModel(p.model, p.tool), occurredAt: new Date(at).toISOString(),
  };
  // The host's zone is metadata about the clock, not about the host: it is the one
  // extra field a session_start may carry, because that event opens the server-side
  // Session the local-time badge later reads. Anything that is not a sane offset is
  // dropped rather than coerced - a missing zone is never inferred, here or upstream.
  // session_end writes no row, so it carries none.
  if (result.eventType !== "session_end" && isTzOffsetMinutes(p.tzOffsetMinutes)) result.tzOffsetMinutes = p.tzOffsetMinutes;
  if (result.eventType !== "heartbeat") return result;
  if (!Array.isArray(p.usage) || p.usage.length > MAX_USAGE_ENTRIES) return null;
  const usage: HeartbeatUsage[] = [];
  for (const entry of p.usage) {
    const u = projectUsage(entry);
    if (!u) return null;
    if (hasUsage(u)) usage.push(u);
  }
  const input = usage.reduce((sum, u) => sum + u.tokensInputDelta, 0);
  const output = usage.reduce((sum, u) => sum + u.tokensOutputDelta, 0);
  const cacheRead = usage.reduce((sum, u) => sum + (u.tokensCacheReadDelta ?? 0), 0);
  const cacheWrite = usage.reduce((sum, u) => sum + (u.tokensCacheWriteDelta ?? 0), 0);
  if (!isCount(input) || !isCount(output) || !isCount(cacheRead) || !isCount(cacheWrite)) return null;
  result.usage = usage;
  // Unknown usage is ABSENT on the wire, not zero. A tokenless primary with nothing
  // measured anywhere omits the legacy sums entirely, so an older server reading only
  // those fields records no tokens rather than booking a measured zero. When another
  // tool in the same tick did measure something, the sums are still sent — they are
  // that tool's, and dropping them would lose real counts.
  if (!isTokenlessTool(result.tool) || usage.length) {
    result.tokensInputDelta = input;
    result.tokensOutputDelta = output;
    if (cacheRead) result.tokensCacheReadDelta = cacheRead;
    if (cacheWrite) result.tokensCacheWriteDelta = cacheWrite;
  }
  if (p.tools !== undefined) {
    if (!Array.isArray(p.tools) || p.tools.length > SUPPORTED_TOOLS.length) return null;
    result.tools = [];
    for (const entry of p.tools) {
      const tool = objectRecord(entry);
      if (!tool || !isSupportedTool(tool.tool)) return null;
      result.tools.push({ tool: tool.tool, model: safeModel(tool.model, tool.tool), projectAlias: safeAlias(tool.projectAlias) });
    }
  }
  return result;
}
