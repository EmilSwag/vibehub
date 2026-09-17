/**
 * Per-tool aggregation for `GET /users/:username/stats` (round 20).
 *
 * The stats route already folds DailyStat rows into `byModel` buckets keyed by
 * (model, tool). "Which tool does this person use the most" is the same rows folded
 * one level further — by tool alone — so the web can answer the PO's question
 * ("which IDE do I use most") with a single field instead of re-deriving it.
 *
 * Ranking is by active time first (hours are the primary measure in DESIGN.md — tokens
 * are fuel, not rank), tokens second (so a tool with only usage rows still wins over
 * one with nothing), tool id third for a stable order. Prisma-free on purpose so the
 * check file can pin the contract without a database.
 */

export interface ToolBucketInput {
  tool: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
  lastActiveAt: string | null;
}

export interface StatByTool {
  tool: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
  /** ISO of the most recent day this tool saw activity, or null. */
  lastActiveAt: string | null;
}

function tokensOf(b: { tokensInput: number; tokensOutput: number }): number {
  return b.tokensInput + b.tokensOutput;
}

/** Later ISO string wins; null loses to anything. */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function compareToolBuckets(a: StatByTool, b: StatByTool): number {
  if (b.activeSeconds !== a.activeSeconds) return b.activeSeconds - a.activeSeconds;
  const dt = tokensOf(b) - tokensOf(a);
  if (dt !== 0) return dt;
  return a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0;
}

/** Folds per-(model, tool) buckets into per-tool buckets, sorted most-used first. */
export function foldByTool(buckets: readonly ToolBucketInput[]): StatByTool[] {
  const byTool = new Map<string, StatByTool>();
  for (const b of buckets) {
    const tool = b.tool.trim();
    if (!tool) continue;
    const cur = byTool.get(tool) ?? { tool, tokensInput: 0, tokensOutput: 0, activeSeconds: 0, lastActiveAt: null };
    cur.tokensInput += Math.max(0, b.tokensInput || 0);
    cur.tokensOutput += Math.max(0, b.tokensOutput || 0);
    cur.activeSeconds += Math.max(0, b.activeSeconds || 0);
    cur.lastActiveAt = laterOf(cur.lastActiveAt, b.lastActiveAt);
    byTool.set(tool, cur);
  }
  return [...byTool.values()].sort(compareToolBuckets);
}

/** The most-used tool id, or null when there is nothing on record. */
export function topToolOf(byTool: readonly StatByTool[]): string | null {
  return byTool[0]?.tool ?? null;
}
