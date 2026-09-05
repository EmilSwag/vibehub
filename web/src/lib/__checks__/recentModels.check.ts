// Contract pins for lib/recentModels.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/recentModels.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).

import { formatHoursOnRecord, groupStatsByModel, isEstimatedTool, modelRowLabel } from "../recentModels";
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

// ---- Quadcode's estimated tokens are flagged, everyone else's are not ----
eq("quadcode row is estimated", merged[0].estimated, true);
eq("claude-code row is measured", merged[1].estimated, false);
eq("isEstimatedTool", [isEstimatedTool("quadcode"), isEstimatedTool("genui"), isEstimatedTool("codex")], [true, true, false]);

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
eq("formatHoursOnRecord", [formatHoursOnRecord(66_240), formatHoursOnRecord(3600), formatHoursOnRecord(120), formatHoursOnRecord(0)], [
  "18.4 hrs",
  "1.0 hrs",
  "2 min",
  "0 min",
]);

// ---- the source array is never mutated ----
const source = [row("cursor", "<synthetic>", 1, 2, 60, "2026-09-05T00:00:00.000Z")];
const snapshot = JSON.stringify(source);
groupStatsByModel(source);
eq("input is not mutated", JSON.stringify(source), snapshot);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`recentModels check failed: ${failures.join(", ")}`);
