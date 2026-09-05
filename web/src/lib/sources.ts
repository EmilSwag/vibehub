// TrackerStatus.sources → the two things the connect celebration and the tracking
// panel both show: what you have run today, and which models you have run.
//
// `sources` is already one row per (tool, model) seen in the last 7 days, most
// recently seen first, and it carries today's tokens and today's active seconds —
// so the "you are connected, here is your counter" moment needs no new endpoint
// (round-7 findings).

import { humanizeModel, toolLabel } from "./format";
import { isEstimatedTool, modelRowLabel } from "./recentModels";
import type { TrackerSource } from "../types";

export interface TodayTotals {
  tokens: number;
  activeSeconds: number;
  /** At least one contributing tool estimates its token counts (Quadcode AI). */
  estimated: boolean;
}

/** Everything the tracker has reported for today, summed across tools and models. */
export function sumToday(sources: TrackerSource[]): TodayTotals {
  return sources.reduce<TodayTotals>(
    (acc, s) => ({
      tokens: acc.tokens + s.tokensToday,
      activeSeconds: acc.activeSeconds + s.activeSecondsToday,
      estimated: acc.estimated || (s.tokensToday > 0 && isEstimatedTool(s.tool)),
    }),
    { tokens: 0, activeSeconds: 0, estimated: false }
  );
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
