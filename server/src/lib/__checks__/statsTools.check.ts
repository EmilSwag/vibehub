// Contract pins for lib/stats-tools.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx server/src/lib/__checks__/statsTools.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.

import { compareToolBuckets, foldByTool, topToolOf, type StatByTool } from "../stats-tools";

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

const bucket = (tool: string, activeSeconds: number, tokensInput = 0, tokensOutput = 0, lastActiveAt: string | null = null) => ({
  tool,
  tokensInput,
  tokensOutput,
  activeSeconds,
  lastActiveAt,
});

// ---- empty ----
eq("foldByTool(empty)", foldByTool([]), []);
eq("topToolOf(empty)", topToolOf([]), null);

// ---- folding: several models of one tool become one row ----
const folded = foldByTool([
  bucket("claude-code", 3_600, 1_000, 100, "2026-09-10T00:00:00.000Z"),
  bucket("claude-code", 1_800, 500, 50, "2026-09-12T00:00:00.000Z"),
  bucket("codex", 600, 9_000, 900, "2026-09-11T00:00:00.000Z"),
]);
eq("folded rows", folded, [
  { tool: "claude-code", tokensInput: 1_500, tokensOutput: 150, activeSeconds: 5_400, lastActiveAt: "2026-09-12T00:00:00.000Z" },
  { tool: "codex", tokensInput: 9_000, tokensOutput: 900, activeSeconds: 600, lastActiveAt: "2026-09-11T00:00:00.000Z" },
]);
eq("topTool = most active time, not most tokens", topToolOf(folded), "claude-code");

// ---- ranking: time first, tokens second, tool id third ----
eq(
  "tie on time → tokens decide",
  foldByTool([bucket("cursor", 0, 10, 0), bucket("codex", 0, 5_000, 0)]).map((b) => b.tool),
  ["codex", "cursor"]
);
eq(
  "tie on both → alphabetical",
  foldByTool([bucket("zed", 60, 1, 1), bucket("cursor", 60, 1, 1), bucket("codex", 60, 1, 1)]).map((b) => b.tool),
  ["codex", "cursor", "zed"]
);
const a: StatByTool = { tool: "a", tokensInput: 0, tokensOutput: 0, activeSeconds: 10, lastActiveAt: null };
const b: StatByTool = { tool: "b", tokensInput: 0, tokensOutput: 0, activeSeconds: 20, lastActiveAt: null };
eq("compareToolBuckets sorts descending by time", [a, b].sort(compareToolBuckets).map((x) => x.tool), ["b", "a"]);

// ---- hygiene ----
eq("blank tool ids are dropped", foldByTool([bucket("  ", 999), bucket("codex", 1)]).map((x) => x.tool), ["codex"]);
eq("tool ids are trimmed and merged", foldByTool([bucket(" codex ", 1), bucket("codex", 2)]), [
  { tool: "codex", tokensInput: 0, tokensOutput: 0, activeSeconds: 3, lastActiveAt: null },
]);
eq(
  "negative/NaN inputs never subtract",
  foldByTool([bucket("codex", -5, Number.NaN, -1)]),
  [{ tool: "codex", tokensInput: 0, tokensOutput: 0, activeSeconds: 0, lastActiveAt: null }]
);
eq(
  "lastActiveAt: null loses to a date, later date wins",
  foldByTool([bucket("codex", 1, 0, 0, null), bucket("codex", 1, 0, 0, "2026-09-01T00:00:00.000Z"), bucket("codex", 1, 0, 0, "2026-08-01T00:00:00.000Z")])[0]
    .lastActiveAt,
  "2026-09-01T00:00:00.000Z"
);

// ---- input is not mutated ----
const input = [bucket("codex", 1, 2, 3, null)];
const snapshot = JSON.stringify(input);
foldByTool(input);
eq("input buckets untouched", JSON.stringify(input), snapshot);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`statsTools.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
