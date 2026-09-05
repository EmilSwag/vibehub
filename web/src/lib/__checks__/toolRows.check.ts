// Contract pins for lib/toolRows.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/toolRows.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).

import { groupStatsByTool, isExpandable } from "../toolRows";
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
  activeSeconds: number
): StatByModel => ({ tool, model, tokensInput, tokensOutput, activeSeconds });

// ---- empty ----
eq("groupStatsByTool([])", groupStatsByTool([]), []);

// ---- one row per tool, hours desc; tokens are input+output ----
const mixed = groupStatsByTool([
  row("cursor", "<synthetic>", 0, 0, 1800),
  row("claude-code", "claude-fable-5-1", 1000, 4000, 7200),
  row("claude-code", "claude-opus-5", 500, 1500, 3600),
  row("quadcode", "claude-fable-5-1", 200, 800, 5400),
]);
eq(
  "groupStatsByTool(mixed) labels",
  mixed.map((g) => g.label),
  ["Claude Code", "Quadcode AI", "Cursor"]
);
eq(
  "groupStatsByTool(mixed) hours",
  mixed.map((g) => g.activeSeconds),
  [10_800, 5400, 1800]
);
eq(
  "groupStatsByTool(mixed) tokens",
  mixed.map((g) => g.tokens),
  [7000, 1000, 0]
);
eq(
  "groupStatsByTool(mixed) models of Claude Code",
  mixed[0].models.map((m) => [m.label, m.activeSeconds, m.tokens]),
  [
    ["Claude Fable 5.1", 7200, 5000],
    ["Claude Opus 5", 3600, 2000],
  ]
);

// ---- the same tool spelled two ways is one row ----
const spelled = groupStatsByTool([
  row("claude_code", "claude-opus-5", 10, 20, 600),
  row("Claude-Code", "claude-opus-5", 5, 5, 300),
]);
eq("spelling variants → one group", spelled.length, 1);
eq("spelling variants → merged", [spelled[0].label, spelled[0].activeSeconds, spelled[0].tokens], ["Claude Code", 900, 40]);
eq("spelling variants → one model row", spelled[0].models.length, 1);

// ---- two raw ids that humanize to one name are one line ----
const sameName = groupStatsByTool([
  row("claude-code", "claude-sonnet-4.5", 100, 100, 600),
  row("claude-code", "claude-sonnet-4-5-20250929", 50, 50, 300),
]);
eq("duplicate model names merge", sameName[0].models.map((m) => [m.label, m.activeSeconds, m.tokens]), [
  ["Claude Sonnet 4.5", 900, 300],
]);

// ---- two unrecognised tools stay apart; unknown ids fold together ----
const unknowns = groupStatsByTool([
  row("my-tool", "unknown", 0, 0, 300),
  row("other-tool", "unknown", 0, 0, 200),
  row("", "unknown", 0, 0, 100),
  row("unknown", "unknown", 0, 0, 100),
]);
eq(
  "unrecognised tools keep their own rows",
  unknowns.map((g) => [g.label, g.activeSeconds]),
  [
    ["My Tool", 300],
    ["Other Tool", 200],
    ["Unknown tool", 200],
  ]
);

// ---- a model-less tool has nothing to expand ----
const modelless = groupStatsByTool([row("cursor", "<synthetic>", 0, 0, 1800)])[0];
eq("model-less group keeps a row", [modelless.label, modelless.models.length, modelless.models[0].label], ["Cursor", 1, null]);
eq("model-less group is not expandable", isExpandable(modelless), false);
eq("named-model group is expandable", isExpandable(mixed[0]), true);

// A tool with both a named and an unnamed bucket keeps both, and does expand.
const partial = groupStatsByTool([
  row("quadcode", "claude-fable-5-1", 100, 100, 600),
  row("quadcode", "<synthetic>", 0, 0, 1200),
])[0];
eq("mixed named/unnamed keeps both", partial.models.map((m) => m.label), [null, "Claude Fable 5.1"]);
eq("mixed named/unnamed is expandable", isExpandable(partial), true);

// ---- the source array is never mutated ----
const source = [row("cursor", "<synthetic>", 1, 2, 60)];
const snapshot = JSON.stringify(source);
groupStatsByTool(source);
eq("input is not mutated", JSON.stringify(source), snapshot);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`toolRows check failed: ${failures.join(", ")}`);
