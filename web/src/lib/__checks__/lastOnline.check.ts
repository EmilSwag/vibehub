// Contract pins for lib/lastOnline.ts — plain assertions, no test framework, same
// pattern as format.check.ts. Run from the repo root:
//   npx tsx web/src/lib/__checks__/lastOnline.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.

import { lastOnlineLabel, mergeLastSeenAt } from "../lastOnline";
import { formatShortDate } from "../format";

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

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---- active: never shown, regardless of lastSeenAt ----
eq("active, lastSeenAt set", lastOnlineLabel({ status: "active", lastSeenAt: ago(HOUR) }, NOW), null);
eq("active, lastSeenAt null", lastOnlineLabel({ status: "active", lastSeenAt: null }, NOW), null);

// ---- offline, never seen ----
eq("offline, null → Offline", lastOnlineLabel({ status: "offline", lastSeenAt: null }, NOW), "Offline");

// ---- idle, never seen: nothing to report ----
eq("idle, null → null", lastOnlineLabel({ status: "idle", lastSeenAt: null }, NOW), null);

// ---- <1m: delegates to elapsedShort's own cutoff — "just now" for the whole first
// minute (elapsedShort has no seconds-level granularity; this is the whole point of
// reusing it verbatim rather than re-deriving finer buckets ourselves) ----
eq("offline, 0s ago", lastOnlineLabel({ status: "offline", lastSeenAt: ago(0) }, NOW), "Last online just now");
eq("offline, 30s ago (still just now)", lastOnlineLabel({ status: "offline", lastSeenAt: ago(30_000) }, NOW), "Last online just now");
eq("offline, 59s ago (still just now)", lastOnlineLabel({ status: "offline", lastSeenAt: ago(59_000) }, NOW), "Last online just now");
eq("idle, 5s ago", lastOnlineLabel({ status: "idle", lastSeenAt: ago(5_000) }, NOW), "idle · last active just now");
eq("idle, 45s ago", lastOnlineLabel({ status: "idle", lastSeenAt: ago(45_000) }, NOW), "idle · last active just now");

// ---- minutes ----
eq("offline, 60s ago", lastOnlineLabel({ status: "offline", lastSeenAt: ago(MIN) }, NOW), "Last online 1m ago");
eq("offline, 12m ago", lastOnlineLabel({ status: "offline", lastSeenAt: ago(12 * MIN) }, NOW), "Last online 12m ago");
eq("offline, 59m ago", lastOnlineLabel({ status: "offline", lastSeenAt: ago(59 * MIN) }, NOW), "Last online 59m ago");

// ---- hours ----
eq("offline, 2h ago", lastOnlineLabel({ status: "offline", lastSeenAt: ago(2 * HOUR) }, NOW), "Last online 2h ago");
eq("offline, 23h59m ago (just under 1d)", lastOnlineLabel({ status: "offline", lastSeenAt: ago(23 * HOUR + 59 * MIN) }, NOW), "Last online 23h ago");
eq("idle, 2h ago", lastOnlineLabel({ status: "idle", lastSeenAt: ago(2 * HOUR) }, NOW), "idle · last active 2h ago");

// ---- days (1–7) ----
eq("offline, 3d ago", lastOnlineLabel({ status: "offline", lastSeenAt: ago(3 * DAY) }, NOW), "Last online 3d ago");
eq("offline, exactly 7d ago (boundary, still relative)", lastOnlineLabel({ status: "offline", lastSeenAt: ago(7 * DAY) }, NOW), "Last online 7d ago");
eq("idle, 5d ago", lastOnlineLabel({ status: "idle", lastSeenAt: ago(5 * DAY) }, NOW), "idle · last active 5d ago");

// ---- beyond 7d: absolute date, delegates to formatShortDate verbatim ----
const eightDaysAgoIso = ago(8 * DAY);
eq(
  "offline, 8d ago → formatShortDate delegate",
  lastOnlineLabel({ status: "offline", lastSeenAt: eightDaysAgoIso }, NOW),
  `Last online ${formatShortDate(eightDaysAgoIso)}`
);
const monthAgoIso = ago(45 * DAY);
eq(
  "idle, 45d ago → formatShortDate delegate",
  lastOnlineLabel({ status: "idle", lastSeenAt: monthAgoIso }, NOW),
  `idle · last active ${formatShortDate(monthAgoIso)}`
);

// ---- invalid: never confused with "never seen" ----
eq("offline, invalid date → null", lastOnlineLabel({ status: "offline", lastSeenAt: "not-a-date" }, NOW), null);
eq("idle, invalid date → null", lastOnlineLabel({ status: "idle", lastSeenAt: "not-a-date" }, NOW), null);

// ---- future (clock skew): clamps to zero elapsed, never negative ----
eq(
  "offline, 1h in the future → just now",
  lastOnlineLabel({ status: "offline", lastSeenAt: new Date(NOW + HOUR).toISOString() }, NOW),
  "Last online just now"
);
eq(
  "idle, 5m in the future → just now",
  lastOnlineLabel({ status: "idle", lastSeenAt: new Date(NOW + 5 * MIN).toISOString() }, NOW),
  "idle · last active just now"
);

// ---- mergeLastSeenAt: the RealtimeContext WS merge rule, synthetically (no socket,
// no React) — omission preserves the prior value, explicit null clears it ----
const T1 = "2026-09-14T10:00:00.000Z";
const T2 = "2026-09-14T10:05:00.000Z";
eq("omitted key + no prior → null (first event for a username)", mergeLastSeenAt(undefined, undefined), null);
eq("omitted key + a known prior → the prior value is preserved", mergeLastSeenAt(T1, undefined), T1);
eq("omitted key + prior was null → stays null", mergeLastSeenAt(null, undefined), null);
eq("explicit null + a known prior → clears it, does not preserve", mergeLastSeenAt(T1, null), null);
eq("explicit null + no prior → null either way", mergeLastSeenAt(undefined, null), null);
eq("a first real value with no prior → the new value", mergeLastSeenAt(undefined, T1), T1);
eq("a newer explicit value overwrites an older prior", mergeLastSeenAt(T1, T2), T2);
eq("an explicit value is taken even if it reads older than the prior (server is authoritative)", mergeLastSeenAt(T2, T1), T1);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`lastOnline.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
