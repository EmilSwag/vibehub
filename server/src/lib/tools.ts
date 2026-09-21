/**
 * Tool-identity facts, deliberately dependency-free.
 *
 * This lives apart from `schemas.ts` so that modules which only need to know what a
 * tool *is* (`sessions.ts`, `tracker-me.ts`) do not pull zod — and the whole request
 * schema surface — into the fixtures-only harness that pins them.
 */

/**
 * Tools with NO measured token counter in any source the tracker reads.
 *
 * Quadcode is collected natively (activity + model) but its chat format carries no
 * counts at all: `meta_info.max_tokens` is a boolean flag and `cluster_node_info` is a
 * node id. So its usage is UNKNOWN, and unknown is never rendered as a number —
 * neither a token total nor a cost. Entries claiming counts for these tools are
 * rejected rather than zeroed, because a zero would be read as "measured nothing".
 *
 * Cursor and Windsurf arrive the same way for the same reason. Both vendors publish a
 * hook system that reports which model ran and when a turn started or finished, and
 * neither reports a token count; the APIs that do (Cursor's team admin API, Windsurf's
 * CascadeAnalytics) are team-scoped receivers of what already happened, not a local
 * feed, and this product does not call them. A day spent entirely in one of these tools
 * therefore reports `tokens: null` and `estimatedUsd: null` — unknown, not zero.
 *
 * This list must stay in step with the tracker's own `TOKENLESS_TOOLS`
 * (tracker/src/privacy.ts). A tool missing here would have a claimed count accepted by
 * the API even though the tracker refuses to send one.
 */
export const TOKENLESS_TOOLS = ["quadcode", "cursor", "windsurf"] as const;

export const isTokenlessTool = (tool: string | null | undefined): boolean =>
  tool !== null && tool !== undefined && (TOKENLESS_TOOLS as readonly string[]).includes(tool);

/**
 * The refusal text, shared so the two wire paths cannot drift apart.
 *
 * Round 6 fix F-E: it used to hang off `usageEntrySchema` alone, which left the legacy
 * top-level `tokensInputDelta`/`tokensOutputDelta` pair on `heartbeatSchema` with no tool
 * guard at all — a forged body naming a tokenless tool was accepted (200), attributed,
 * priced and levelled. Both paths now quote this one constant.
 */
export const TOKENLESS_USAGE_MESSAGE = "usage is not reportable for this tool";

/**
 * Does this body actually CLAIM a count? Absent and explicit-zero deltas claim nothing,
 * so they are not a violation: a legacy heartbeat carries the pair unconditionally, and
 * refusing `0` would drop presence over a field that attributes nothing. Only a positive
 * number is a measurement claim.
 */
export const claimsTokens = (input?: number | null, output?: number | null): boolean =>
  (typeof input === "number" && input > 0) || (typeof output === "number" && output > 0);

/**
 * THE token chokepoint. Every path that can turn a request field into a stored count runs
 * this predicate before crediting anything:
 *
 *   1. `usageEntrySchema`   — per-entry `usage[]` (rejects the entry outright, zero or not:
 *                             an entry exists only to carry counts, so a tokenless one is
 *                             meaningless rather than merely empty);
 *   2. `heartbeatSchema`    — the legacy top-level pair (rejects a positive claim);
 *   3. `routes/tracker.ts`  — zeroes the legacy pair before it reaches `Session`;
 *   4. `lib/sessions.ts`    — `foldSessionIntoDailyStat` / `foldUsageIntoDailyStat` refuse
 *                             to write tokens on a tokenless row even if one got this far.
 *
 * 3 and 4 are deliberate redundancy: the wire guard is the loud one, and the accounting
 * guards are what make "a tokenless tool's counts are never attributed" true of the
 * database rather than of one validator.
 */
export const refusesTokenClaim = (
  tool: string | null | undefined, input?: number | null, output?: number | null
): boolean => isTokenlessTool(tool) && claimsTokens(input, output);
