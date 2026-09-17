// Contract pins for lib/projectArrivals.ts — plain assertions, no test framework, same
// pattern as lastOnline.check.ts. Run from the repo root:
//   npx tsx web/src/lib/__checks__/projectArrivals.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.

import { arrivalToast, externalArrivals } from "../projectArrivals";

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

const A = { id: "a", name: "Aurora" };
const B = { id: "b", name: "Borealis" };
const C = { id: "c", name: "Comet" };

// ---- externalArrivals: first load never counts, no matter what it contains ----
eq("no snapshot yet (mount) → nothing counts as arrived", externalArrivals([A, B], null, new Set()), []);

// ---- a project already in the last snapshot is not an arrival ----
eq("already known → not an arrival", externalArrivals([A], new Set(["a"]), new Set()), []);

// ---- a genuinely new id, not caused by this tab, is an arrival ----
eq("new id, not locally changed → arrival", externalArrivals([A, B], new Set(["a"]), new Set()), [B]);

// ---- this tab's own publish/edit/delete/like must never self-toast ----
eq(
  "new id but this tab caused it (changedProjectIds) → not an arrival",
  externalArrivals([A, B], new Set(["a"]), new Set(["b"])),
  []
);

// ---- mixed: one external arrival, one local change, one already known ----
eq(
  "mixed batch keeps only the genuinely external new id",
  externalArrivals([A, B, C], new Set(["a"]), new Set(["c"])),
  [B]
);

// ---- order and multiplicity are preserved, not just existence ----
eq("multiple external arrivals, order preserved", externalArrivals([B, C], new Set(["a"]), new Set()), [B, C]);

// ---- empty incoming → empty regardless of snapshot/changed state ----
eq("nothing incoming → nothing arrived", externalArrivals([], new Set(["a"]), new Set()), []);

// ---- arrivalToast: no arrivals, singular, plural ----
eq("no arrivals → no toast", arrivalToast([]), null);
eq("one arrival → names it", arrivalToast([A]), { title: "Published", body: "Aurora is now on your profile." });
eq(
  "two arrivals → counted, not named",
  arrivalToast([A, B]),
  { title: "Published", body: "2 new projects are now on your profile." }
);
eq(
  "three arrivals → still just a count",
  arrivalToast([A, B, C]),
  { title: "Published", body: "3 new projects are now on your profile." }
);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`projectArrivals.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
