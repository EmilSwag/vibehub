// Stats → tool rows. `UserStats.byModel` is already one bucket per (tool, model),
// so the profile's Steam-style tool list is a pure client-side group-by and needs
// no API change (round-6 plan, "Facts established before this plan").
//
// Pinned by web/src/lib/__checks__/toolRows.check.ts — run it after touching this
// file: `npx tsx web/src/lib/__checks__/toolRows.check.ts`.

import { humanizeModel, toolLabel } from "./format";
import type { StatByModel } from "../types";

/** One model inside a tool group. */
export interface ToolModelRow {
  /** Display name ("Claude Fable 5.1"); null when the tool reports no model. */
  label: string | null;
  /** One raw id from this bucket — for ModelGlyph's family lookup, never shown. */
  model: string;
  tokens: number;
  activeSeconds: number;
}

/** One tool the person has used: its totals plus the models it ran. */
export interface ToolRowGroup {
  /** One raw id from this group — for ToolGlyph's family lookup, never shown. */
  tool: string;
  /** Display name ("Quadcode AI"); also the group's identity. */
  label: string;
  tokens: number;
  activeSeconds: number;
  /** Per-model detail, same order rule as the groups. Never empty. */
  models: ToolModelRow[];
}

/** Hours desc, then tokens desc, then name — a stable order for equal rows.
 * Hours lead because that is what the rows are sorted by; tokens are fuel, and
 * only break a tie. Plain `<`/`>` on purpose: `localeCompare` without an explicit
 * locale follows the visitor's OS (see the note at the top of format.ts). */
function compare(
  a: { activeSeconds: number; tokens: number; label: string | null },
  b: { activeSeconds: number; tokens: number; label: string | null }
): number {
  if (b.activeSeconds !== a.activeSeconds) return b.activeSeconds - a.activeSeconds;
  if (b.tokens !== a.tokens) return b.tokens - a.tokens;
  const an = a.label ?? "";
  const bn = b.label ?? "";
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/**
 * Group `byModel` rows into one row per tool, hours desc.
 *
 * Grouped by *label*, not by raw id: the label is the row's visible identity, so
 * the same tool spelled two ways ("claude-code" from one machine, "claude_code"
 * from an older tracker) is one row, while two genuinely different unrecognised
 * tools keep their own. Models are merged the same way — "claude-sonnet-4.5" and
 * "claude-sonnet-4-5-20250929" humanize to one name and must not read as two
 * identical lines.
 */
export function groupStatsByTool(rows: StatByModel[]): ToolRowGroup[] {
  const groups = new Map<string, ToolRowGroup>();

  for (const row of rows) {
    const label = toolLabel(row.tool);
    let group = groups.get(label);
    if (!group) {
      group = { tool: row.tool, label, tokens: 0, activeSeconds: 0, models: [] };
      groups.set(label, group);
    }

    const tokens = row.tokensInput + row.tokensOutput;
    group.tokens += tokens;
    group.activeSeconds += row.activeSeconds;

    const modelLabel = humanizeModel(row.model);
    const seen = group.models.find((m) => m.label === modelLabel);
    if (seen) {
      seen.tokens += tokens;
      seen.activeSeconds += row.activeSeconds;
    } else {
      group.models.push({ label: modelLabel, model: row.model, tokens, activeSeconds: row.activeSeconds });
    }
  }

  const list = [...groups.values()];
  for (const group of list) group.models.sort(compare);
  return list.sort(compare);
}

/**
 * Does expanding this row show anything? A tool whose only bucket has no model
 * (Cursor, Grok, a Quadcode chat that never named one) would just repeat its own
 * numbers, so it stays a plain row instead of an empty disclosure.
 */
export function isExpandable(group: ToolRowGroup): boolean {
  return group.models.some((m) => m.label !== null);
}
