// The five AI tools VibeHub tracks, and the facts every surface has to agree on.
//
// ONE table, derived everywhere. The connect copy (`connectPrompt.ts`), the tokenless
// rendering (`recentModels.ts`, `sources.ts`, `RecentModels.tsx`, `TrackingStatus.tsx`,
// `ConnectCelebration.tsx`) and the hook opt-in block all read this file, so a tool
// cannot be supported in one place and missing in another. A view that spells the list
// out by hand is a check failure, not a style preference — `connectUx.check.mjs`
// rejects any visible literal that names two supported tools.
//
// Contract: `docs/cursor-windsurf-hooks-report.md` §1-§2 and `docs/ARCHITECTURE.md`
// §4.6 (attested receiver) / §4.7 (hook producer). Cursor and Windsurf have no
// adapter and no log reader: a short-lived producer that their own IDE spawns appends
// one bounded record per turn, and the daemon only ever reads its own inbox.
//
// Pinned by `lib/__checks__/supportedTools.check.ts`, which also pins the tokenless
// set against the server's own `TOKENLESS_TOOLS` so the two can never drift again.

import { toolFamily } from "./format";
import type { ToolFamily } from "./format";

/** How VibeHub learns that a tool ran. */
export type ToolFeed = "log" | "hook";

export interface SupportedTool {
  /** Tracker/server tool id — and the family its brand mark is keyed by. */
  readonly id: ToolFamily;
  /** The name prose uses. */
  readonly copyName: string;
  /** Parenthetical the support line adds once, where it earns its space ("GPT models"). */
  readonly qualifier: string | null;
  readonly feed: ToolFeed;
  /** False when the vendor reports no token counts at all — unknown, never zero. */
  readonly measuresTokens: boolean;
  /**
   * True only for a tool whose non-zero history came from the retired chars/4
   * estimate. Cursor and Windsurf never had one: their records carry no `measured`
   * flag, no counts and no `estimated` field at all (hooks report, Round 5.1 row 1).
   */
  readonly hasLegacyEstimate: boolean;
  /** The user-scope file `hooks install` writes. Hook feeds only. */
  readonly hookFile: string | null;
}

export const SUPPORTED_TOOLS: readonly SupportedTool[] = [
  { id: "claude-code", copyName: "Claude Code", qualifier: null, feed: "log", measuresTokens: true, hasLegacyEstimate: false, hookFile: null },
  { id: "codex", copyName: "Codex", qualifier: "GPT models", feed: "log", measuresTokens: true, hasLegacyEstimate: false, hookFile: null },
  { id: "quadcode", copyName: "Quadcode AI", qualifier: null, feed: "log", measuresTokens: false, hasLegacyEstimate: true, hookFile: null },
  { id: "cursor", copyName: "Cursor", qualifier: null, feed: "hook", measuresTokens: false, hasLegacyEstimate: false, hookFile: "~/.cursor/hooks.json" },
  { id: "windsurf", copyName: "Windsurf", qualifier: null, feed: "hook", measuresTokens: false, hasLegacyEstimate: false, hookFile: "~/.codeium/windsurf/hooks.json" },
];

export const LOG_TOOLS = SUPPORTED_TOOLS.filter((tool) => tool.feed === "log");
export const HOOK_TOOLS = SUPPORTED_TOOLS.filter((tool) => tool.feed === "hook");
export const MEASURED_TOOLS = SUPPORTED_TOOLS.filter((tool) => tool.measuresTokens);
export const TOKENLESS_TOOLS = SUPPORTED_TOOLS.filter((tool) => !tool.measuresTokens);
export const LEGACY_ESTIMATE_TOOLS = SUPPORTED_TOOLS.filter((tool) => tool.hasLegacyEstimate);

/** Hook tool ids, as the CLI's `hooks install <tool>` argument spells them. */
export const HOOK_TOOL_IDS = HOOK_TOOLS.map((tool) => tool.id);
export type HookToolId = (typeof HOOK_TOOL_IDS)[number];

export function isHookToolId(value: unknown): value is HookToolId {
  return typeof value === "string" && (HOOK_TOOL_IDS as readonly string[]).includes(value);
}

/** "A", "A and B", "A, B and C" — the serial form this product's copy already uses. */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The prose name list for a subset of the table. Copy never hardcodes these. */
export const namesOf = (tools: readonly SupportedTool[]): string => joinAnd(tools.map((tool) => tool.copyName));

/** The same list with each tool's parenthetical, for the one line that carries them. */
export const qualifiedNamesOf = (tools: readonly SupportedTool[]): string =>
  joinAnd(tools.map((tool) => (tool.qualifier ? `${tool.copyName} (${tool.qualifier})` : tool.copyName)));

/**
 * Named in the support copy as NOT tracked, with the reason.
 *
 * Deliberately outside `SUPPORTED_TOOLS`: there is no feed, no mark slot and no
 * tokenless semantics to define, because there is nothing to read. It lives here
 * anyway so the support line contains no tool name typed in by hand.
 */
export const UNTRACKED_TOOLS = [
  { copyName: "ChatGPT", reason: "browser and app leave no local source to read" },
] as const;

/** "X is not tracked: <reason>." for each, as the support line renders them. */
export const untrackedClause = (): string =>
  UNTRACKED_TOOLS.map((tool) => `${tool.copyName} is not tracked: ${tool.reason}.`).join(" ");

/** Every distinct display name a view is forbidden to spell out by hand. */
export const SUPPORTED_TOOL_COPY_NAMES = SUPPORTED_TOOLS.map((tool) => tool.copyName);

const TOKENLESS_FAMILIES: ReadonlySet<ToolFamily> = new Set(TOKENLESS_TOOLS.map((tool) => tool.id));
const LEGACY_ESTIMATE_FAMILIES: ReadonlySet<ToolFamily> = new Set(LEGACY_ESTIMATE_TOOLS.map((tool) => tool.id));

/**
 * This tool reports no measured token count, so a zero from it means "not reported"
 * and can never be priced. Aliases fold through `toolFamily`, exactly as every other
 * tool lookup in the client does.
 */
export function isTokenlessTool(tool: string | null | undefined): boolean {
  return TOKENLESS_FAMILIES.has(toolFamily(tool));
}

/**
 * This tool can still carry a non-zero figure from the retired chars/4 estimate, so
 * a number from it is marked "~" rather than passed off as measured. Strictly
 * narrower than `isTokenlessTool`: every legacy-estimate tool is tokenless, not the
 * other way round.
 */
export function isLegacyEstimateTool(tool: string | null | undefined): boolean {
  return LEGACY_ESTIMATE_FAMILIES.has(toolFamily(tool));
}

/** The one phrase for an unmeasured token figure. Never "0 tokens". */
export const TOKENS_NOT_REPORTED = "tokens not reported";

export const TOKENS_NOT_REPORTED_TITLE =
  `${namesOf(TOKENLESS_TOOLS)} report no token counts. Older ${namesOf(LEGACY_ESTIMATE_TOOLS)} figures are legacy estimates.`;
