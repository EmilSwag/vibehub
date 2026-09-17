// Contract pins for lib/topTool.ts — plain assertions, no test framework, same pattern
// as lastOnline.check.ts / publicPresence.check.ts. Run from web/:
//   node --import tsx src/lib/__checks__/topTool.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.

import { toolBuckets, topToolOf, topToolShare } from "../topTool";
import { toolLabel } from "../format";
import type { StatByModel, StatByTool } from "../../types";

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

// ---- server preference: present `byTool` (even empty) wins over `byModel` ----

const serverByTool: StatByTool[] = [
  { tool: "cursor", tokensInput: 100, tokensOutput: 50, activeSeconds: 200, lastActiveAt: "2026-09-10T00:00:00.000Z" },
  { tool: "claude-code", tokensInput: 900, tokensOutput: 900, activeSeconds: 5000, lastActiveAt: "2026-09-16T00:00:00.000Z" },
];
const conflictingByModel: StatByModel[] = [
  { model: "gpt-5", tool: "cursor", tokensInput: 999999, tokensOutput: 999999, activeSeconds: 999999, lastActiveAt: "2026-09-01T00:00:00.000Z" },
];

eq(
  "byTool present → used verbatim (sorted), byModel ignored even though it disagrees",
  toolBuckets({ byModel: conflictingByModel, byTool: serverByTool }),
  [
    { tool: "claude-code", tokensInput: 900, tokensOutput: 900, activeSeconds: 5000, lastActiveAt: "2026-09-16T00:00:00.000Z" },
    { tool: "cursor", tokensInput: 100, tokensOutput: 50, activeSeconds: 200, lastActiveAt: "2026-09-10T00:00:00.000Z" },
  ]
);
eq("byTool: [] (present, empty) → [] — a real answer, byModel never consulted", toolBuckets({ byModel: conflictingByModel, byTool: [] }), []);
eq(
  "byTool undefined (absent) → aggregates byModel instead",
  toolBuckets({ byModel: conflictingByModel, byTool: undefined }),
  [{ tool: "cursor", tokensInput: 999999, tokensOutput: 999999, activeSeconds: 999999, lastActiveAt: "2026-09-01T00:00:00.000Z" }]
);

eq("topToolOf: server topTool wins over the derived bucket leader", topToolOf({ byModel: [], byTool: serverByTool, topTool: "cursor" }), "cursor");
eq("topToolOf: explicit topTool:null still falls through to the bucket leader", topToolOf({ byModel: [], byTool: serverByTool, topTool: null }), "claude-code");
eq("topToolOf: topTool undefined falls through to the bucket leader", topToolOf({ byModel: [], byTool: serverByTool, topTool: undefined }), "claude-code");

// ---- aggregation / ties ----

const aggByModel: StatByModel[] = [
  { model: "claude-fable-5-1", tool: "claude-code", tokensInput: 100, tokensOutput: 50, activeSeconds: 600, lastActiveAt: "2026-09-10T08:00:00.000Z" },
  { model: "claude-opus-5", tool: "claude-code", tokensInput: 200, tokensOutput: 100, activeSeconds: 400, lastActiveAt: "2026-09-12T08:00:00.000Z" },
  { model: "gpt-5", tool: "cursor", tokensInput: 150, tokensOutput: 150, activeSeconds: 1000 },
];
eq(
  "two claude-code rows summed; tied active seconds with cursor broken by total tokens; lastActiveAt is the later of the two, omitted stays null",
  toolBuckets({ byModel: aggByModel }),
  [
    { tool: "claude-code", tokensInput: 300, tokensOutput: 150, activeSeconds: 1000, lastActiveAt: "2026-09-12T08:00:00.000Z" },
    { tool: "cursor", tokensInput: 150, tokensOutput: 150, activeSeconds: 1000, lastActiveAt: null },
  ]
);

const fullTie: StatByTool[] = [
  { tool: "zeta", tokensInput: 10, tokensOutput: 10, activeSeconds: 100, lastActiveAt: null },
  { tool: "alpha", tokensInput: 10, tokensOutput: 10, activeSeconds: 100, lastActiveAt: null },
];
eq(
  "full tie (seconds and tokens both equal) → tool name ascending, the last resort",
  toolBuckets({ byModel: [], byTool: fullTie }),
  [
    { tool: "alpha", tokensInput: 10, tokensOutput: 10, activeSeconds: 100, lastActiveAt: null },
    { tool: "zeta", tokensInput: 10, tokensOutput: 10, activeSeconds: 100, lastActiveAt: null },
  ]
);

// ---- empty / null: nothing anywhere ----

eq("no byModel rows, no byTool → []", toolBuckets({ byModel: [] }), []);
eq("topToolOf with nothing anywhere → null", topToolOf({ byModel: [], topTool: undefined }), null);
eq("topToolShare with nothing anywhere → null", topToolShare({ byModel: [] }), null);

// ---- shares / zero ----

const shareBuckets: StatByTool[] = [
  { tool: "claude-code", tokensInput: 0, tokensOutput: 0, activeSeconds: 700, lastActiveAt: null },
  { tool: "cursor", tokensInput: 0, tokensOutput: 0, activeSeconds: 300, lastActiveAt: null },
];
eq("topToolShare: 700 of 1000 total active seconds → 0.7", topToolShare({ byModel: [], byTool: shareBuckets }), 0.7);

const zeroActivityBuckets: StatByTool[] = [
  { tool: "claude-code", tokensInput: 500, tokensOutput: 500, activeSeconds: 0, lastActiveAt: null },
  { tool: "cursor", tokensInput: 500, tokensOutput: 500, activeSeconds: 0, lastActiveAt: null },
];
eq(
  "topToolShare: buckets exist but every one sits at 0 active seconds → null, not NaN",
  topToolShare({ byModel: [], byTool: zeroActivityBuckets }),
  null
);

// ---- sanity: the label the eventual UI tile renders for a bucket's `tool` id ----

eq("toolLabel sanity — the 'Top tool' tile will render this label", toolLabel("claude-code"), "Claude Code");

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`topTool.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
