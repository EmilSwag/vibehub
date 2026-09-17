// Contract pins for lib/publicPresence.ts — plain assertions, no test framework, same
// pattern as lastOnline.check.ts. Run from web/:
//   node --import tsx src/lib/__checks__/publicPresence.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.

import { publicPresence } from "../publicPresence";

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

// ---- missing: no snapshot at all (older server, or never online) ----
eq("undefined snapshot → null", publicPresence(undefined), null);
eq("null snapshot → null", publicPresence(null), null);

// ---- offline, with a known timestamp: passes lastSeenAt through untouched ----
eq(
  "offline snapshot → PresenceLike, same lastSeenAt, no activity/tools",
  publicPresence({ status: "offline", lastSeenAt: "2026-09-12T10:00:00.000Z" }),
  { status: "offline", activity: null, tools: [], lastSeenAt: "2026-09-12T10:00:00.000Z" }
);

// ---- active: privacy — status passes through, but activity/tool detail never leaks
// to a public visitor regardless of status (that stays friends-only, RealtimeContext) ----
eq(
  "active snapshot → status shows, activity/tools stay empty (no detail leak)",
  publicPresence({ status: "active", lastSeenAt: "2026-09-17T09:00:00.000Z" }),
  { status: "active", activity: null, tools: [], lastSeenAt: "2026-09-17T09:00:00.000Z" }
);

// ---- omitted lastSeenAt: a valid snapshot with nothing to report, normalized to
// null rather than left undefined (PresenceLike's own contract) ----
eq(
  "offline snapshot, lastSeenAt omitted → normalized to null",
  publicPresence({ status: "offline" }),
  { status: "offline", activity: null, tools: [], lastSeenAt: null }
);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`publicPresence.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
