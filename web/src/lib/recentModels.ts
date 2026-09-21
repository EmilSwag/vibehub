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
import { estimateTokenCost } from "./tokenCost";
import type { TokenCostEstimate } from "./tokenCost";
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
 * Tools that report no measured token count. Quadcode AI's logs carry none: the
 * current tracker sends activity and model only (tokens absent, never estimated), so
 * a zero on such a row means "not reported", and the UI says so. A non-zero figure can
 * only be history from the retired chars/4 estimate and stays marked ("~") rather than
 * passed off as measured.
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

/** Opt-in cost attachment keeps the existing grouping/count contract unchanged. */
export interface PricedRecentModelRow extends RecentModelRow {
  cost: TokenCostEstimate;
  byTool: (RecentModelToolBucket & { cost: TokenCostEstimate })[];
}

/**
 * A display label can fold DIFFERENT exact IDs (and even unverified aliases).
 * Index the original input/output records by the same label + raw tool key, then
 * estimate each displayed subtotal from only its own records. The representative
 * `group.model`, humanized title, tool family and current presence never set a rate.
 */
export function groupStatsByModelWithCosts(rows: StatByModel[]): PricedRecentModelRow[] {
  const sources = new Map<string, Map<string, StatByModel[]>>();
  for (const row of rows) {
    const label = modelRowLabel(row.tool, row.model);
    let tools = sources.get(label);
    if (!tools) {
      tools = new Map();
      sources.set(label, tools);
    }
    const usage = tools.get(row.tool);
    if (usage) usage.push(row);
    else tools.set(row.tool, [row]);
  }

  return groupStatsByModel(rows).map((group) => {
    const tools = sources.get(group.label)!;
    return {
      ...group,
      cost: estimateTokenCost([...tools.values()].flat(), group.tokens),
      byTool: group.byTool.map((bucket) => ({
        ...bucket,
        cost: estimateTokenCost(tools.get(bucket.tool), bucket.tokens),
      })),
    };
  });
}

/** "18.4 hrs" — Steam's own unit for a lifetime total, one decimal, never "0.0". */
export function formatHoursOnRecord(seconds: number): string {
  const hours = seconds / 3600;
  // Under an hour the decimal is noise ("0.1 hrs" for seven minutes, next to a Stats
  // tile that says "7m"), so minutes carry until a full hour is on record.
  if (hours >= 1) return `${hours.toFixed(1)} hrs`;
  return `${Math.max(0, Math.round(seconds / 60))} min`;
}

// ---- the block's interaction contract (round 8, section F) ----
//
// The three helpers below are the parts of RecentModels that were wrong in
// production and are worth pinning. They are pure on purpose: the component holds
// them as state and props, and a plain assertion script can still check them.

/**
 * The picked row, as a value that changes on every *request* rather than only when
 * the row changes.
 *
 * The Stats "Top model" tile can ask for a row that is already picked — pressed a
 * second time after the reader scrolled away, it means "take me back there". A bare
 * `string | null` cannot say that: React bails out of a state update to the same
 * string, the row's prop never changes, and the effect that owns `scrollIntoView`
 * never re-runs, so the second press does nothing at all. The tick makes every
 * request a distinct value.
 */
export interface ModelSelection {
  /** Label of the picked row, or null when nothing is picked. */
  label: string | null;
  /** Bumped on every request, including a repeat of the same label. */
  tick: number;
}

export const NO_MODEL_SELECTION: ModelSelection = { label: null, tick: 0 };

/** Pick `label`, or clear with null. Always a fresh tick, so a repeat still lands. */
export function requestSelection(current: ModelSelection, label: string | null): ModelSelection {
  return { label, tick: current.tick + 1 };
}

/**
 * The value one row watches: the tick it was picked at, or null when it is not the
 * picked row. Two requests for the same row hand it two different numbers, and that
 * is what re-runs its scroll-into-view effect.
 */
export function selectionTickFor(selection: ModelSelection, label: string): number | null {
  return selection.label === label ? selection.tick : null;
}

/**
 * Does collapsing the list pull the ground out from under the keyboard?
 *
 * Only the first `previewRows` rows survive a collapse. A row past them unmounts, and
 * if it held focus the browser drops focus on `<body>` — the next Tab restarts from
 * the top of the document, which is where an Escape press used to leave a reader who
 * had walked down to row 6. `focusedRow` is -1 when focus is not on a row at all.
 */
export function collapseWouldDropFocus(focusedRow: number, previewRows: number): boolean {
  return focusedRow >= previewRows;
}

/** What a model row's button expands, and whether its detail can be read. */
export interface ModelRowAria {
  expanded: boolean;
  /** Id of the region this press opens — the list, or this row's own detail. */
  controls: string;
  /** The detail is collapsed and must be kept out of the accessibility tree. */
  detailHidden: boolean;
}

/**
 * The row button means two different things depending on what the reader can see,
 * and `aria-expanded` is only half the contract: it needs `aria-controls` naming the
 * region it opens. Collapsed, that region is the whole list; expanded, it is this
 * row's per-tool detail.
 *
 * The detail collapses with `grid-template-rows: 0fr`, which leaves it perfectly
 * readable to a screen reader — height is not visibility — so it has to be hidden
 * explicitly too, or all eight rows recite their per-tool breakdown at all times.
 * `aria-hidden` is enough and `inert` is not used: the detail holds text, never a
 * focusable element, so there is no tab stop to remove and nothing can be focused
 * inside an aria-hidden subtree.
 */
export function modelRowAria(args: {
  reveals: boolean;
  open: boolean;
  listId: string;
  detailId: string;
}): ModelRowAria {
  const { reveals, open, listId, detailId } = args;
  return reveals
    ? { expanded: false, controls: listId, detailHidden: true }
    : { expanded: open, controls: detailId, detailHidden: !open };
}
