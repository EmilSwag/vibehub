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

// Exact IDs already documented in the tracker and the project's reviewed model
// catalog. This is a data allowlist, NOT model discovery, pricing or an alias map.
// Unknown/custom/new IDs become null; never infer a model from a tool or title.
const CLAUDE_MODELS = new Set([
  "claude-fable-5-1", "claude-fable-5", "claude-opus-5", "claude-opus-4-8",
  "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5-20251101", "claude-opus-4-5",
  "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-sonnet-4-5",
  "claude-haiku-4-5-20251001", "claude-haiku-4-5",
]);
const CODEX_MODELS = new Set([
  "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro",
  "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4-pro", "gpt-5.2", "gpt-5.2-pro",
  "gpt-5.1", "gpt-5", "gpt-5-2025-08-07", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro",
  "gpt-4.1", "gpt-4.1-2025-04-14", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o",
  "gpt-4o-2024-08-06", "gpt-4o-2024-05-13", "gpt-4o-mini", "o1", "o1-pro", "o3-pro",
  "o3", "o4-mini", "o3-mini", "gpt-5-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max", "gpt-5.2-codex", "gpt-5.3-codex",
]);

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
  if (typeof value !== "string") return null;
  const accepted = tool === "claude-code" ? CLAUDE_MODELS.has(value)
    : tool === "codex" ? CODEX_MODELS.has(value)
    // Multi-model hosts (Quadcode, Cursor, Windsurf, and the receiver in general) can
    // drive any reviewed model, so the union of the existing allowlists applies.
    // Deliberately NO id is added on their behalf — an observed-but-unreviewed id stays
    // null rather than becoming a new entry with no pricing evidence behind it.
    //
    // Round 5, worth knowing before someone "fixes" this: a vendor's hook reports the
    // id that vendor displays, which is not always the provider's API id. Those land on
    // the `null` branch and the tool is reported with no model, which is the honest
    // answer — inventing a mapping would attribute work to a model nobody verified.
    : CLAUDE_MODELS.has(value) || CODEX_MODELS.has(value);
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
  if (typeof value !== "string" || value.length > 35 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + MAX_FUTURE_SKEW_MS &&
    at >= now - Math.min(maxAgeMs, MAX_EVENT_AGE_MS) ? Math.min(at, now) : null;
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

export function projectUsage(value: unknown): HeartbeatUsage | null {
  const u = objectRecord(value);
  // A tokenless tool has no measured counter anywhere, so an entry claiming one is
  // wrong by construction. Rejecting beats zeroing: a zero would read as "measured
  // nothing", which is a different, false claim.
  if (!u || !isSupportedTool(u.tool) || u.estimated === true || isTokenlessTool(u.tool) ||
      !isCount(u.tokensInputDelta) || !isCount(u.tokensOutputDelta)) return null;
  return {
    tool: u.tool, model: safeModel(u.model, u.tool),
    tokensInputDelta: u.tokensInputDelta, tokensOutputDelta: u.tokensOutputDelta,
  };
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
    if (u.tokensInputDelta || u.tokensOutputDelta) usage.push(u);
  }
  const input = usage.reduce((sum, u) => sum + u.tokensInputDelta, 0);
  const output = usage.reduce((sum, u) => sum + u.tokensOutputDelta, 0);
  if (!isCount(input) || !isCount(output)) return null;
  result.usage = usage;
  // Unknown usage is ABSENT on the wire, not zero. A tokenless primary with nothing
  // measured anywhere omits the legacy sums entirely, so an older server reading only
  // those fields records no tokens rather than booking a measured zero. When another
  // tool in the same tick did measure something, the sums are still sent — they are
  // that tool's, and dropping them would lose real counts.
  if (!isTokenlessTool(result.tool) || usage.length) {
    result.tokensInputDelta = input;
    result.tokensOutputDelta = output;
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
