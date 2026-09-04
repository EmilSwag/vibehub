// Formatting helpers — client-side only, never invents server data.
// One locale everywhere, explicit on every Intl call — a bare .toLocaleDateString()
// silently follows the visitor's OS/browser locale, which reads as broken when it
// lands next to this file's hand-formatted "3d ago" strings (round-5 design QA).
//
// Model / tool naming lives here too (humanizeModel, toolLabel, presenceParts) and
// is pinned by web/src/lib/__checks__/format.check.ts — run it after touching
// anything below: `npx tsx web/src/lib/__checks__/format.check.ts`.
const LOCALE = "en-US";

export function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** "just now" (< 1 min), "12m", "1h 42m". `now` is injectable so ticking UIs and
 * the check script can render a fixed instant. Invalid dates read as "just now". */
export function elapsedShort(iso: string, now: number = Date.now()): string {
  const raw = now - new Date(iso).getTime();
  const ms = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "just now";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

const capWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const titleCase = (s: string) => s.split(/[-_\s]+/).filter(Boolean).map(capWord).join(" ");

// ---------------------------------------------------------------------------
// Tools — what the person is *in* (presence tool). Separate from model families:
// a tool never masquerades as a model any more (round-6 contract).
// ---------------------------------------------------------------------------

/** Tool ids the tracker reports (tracker/src/adapters/processes.ts) — kebab-case;
 * older builds used snake_case, which `normalizeToolId` folds in. */
export type ToolFamily =
  | "claude-code"
  | "codex"
  | "cursor"
  | "vscode"
  | "windsurf"
  | "zed"
  | "quadcode"
  | "chatgpt"
  | "grok"
  | "unknown";

const TOOL_NAMES: Record<ToolFamily, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Windsurf",
  zed: "Zed",
  quadcode: "Quadcode AI",
  chatgpt: "ChatGPT",
  grok: "Grok",
  unknown: "Unknown tool",
};

const NULL_IDS = new Set(["", "unknown", "<synthetic>", "null", "undefined", "none", "n/a"]);

function normalizeToolId(id: string | null | undefined): string {
  return (id ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function isToolFamily(id: string): id is ToolFamily {
  return Object.prototype.hasOwnProperty.call(TOOL_NAMES, id);
}

/** Bucket a raw tool id into a family we can put a glyph to. Accepts kebab-case
 * and snake_case ("claude_code"), plus the loose aliases adapters have shipped
 * ("code", "visual-studio-code", "genui"). Anything else → "unknown". */
export function toolFamily(id: string | null | undefined): ToolFamily {
  const t = normalizeToolId(id);
  if (isToolFamily(t)) return t;
  if (NULL_IDS.has(t)) return "unknown";
  if (t.includes("claude")) return "claude-code";
  if (t.includes("codex")) return "codex";
  if (t.includes("cursor")) return "cursor";
  if (t.includes("windsurf")) return "windsurf";
  if (t.includes("quadcode") || t.includes("genui")) return "quadcode";
  if (t.includes("chatgpt")) return "chatgpt";
  if (t.includes("grok")) return "grok";
  if (t.includes("vscode") || t.includes("visual-studio") || t === "code") return "vscode";
  if (t === "zed" || t.startsWith("zed-")) return "zed";
  return "unknown";
}

/** "claude-code" → "Claude Code", "codex" → "Codex CLI", "quadcode" → "Quadcode AI".
 * Unrecognised-but-present ids pass through title-cased ("my-tool" → "My Tool");
 * empty/"unknown" → "Unknown tool". */
export function toolLabel(id: string | null | undefined): string {
  const t = normalizeToolId(id);
  const family = toolFamily(t);
  if (family !== "unknown") return TOOL_NAMES[family];
  if (NULL_IDS.has(t)) return TOOL_NAMES.unknown;
  return titleCase(t);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Model families we can put a face to (ModelGlyph mirrors this bucketing — keep
 * the two in sync). "gpt" covers all of OpenAI incl. the o-series. */
export type ModelFamily = "claude" | "gpt" | "gemini" | "grok" | "unknown";

const CLAUDE_FAMILIES = new Set(["fable", "opus", "sonnet", "haiku", "instant"]);

/** Lower-case, trimmed, provider prefix dropped ("openai/", "anthropic/", "models/",
 * Bedrock "us.anthropic."), Vertex "@date" / Bedrock "-v2:0" / "[1m]" suffixes gone. */
function normalizeModelId(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:[a-z0-9_.-]+\/)+/, "")
    .replace(/^(?:[a-z]+\.)*anthropic\./, "")
    .replace(/\[\d+[mk]\]$/, "")
    .replace(/-v\d+(?::\d+)?$/, "")
    .replace(/@\d{6,}$/, "");
}

export function modelFamily(raw: string | null | undefined): ModelFamily {
  const m = normalizeModelId(raw);
  if (NULL_IDS.has(m)) return "unknown";
  if (m.includes("claude") || /^(fable|opus|sonnet|haiku)(?![a-z])/.test(m)) return "claude";
  if (m.includes("gpt") || /^o\d/.test(m)) return "gpt";
  if (m.includes("gemini")) return "gemini";
  if (m.includes("grok")) return "grok";
  return "unknown";
}

const isDateish = (t: string) => /^\d{2,}$/.test(t);

/** claude-(fable|opus|sonnet|haiku)-<major>[-<minor>|.<minor>][-<yyyymmdd>], the older
 * claude-3-5-sonnet-20241022 order, bare aliases ("sonnet"), "claude-2.1". */
function humanizeClaude(id: string): string {
  let family: string | null = null;
  const version: string[] = [];
  const extras: string[] = [];
  for (const t of id.split(/[-_.]/).filter(Boolean)) {
    if (t === "claude" || t === "latest") continue;
    if (CLAUDE_FAMILIES.has(t)) {
      family = t;
      continue;
    }
    if (/^\d+$/.test(t)) {
      // 1–2 digit tokens are version parts; anything longer is a date stamp.
      if (t.length <= 2 && version.length < 2) version.push(t);
      continue;
    }
    extras.push(capWord(t));
  }
  return ["Claude", family && capWord(family), version.length ? version.join(".") : null, ...extras]
    .filter(Boolean)
    .join(" ");
}

/** gpt-5-codex → "GPT-5 Codex", gpt-4.1 → "GPT-4.1", gpt-4o-mini → "GPT-4o Mini",
 * chatgpt-4o-latest → "ChatGPT-4o"; the o-series stays lowercase verbatim. */
function humanizeOpenAI(id: string): string {
  if (/^o\d/.test(id)) return id;
  const isChat = id.startsWith("chatgpt");
  const [version, ...tail] = id.replace(/^(?:chat)?gpt-?/, "").split(/[-_]/).filter(Boolean);
  const prefix = isChat ? "ChatGPT" : "GPT";
  if (!version) return prefix;
  const words = tail.filter((t) => t !== "latest" && !isDateish(t)).map(capWord);
  return [`${prefix}-${version}`, ...words].join(" ");
}

/** "gemini-2.5-flash-lite" → "Gemini 2.5 Flash Lite", "grok-4" → "Grok 4". Version
 * tokens keep their dots; trailing build/date numbers ("002", "0709") are dropped. */
function humanizeBranded(brand: string, key: string, id: string): string {
  const words = id
    .split(/[-_]/)
    .filter((t) => t && t !== key && t !== "latest" && !isDateish(t))
    .map(capWord);
  return [brand, ...words].join(" ");
}

/**
 * Canonical display name for a raw model id, or null when the id carries no
 * information (null, "", "unknown", "<synthetic>") — callers decide what to show
 * then, usually the tool label alone. Unknown families pass through title-cased
 * with their original casing kept ("DeepSeek-R1" → "DeepSeek R1").
 */
export function humanizeModel(raw: string | null | undefined): string | null {
  const id = normalizeModelId(raw);
  if (NULL_IDS.has(id)) return null;
  switch (modelFamily(id)) {
    case "claude":
      return humanizeClaude(id);
    case "gpt":
      return humanizeOpenAI(id);
    case "gemini":
      return humanizeBranded("Gemini", "gemini", id);
    case "grok":
      return humanizeBranded("Grok", "grok", id);
    default: {
      const original = (raw ?? "").trim().replace(/^(?:[A-Za-z0-9_.-]+\/)+/, "");
      return titleCase(original);
    }
  }
}

/** "Claude Fable 5.1 · Claude Code", or just "Cursor" when the tool exposes no model. */
export function modelWithTool(model: string | null | undefined, tool: string | null | undefined): string {
  const m = humanizeModel(model);
  const t = toolLabel(tool);
  return m ? `${m} · ${t}` : t;
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

/** Structural subset of `Activity` (types/index.ts) so heartbeat-shaped objects fit too. */
export interface ActivityLike {
  projectAlias: string;
  tool: string;
  model?: string | null;
  startedAt: string;
}

export interface PresenceParts {
  /** Raw project alias as the tracker reports it — never re-cased. */
  project: string;
  /** Display label, e.g. "Claude Code". */
  tool: string;
  /** Display name, e.g. "Claude Fable 5.1"; null when the tool exposes no model. */
  model: string | null;
  /** "just now" / "12m" / "1h 42m" since `startedAt`. */
  elapsed: string;
}

/** The four things a presence line is built from — PresenceBlock lays them out on
 * separate lines; `presenceLine` joins them for toasts, modals and titles. */
export function presenceParts(activity: ActivityLike, now: number = Date.now()): PresenceParts {
  return {
    project: activity.projectAlias,
    tool: toolLabel(activity.tool),
    model: humanizeModel(activity.model),
    elapsed: elapsedShort(activity.startedAt, now),
  };
}

/** "vibehub · Claude Code · Claude Fable 5.1 · 1h 42m" — the one single-line
 * activity shape (toasts, connect modal, document titles). Model is dropped
 * entirely when missing/unknown rather than shown as a raw id or "Unknown". */
export function presenceLine(activity: ActivityLike, now: number = Date.now()): string {
  const p = presenceParts(activity, now);
  return [p.project, p.tool, p.model, p.elapsed].filter(Boolean).join(" · ");
}

/** "Online" / "Idle" / "Offline" — the status word PresenceBlock prints. */
export function presenceStatusLabel(status: "active" | "idle" | "offline" | null | undefined): string {
  if (status === "active") return "Online";
  if (status === "idle") return "Idle";
  return "Offline";
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatActiveTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Sep 3" — no year. The one shared shape for card/list dates sitewide. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

/** "Sep 3, 2026, 6:45 PM" — for "last seen" / device-token style timestamps. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
