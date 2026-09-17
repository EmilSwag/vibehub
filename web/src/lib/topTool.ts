// Pure "Top tool" derivation — see meta/plans/public-last-online-top-tool.md, step 3.
// Prefers the server's own pre-aggregated `byTool` rollup; falls back to summing
// `byModel` per tool client-side when a server predates that field — the same
// optional-field convention `StatByModel.lastActiveAt` already established.
// Pinned by web/src/lib/__checks__/topTool.check.ts, run it after touching anything
// below: `node --import tsx src/lib/__checks__/topTool.check.ts` (from web/).
import type { StatByModel, StatByTool, UserStats } from "../types";

/** The later of two optional/nullable ISO timestamps; `null` when neither is set. */
function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** `byModel` summed per `tool` — the fallback path for a server that predates `byTool`. */
function aggregateByModel(byModel: StatByModel[]): StatByTool[] {
  const byTool = new Map<string, StatByTool>();
  for (const row of byModel) {
    const existing = byTool.get(row.tool);
    if (existing) {
      existing.tokensInput += row.tokensInput;
      existing.tokensOutput += row.tokensOutput;
      existing.activeSeconds += row.activeSeconds;
      existing.lastActiveAt = laterOf(existing.lastActiveAt, row.lastActiveAt);
    } else {
      byTool.set(row.tool, {
        tool: row.tool,
        tokensInput: row.tokensInput,
        tokensOutput: row.tokensOutput,
        activeSeconds: row.activeSeconds,
        lastActiveAt: row.lastActiveAt ?? null,
      });
    }
  }
  return Array.from(byTool.values());
}

/**
 * Per-tool rollup, ranked. Prefers `stats.byTool` when present — including an
 * explicitly empty `[]`, a real "nothing in range" answer, never treated the same as
 * an absent field — otherwise aggregates `byModel` per tool (see `aggregateByModel`).
 * Sort: active seconds desc, then total tokens (input+output) desc, then tool name
 * asc — the last two are tie-breaks only, but they make the order fully deterministic
 * regardless of which source produced the buckets.
 */
export function toolBuckets(stats: Pick<UserStats, "byModel" | "byTool">): StatByTool[] {
  const buckets = stats.byTool !== undefined ? stats.byTool : aggregateByModel(stats.byModel);
  return [...buckets].sort((a, b) => {
    if (b.activeSeconds !== a.activeSeconds) return b.activeSeconds - a.activeSeconds;
    const totalA = a.tokensInput + a.tokensOutput;
    const totalB = b.tokensInput + b.tokensOutput;
    if (totalB !== totalA) return totalB - totalA;
    return a.tool.localeCompare(b.tool);
  });
}

/**
 * The server's own `topTool` when it sent one, else the top `toolBuckets()` entry,
 * else `null`. An explicit server `topTool: null` still falls through to the derived
 * bucket leader (`??` doesn't distinguish it from a missing field) — a leader is
 * either named or derived, never left unresolved when the data to derive one exists.
 */
export function topToolOf(stats: Pick<UserStats, "byModel" | "byTool" | "topTool">): string | null {
  return stats.topTool ?? toolBuckets(stats)[0]?.tool ?? null;
}

/**
 * The leading tool's share of total active time across every bucket, as 0-1. `null`
 * when there is no active time to divide — no buckets, or every bucket sits at 0s.
 */
export function topToolShare(stats: Pick<UserStats, "byModel" | "byTool">): number | null {
  const buckets = toolBuckets(stats);
  const total = buckets.reduce((sum, b) => sum + b.activeSeconds, 0);
  if (total === 0) return null;
  return buckets[0].activeSeconds / total;
}
