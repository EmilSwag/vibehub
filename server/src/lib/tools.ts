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
