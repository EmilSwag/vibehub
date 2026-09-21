// Contract pins for lib/recentModels.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/recentModels.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).

import {
  collapseWouldDropFocus,
  formatHoursOnRecord,
  groupStatsByModel,
  modelRowAria,
  modelRowLabel,
  NO_MODEL_SELECTION,
  requestSelection,
  selectionTickFor,
} from "../recentModels";
import { isLegacyEstimateTool, isTokenlessTool } from "../supportedTools";
import type { StatByModel } from "../../types";

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} → ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

const row = (
  tool: string,
  model: string,
  tokensInput: number,
  tokensOutput: number,
  activeSeconds: number,
  lastActiveAt?: string | null
): StatByModel =>
  lastActiveAt === undefined
    ? { tool, model, tokensInput, tokensOutput, activeSeconds }
    : { tool, model, tokensInput, tokensOutput, activeSeconds, lastActiveAt };

// ---- empty ----
eq("groupStatsByModel([])", groupStatsByModel([]), []);

// ---- one row per model; the tools that ran it merge onto the sub-line ----
const merged = groupStatsByModel([
  row("claude-code", "claude-opus-5", 500, 1500, 3600, "2026-09-04T00:00:00.000Z"),
  row("codex", "claude-opus-5", 100, 200, 7200, "2026-09-02T00:00:00.000Z"),
  row("quadcode", "claude-fable-5-1", 200, 800, 5400, "2026-09-05T00:00:00.000Z"),
]);
eq(
  "one row per model, most recently used first",
  merged.map((r) => r.label),
  ["Claude Fable 5.1", "Claude Opus 5"]
);
eq("tools merge, most hours first", merged[1].tools, ["codex", "claude-code"]);
eq("hours and tokens sum across tools", [merged[1].activeSeconds, merged[1].tokens], [10_800, 2300]);
eq("lastActiveAt is the newest contributing bucket", merged[1].lastActiveAt, "2026-09-04T00:00:00.000Z");

// ---- the merge keeps its parts: `byTool` is what the expanded row splits into ----
eq(
  "byTool keeps each tool's own numbers, hours desc",
  merged[1].byTool,
  [
    { tool: "codex", tokens: 300, activeSeconds: 7200, lastActiveAt: "2026-09-02T00:00:00.000Z", estimated: false, tokenless: false },
    { tool: "claude-code", tokens: 2000, activeSeconds: 3600, lastActiveAt: "2026-09-04T00:00:00.000Z", estimated: false, tokenless: false },
  ]
);
eq("tools is byTool's ids, in the same order", merged[1].tools, merged[1].byTool.map((b) => b.tool));
eq(
  "byTool sums to the row",
  [
    merged[1].byTool.reduce((n, b) => n + b.activeSeconds, 0),
    merged[1].byTool.reduce((n, b) => n + b.tokens, 0),
  ],
  [merged[1].activeSeconds, merged[1].tokens]
);
eq("a tool's estimate flag rides its own bucket", merged[0].byTool[0].estimated, true);

// Two raw ids that humanize to one name are one row — and one tool bucket, summed.
const oneTool = groupStatsByModel([
  row("claude-code", "claude-sonnet-4.5", 100, 100, 600, "2026-09-01T00:00:00.000Z"),
  row("claude-code", "claude-sonnet-4-5-20250929", 50, 50, 300, "2026-09-03T00:00:00.000Z"),
]);
eq(
  "one bucket per tool, not per raw model id",
  oneTool[0].byTool,
  [{ tool: "claude-code", tokens: 300, activeSeconds: 900, lastActiveAt: "2026-09-03T00:00:00.000Z", estimated: false, tokenless: false }]
);

// ---- tokenless (no counts at all) is a WIDER set than legacy-estimate ----
//
// Both predicates live in lib/supportedTools.ts; these pin the split they encode and
// the two row/bucket flags it drives. A tool can be tokenless with no legacy figure
// ever (Cursor, Windsurf); it cannot carry a legacy figure without being tokenless.
eq("quadcode row carries a legacy estimate", merged[0].estimated, true);
eq("claude-code row is measured", merged[1].estimated, false);
eq("a legacy-estimate tool is also tokenless", merged[0].tokenless, true);
eq("a measuring row is not tokenless", merged[1].tokenless, false);
eq("isLegacyEstimateTool is quadcode only",
  [isLegacyEstimateTool("quadcode"), isLegacyEstimateTool("genui"), isLegacyEstimateTool("cursor"), isLegacyEstimateTool("windsurf"), isLegacyEstimateTool("codex")],
  [true, true, false, false, false]);
eq("isTokenlessTool covers all three tools that report no counts",
  [isTokenlessTool("quadcode"), isTokenlessTool("genui"), isTokenlessTool("cursor"), isTokenlessTool("windsurf"), isTokenlessTool("codex"), isTokenlessTool("claude-code")],
  [true, true, true, true, false, false]);
eq("every legacy-estimate tool is tokenless, never the other way round",
  ["quadcode", "cursor", "windsurf", "codex", "claude-code"].every((tool) => !isLegacyEstimateTool(tool) || isTokenlessTool(tool)), true);

// A hook tool reports activity and model with no counts: its bucket is tokenless and
// its zero must never be read as a measurement.
const hookRows = groupStatsByModel([
  row("cursor", "<synthetic>", 0, 0, 1800, "2026-09-06T00:00:00.000Z"),
  row("windsurf", "<synthetic>", 0, 0, 900, "2026-09-06T00:00:00.000Z"),
]);
eq("a hook-only row is tokenless and carries no legacy estimate",
  hookRows.map((r) => [r.label, r.tokenless, r.estimated, r.tokens]),
  [["Cursor", true, false, 0], ["Windsurf", true, false, 0]]);

// One measuring tool on the row makes the total a real measurement again — the
// tokenless tool contributed activity to it, not tokens.
const mixed = groupStatsByModel([
  row("cursor", "claude-opus-5", 0, 0, 600, "2026-09-06T00:00:00.000Z"),
  row("claude-code", "claude-opus-5", 100, 200, 600, "2026-09-06T00:00:00.000Z"),
]);
eq("a mixed row is not tokenless", mixed[0].tokenless, false);
eq("but its hook bucket still is", mixed[0].byTool.map((b) => [b.tool, b.tokenless]).sort(), [["claude-code", false], ["cursor", true]]);

// ---- two raw ids that humanize to one name are one row ----
const sameName = groupStatsByModel([
  row("claude-code", "claude-sonnet-4.5", 100, 100, 600, "2026-09-01T00:00:00.000Z"),
  row("claude-code", "claude-sonnet-4-5-20250929", 50, 50, 300, "2026-09-03T00:00:00.000Z"),
]);
eq("duplicate model names merge", sameName.map((r) => [r.label, r.activeSeconds, r.tokens]), [
  ["Claude Sonnet 4.5", 900, 300],
]);

// ---- a tool with no model keeps a row of its own, named after the tool ----
const modelless = groupStatsByModel([
  row("cursor", "<synthetic>", 0, 0, 1800, "2026-09-05T00:00:00.000Z"),
  row("grok", "", 0, 0, 900, "2026-09-05T00:00:00.000Z"),
]);
eq(
  "model-less tools each keep a row",
  modelless.map((r) => [r.label, r.model, r.tools]),
  [
    ["Cursor", null, ["cursor"]],
    ["Grok", null, ["grok"]],
  ]
);
eq("modelRowLabel mirrors the grouping key", [
  modelRowLabel("claude-code", "claude-opus-5"),
  modelRowLabel("cursor", null),
  modelRowLabel("quadcode", "<synthetic>"),
], ["Claude Opus 5", "Cursor", "Quadcode AI"]);

// ---- pre-round-7 server: no lastActiveAt anywhere → hours desc, dates unknown ----
const undated = groupStatsByModel([
  row("claude-code", "claude-opus-5", 0, 0, 600),
  row("codex", "gpt-5-codex", 0, 0, 3600),
]);
eq(
  "no lastActiveAt → hours desc",
  undated.map((r) => [r.label, r.lastActiveAt]),
  [
    ["GPT-5 Codex", null],
    ["Claude Opus 5", null],
  ]
);

// A bucket with no date inside an otherwise dated response sorts last, not first.
const partial = groupStatsByModel([
  row("claude-code", "claude-opus-5", 0, 0, 99_999, null),
  row("codex", "gpt-5-codex", 0, 0, 60, "2026-09-05T00:00:00.000Z"),
]);
eq("undated bucket sorts last", partial.map((r) => r.label), ["GPT-5 Codex", "Claude Opus 5"]);

// ---- hours on record ----
eq("formatHoursOnRecord", [formatHoursOnRecord(66_240), formatHoursOnRecord(3600), formatHoursOnRecord(3540), formatHoursOnRecord(420), formatHoursOnRecord(120), formatHoursOnRecord(0)], [
  "18.4 hrs",
  "1.0 hrs",
  "59 min",
  "7 min",
  "2 min",
  "0 min",
]);

// ---- the source array is never mutated ----
const source = [row("cursor", "<synthetic>", 1, 2, 60, "2026-09-05T00:00:00.000Z")];
const snapshot = JSON.stringify(source);
groupStatsByModel(source);
eq("input is not mutated", JSON.stringify(source), snapshot);

// ---- regressions found on production, 2026-09-14 (plan section F) ----

// A. The Stats "Top model" tile was dead on a repeat press: it re-picked a row that
// was already picked, the row's prop never changed, and the effect that owns
// scrollIntoView never re-ran. Reproduced on prod at scrollY 836 with the row 85px
// above the viewport; the second press moved nothing. A repeat request must be a new
// value, or the row cannot tell the two presses apart.
const first = requestSelection(NO_MODEL_SELECTION, "Claude Sonnet 5");
const repeat = requestSelection(first, "Claude Sonnet 5");
eq("a repeat pick of the same row is a new tick", [first.tick === repeat.tick, first.label === repeat.label], [false, true]);
eq(
  "the picked row sees a different number on each press",
  [selectionTickFor(first, "Claude Sonnet 5"), selectionTickFor(repeat, "Claude Sonnet 5")],
  [1, 2]
);
eq("an unpicked row sees null", selectionTickFor(repeat, "Grok 4"), null);
eq("clearing is also a request, so a re-pick after it still lands", [
  requestSelection(repeat, null).label,
  requestSelection(requestSelection(repeat, null), "Claude Sonnet 5").tick,
], [null, 4]);
eq("nothing is picked to start with", selectionTickFor(NO_MODEL_SELECTION, "Claude Sonnet 5"), null);

// B. Escape-to-collapse dropped keyboard focus on <body> when focus sat on a row past
// the preview, because that row unmounts. Reproduced on prod: focus on row 6 of 8,
// one Escape, document.activeElement === document.body.
eq(
  "only a row past the preview loses its ground on collapse",
  [0, 1, 2, 3, 5, 7].map((i) => collapseWouldDropFocus(i, 3)),
  [false, false, false, true, true, true]
);
eq("focus outside the list (the toggle, on Show less) is left alone", collapseWouldDropFocus(-1, 3), false);

// C. The per-tool detail collapses to 0fr, which hides it from the eye and not from a
// screen reader: on prod a collapsed detail still returned its full innerText, with
// visibility:visible and no aria-hidden. Both controls also carried aria-expanded with
// no aria-controls naming the region they open.
eq(
  "collapsed list: the row press opens the list, and no detail is readable",
  modelRowAria({ reveals: true, open: false, listId: "L", detailId: "D" }),
  { expanded: false, controls: "L", detailHidden: true }
);
eq(
  "open list, closed row: the press opens this row's detail, still hidden from AT",
  modelRowAria({ reveals: false, open: false, listId: "L", detailId: "D" }),
  { expanded: false, controls: "D", detailHidden: true }
);
eq(
  "open row: the detail is the expanded region and is readable",
  modelRowAria({ reveals: false, open: true, listId: "L", detailId: "D" }),
  { expanded: true, controls: "D", detailHidden: false }
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`recentModels check failed: ${failures.join(", ")}`);
