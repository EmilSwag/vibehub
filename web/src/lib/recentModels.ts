// Stats → the profile's Steam-style "Recent Activity" model rows (round 7).
//
// `UserStats.byModel` is one bucket per (tool, model). Steam lists *games*, one row
// each, with the launchers folded in — so here the row is the **model**, and the
// tools that ran it become the sub-line. Pure client-side group-by; the only server
// addition it needs is `lastActiveAt`, and it degrades without it.
//
// Pinned by web/src/lib/__checks__/recentModels.check.ts — run it after touching this
// file: `npx tsx web/src/lib/__checks__/recentModels.check.ts`.

import { humanizeModel, toolFamily, toolLabel } from "./format";
import type { StatByModel } from "../types";

/**
 * One tool's share of a model row — what the merge used to throw away.
 *
 * The row still reports the totals, because that is what the collapsed list shows;
 * this is the same arithmetic kept un-summed so the expanded row can answer "and how
 * much of that was Cursor?" without a second request (round 8).
 */
export interface RecentModelToolBucket {
  /** Raw tool id, as the tracker reported it. */
  tool: string;
  tokens: number;
  activeSeconds: number;
  /** Newest moment this tool ran this model; null on a pre-round-7 server. */
  lastActiveAt: string | null;
  /** This tool's token figure is the tracker's estimate (see `isEstimatedTool`). */
  estimated: boolean;
}

/** One model the person has used, with every tool that ran it merged in. */
export interface RecentModelRow {
  /** Visible identity, and the group key: the model's display name, or the tool's
   *  name when that tool exposes no model (Cursor, a fresh Quadcode chat). */
  label: string;
  /** One raw model id from this group — for ModelGlyph's family lookup, never shown.
   *  null when the row is a tool with no model at all. */
  model: string | null;
  /** Raw tool ids that ran this model, most hours first. Never empty.
   *  Always `byTool.map((b) => b.tool)` — kept as its own field because the sub-line
   *  and the glyph lookup only ever want the ids. */
  tools: string[];
  /** The same tools un-merged, in the same order — the expanded row's detail line. */
  byTool: RecentModelToolBucket[];
  tokens: number;
  activeSeconds: number;
  /** Newest moment any contributing bucket was seen; null on a pre-round-7 server. */
  lastActiveAt: string | null;
  /** At least one contributing tool reports estimated tokens (see `isEstimatedTool`). */
  estimated: boolean;
}

/**
 * Tools whose token figures are the tracker's estimate, not a measured count:
 * Quadcode AI's logs carry no token counts, so the tracker sends chars/4 and the
 * UI must mark it ("~") rather than pass it off as measured.
 */
const ESTIMATED_TOOL_FAMILIES = new Set(["quadcode"]);

export function isEstimatedTool(tool: string | null | undefined): boolean {
  return ESTIMATED_TOOL_FAMILIES.has(toolFamily(tool));
}

/**
 * The row identity a (tool, model) bucket belongs to — the model's display name, or
 * the tool's name when the tool exposes no model. Exported because the "Currently in
 * use" test has to key presence the same way: a live `PresenceTool` is matched to a
 * row by running its (tool, model) through this exact function.
 */
export function modelRowLabel(tool: string | null | undefined, model: string | null | undefined): string {
  return humanizeModel(model) ?? toolLabel(tool);
}

/** Hours desc, then tokens desc, then name — a stable order for equal rows. Plain
 * `<`/`>` on purpose (see the locale note at the top of format.ts). */
function byHours(a: RecentModelRow, b: RecentModelRow): number {
  if (b.activeSeconds !== a.activeSeconds) return b.activeSeconds - a.activeSeconds;
  if (b.tokens !== a.tokens) return b.tokens - a.tokens;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * Group `byModel` into one row per model, most recently used first.
 *
 * Grouped by *label*, not by raw id: the label is the row's visible identity, so
 * "claude-sonnet-4.5" and "claude-sonnet-4-5-20250929" are one row rather than two
 * identical-looking lines, and the same model driven from two tools is one row with
 * both tools on its sub-line.
 *
 * Order is "last used", the way Steam's Recent Activity reads. A server that predates
 * `lastActiveAt` sends none, and the list falls back to hours desc — the same order
 * round 6 used — instead of an arbitrary one.
 */
export function groupStatsByModel(rows: StatByModel[]): RecentModelRow[] {
  const groups = new Map<string, RecentModelRow>();
  // Per row: raw tool id → that tool's own totals. The row's numbers are the sum of
  // these; keeping the parts is what lets the expanded row split itself by tool.
  const toolBuckets = new Map<string, Map<string, RecentModelToolBucket>>();

  for (const row of rows) {
    const label = modelRowLabel(row.tool, row.model);
    let group = groups.get(label);
    if (!group) {
      group = {
        label,
        model: humanizeModel(row.model) === null ? null : row.model,
        tools: [],
        byTool: [],
        tokens: 0,
        activeSeconds: 0,
        lastActiveAt: null,
        estimated: false,
      };
      groups.set(label, group);
      toolBuckets.set(label, new Map());
    }

    const tokens = row.tokensInput + row.tokensOutput;
    const estimated = isEstimatedTool(row.tool);
    const seen = row.lastActiveAt ?? null;

    group.tokens += tokens;
    group.activeSeconds += row.activeSeconds;
    group.estimated ||= estimated;
    if (seen && (group.lastActiveAt === null || seen > group.lastActiveAt)) group.lastActiveAt = seen;

    const buckets = toolBuckets.get(label)!;
    const bucket = buckets.get(row.tool);
    if (!bucket) {
      buckets.set(row.tool, {
        tool: row.tool,
        tokens,
        activeSeconds: row.activeSeconds,
        lastActiveAt: seen,
        estimated,
      });
    } else {
      bucket.tokens += tokens;
      bucket.activeSeconds += row.activeSeconds;
      bucket.estimated ||= estimated;
      if (seen && (bucket.lastActiveAt === null || seen > bucket.lastActiveAt)) bucket.lastActiveAt = seen;
    }
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.byTool = [...toolBuckets.get(group.label)!.values()].sort(
      (a, b) => b.activeSeconds - a.activeSeconds || (a.tool < b.tool ? -1 : 1),
    );
    group.tools = group.byTool.map((bucket) => bucket.tool);
  }

  // Recency first when the server knows it; hours otherwise. A bucket with no date
  // on an otherwise dated response sorts last rather than jumping to the top.
  const dated = list.some((row) => row.lastActiveAt !== null);
  if (!dated) return list.sort(byHours);
  return list.sort((a, b) => {
    const at = a.lastActiveAt ?? "";
    const bt = b.lastActiveAt ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return byHours(a, b);
  });
}

/** "18.4 hrs" — Steam's own unit for a lifetime total, one decimal, never "0.0". */
export function formatHoursOnRecord(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 0.1) return `${hours.toFixed(1)} hrs`;
  return `${Math.max(0, Math.round(seconds / 60))} min`;
}
