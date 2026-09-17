import type { HeartbeatPayload, HeartbeatUsage } from "./types";

/** Always on. No config flag can re-enable host observation or legacy replay. */
export const COLLECTION_POLICY = "ai-session-metadata-v1";
export const SUPPORTED_TOOLS = ["claude-code", "codex"] as const;
export type SupportedTool = (typeof SUPPORTED_TOOLS)[number];
export const MAX_EVENT_AGE_MS = 5 * 60_000;
export const MAX_FUTURE_SKEW_MS = 5_000;
export const MAX_TOKEN_COUNT = 1_000_000_000;
export const MAX_USAGE_ENTRIES = 30;

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

export function isSupportedTool(tool: unknown): tool is SupportedTool {
  return tool === "claude-code" || tool === "codex";
}

export function safeModel(value: unknown, tool?: SupportedTool): string | null {
  if (typeof value !== "string") return null;
  const accepted = tool === "claude-code" ? CLAUDE_MODELS.has(value)
    : tool === "codex" ? CODEX_MODELS.has(value)
    : CLAUDE_MODELS.has(value) || CODEX_MODELS.has(value);
  return accepted ? value : null;
}

export function isCount(value: unknown, maximum = MAX_TOKEN_COUNT): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
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
  if (!u || !isSupportedTool(u.tool) || u.estimated === true ||
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
  result.tokensInputDelta = input;
  result.tokensOutputDelta = output;
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
