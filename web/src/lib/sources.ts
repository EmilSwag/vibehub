// TrackerStatus.sources → the two things the connect celebration and the tracking
// panel both show: what you have run today, and which models you have run.
//
// `sources` is already one row per (tool, model) seen in the last 7 days, most
// recently seen first, and it carries today's tokens and today's active seconds —
// so the "you are connected, here is your counter" moment needs no new endpoint
// (round-7 findings).

import { humanizeModel, toolLabel } from "./format";
import { modelRowLabel } from "./recentModels";
import { isLegacyEstimateTool, isTokenlessTool } from "./supportedTools";
import type { TrackerSource } from "../types";

export interface TodayTotals {
  tokens: number;
  activeSeconds: number;
  /** At least one contributing tool carries a figure from the retired estimate. */
  estimated: boolean;
  /**
   * False when EVERY contributing source is a tokenless tool: the sum is then not a
   * measurement of anything and must read "tokens not reported" rather than "0".
   * A day with no sources at all has nothing to misreport and stays reported, so a
   * fresh account still shows a plain zero.
   */
  tokensReported: boolean;
  /** QA R2: cache reads today, shown as a secondary "cached" figure. 0 when unknown. */
  cachedTokens: number;
}

/** Everything the tracker has reported for today, summed across tools and models. */
export function sumToday(sources: TrackerSource[]): TodayTotals {
  const totals = sources.reduce<TodayTotals>(
    (acc, s) => ({
      tokens: acc.tokens + s.tokensToday,
      activeSeconds: acc.activeSeconds + s.activeSecondsToday,
      estimated: acc.estimated || (s.tokensToday > 0 && isLegacyEstimateTool(s.tool)),
      tokensReported: acc.tokensReported || !isTokenlessTool(s.tool),
      cachedTokens: acc.cachedTokens + (Number.isFinite(s.cachedTokensToday) ? Math.max(0, s.cachedTokensToday!) : 0),
    }),
    { tokens: 0, activeSeconds: 0, estimated: false, tokensReported: false, cachedTokens: 0 }
  );
  return sources.length === 0 ? { ...totals, tokensReported: true } : totals;
}

export interface SourceModel {
  /** Display name — the model, or the tool when that tool exposes none. */
  label: string;
  /** Raw model id for ModelGlyph, or null for a tool with no model. */
  model: string | null;
  /** Raw tool id — the glyph fallback, and the sub-label. */
  tool: string;
  /** The tool that ran it, spelled out. */
  toolLabel: string;
}

/**
 * One entry per distinct model the tracker has seen, most recently seen first —
 * keyed exactly the way profile rows are, so the celebration and the profile never
 * disagree about what counts as "a model".
 */
export function modelsOfSources(sources: TrackerSource[]): SourceModel[] {
  const seen = new Set<string>();
  const out: SourceModel[] = [];
  for (const s of sources) {
    const label = modelRowLabel(s.tool, s.model);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      model: humanizeModel(s.model) === null ? null : s.model,
      tool: s.tool,
      toolLabel: toolLabel(s.tool),
    });
  }
  return out;
}
