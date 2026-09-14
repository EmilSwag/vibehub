// Contract pins for lib/trackerPing.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/trackerPing.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).
//
// These pin the connect sheet's success rule, which had four ways to lie:
//
//   1. Closing kept the last status, so a reopen read as already-live.
//   2. A copy before the first fetch landed reported live from that stale status —
//      and the sheet closed and fired its celebration.
//   3. A response from a previous open or user was still accepted.
//   4. A null baseline made any timestamp count as "newer", so an old offline ping
//      counted as a fresh one.
//
// Success may only ever come from a ping this session watched arrive.

import {
  freshPing,
  installedNote,
  newer,
  observePing,
  pingStage,
  sessionKeyOf,
  shouldCelebrate,
  visibleSnapshot,
} from "../trackerPing";
import type { PingInputs } from "../trackerPing";

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

const T0 = "2026-09-14T10:00:00.000Z";
const T1 = "2026-09-14T10:05:00.000Z";

/** A session that has fetched once, seen the account offline, and is waiting. */
const waiting: PingInputs = {
  started: true,
  liveAtOpen: false,
  baselineReady: true,
  baselineAt: T0,
  hasSnapshot: true,
  lastSeenAt: T0,
  presenceActive: false,
};

// ---- newer(): the comparison the whole thing rests on ----

eq("strictly newer", newer(T1, T0), true);
eq("equal is not newer — a cached snapshot does not count", newer(T0, T0), false);
eq("older is not newer", newer(T0, T1), false);
eq("no timestamp is never a ping", newer(null, T0), false);
eq("unparseable is never a ping", newer("not-a-date", T0), false);
eq("a null baseline accepts a real timestamp (callers must gate on baselineReady)", newer(T1, null), true);
eq("but never an unparseable one, even against a null baseline", newer("", null), false);

// ---- 4. an old offline ping before the baseline is established ----

eq(
  "no fresh ping until this session has a baseline",
  freshPing({ ...waiting, baselineReady: false, baselineAt: null, lastSeenAt: T0 }),
  false
);
eq("with a baseline, a strictly newer ping is fresh", freshPing({ ...waiting, lastSeenAt: T1 }), true);
eq("the baseline ping itself is not fresh", freshPing(waiting), false);

// ---- 1 & 2. a stale snapshot must not produce success ----

// A rapid reopen: the previous session's snapshot said active and carried a timestamp,
// but it belongs to another session, so this session has no snapshot at all.
const rapidReopen: PingInputs = {
  ...waiting,
  baselineReady: false,
  baselineAt: null,
  hasSnapshot: false,
  lastSeenAt: T1,
  presenceActive: true,
};
eq("a rapid reopen has no snapshot of its own, so no fresh ping", freshPing(rapidReopen), false);
eq("and it reads as waiting, not live", pingStage(rapidReopen), "waiting");
eq("so it does not celebrate", shouldCelebrate(pingStage(rapidReopen), rapidReopen.liveAtOpen), false);

// A copy before the first fetch of this session has landed.
const copiedBeforeFetch: PingInputs = {
  started: true,
  liveAtOpen: false,
  baselineReady: false,
  baselineAt: null,
  hasSnapshot: false,
  lastSeenAt: null,
  presenceActive: false,
};
eq("copying alone is never success", pingStage(copiedBeforeFetch), "waiting");
eq("copying alone never celebrates", shouldCelebrate(pingStage(copiedBeforeFetch), false), false);

// Presence says active but nothing new has arrived — exactly what a stale snapshot
// carries. Both halves are required.
eq(
  "presence active without a fresh ping is not live",
  pingStage({ ...waiting, presenceActive: true }),
  "waiting"
);

// ---- the stage ladder ----

eq("nothing started and not already live is idle", pingStage({ ...waiting, started: false }), "idle");
eq("started, nothing yet, is waiting", pingStage(waiting), "waiting");
eq("a fresh ping with presence still catching up is pinged", pingStage({ ...waiting, lastSeenAt: T1 }), "pinged");
eq(
  "a fresh ping and active presence is live",
  pingStage({ ...waiting, lastSeenAt: T1, presenceActive: true }),
  "live"
);
eq(
  "a real fresh ping succeeds even without a clipboard action",
  pingStage({ ...waiting, started: false, lastSeenAt: T1, presenceActive: true }),
  "live"
);
eq("an initial-live flag cannot override later offline presence", pingStage({ ...waiting, liveAtOpen: true }), "waiting");
eq("an initial-live flag cannot override a missing snapshot", pingStage({ ...waiting, liveAtOpen: true, hasSnapshot: false, presenceActive: true }), "waiting");
eq("an active word without a valid timestamp is not live", pingStage({ ...waiting, liveAtOpen: true, presenceActive: true, lastSeenAt: null }), "waiting");
eq("a fresh idle ping is visible even without copying", pingStage({ ...waiting, started: false, lastSeenAt: T1 }), "pinged");

// ---- already live at open: rests, never celebrates ----

const liveAtOpen: PingInputs = { ...waiting, started: false, liveAtOpen: true, presenceActive: true };
eq("the deep link on a tracking account rests at live", pingStage(liveAtOpen), "live");
eq("and never celebrates or closes", shouldCelebrate(pingStage(liveAtOpen), true), false);
eq(
  "a transition into live this session watched does celebrate",
  shouldCelebrate(pingStage({ ...waiting, lastSeenAt: T1, presenceActive: true }), false),
  true
);
eq("nothing else celebrates", [
  shouldCelebrate("idle", false),
  shouldCelebrate("waiting", false),
  shouldCelebrate("pinged", false),
], [false, false, false]);

// ---- 3. session identity and snapshot visibility ----

eq("a reopen is a different session than the close before it", sessionKeyOf(true, "u1") !== sessionKeyOf(false, "u1"), true);
eq("a different user is a different session", sessionKeyOf(true, "u1") !== sessionKeyOf(true, "u2"), true);
eq("no user is still a stable key", sessionKeyOf(true, null), "true:");
eq("the same open and user is the same session", sessionKeyOf(true, "u1"), sessionKeyOf(true, "u1"));

eq("this session's snapshot is visible", visibleSnapshot({ session: 4, status: "s" }, 4), "s");
eq("a previous session's snapshot is not", visibleSnapshot({ session: 3, status: "s" }, 4), null);
eq("a later stamp is not visible either", visibleSnapshot({ session: 5, status: "s" }, 4), null);
eq("no snapshot is null", visibleSnapshot(null, 4), null);

// A late response from an old open, gated at render: the hook drops it via `alive`,
// and even if one slipped through, the session stamp keeps it off the screen.
eq(
  "a late response stamped with an old session cannot reach the stage",
  pingStage({ ...waiting, hasSnapshot: visibleSnapshot({ session: 1, status: {} }, 2) !== null, lastSeenAt: T1, presenceActive: true }),
  "waiting"
);

// ---- installedNote: what may be claimed about a machine we cannot see ----

const ago = () => "12m ago";
const dev = (label: string, lastUsedAt: string | null) => ({ id: label, label, lastUsedAt, createdAt: T0 });

eq("no status, no claim", installedNote(null, ago), null);

eq(
  "tracking now is said about the account, never this machine",
  installedNote({ presence: { status: "active" }, devices: [] }, ago),
  { lead: "Your account is already tracking." }
);
eq(
  "idle counts as tracking too - anything but offline",
  installedNote({ presence: { status: "idle" }, devices: [dev("laptop", T0)] }, ago)?.lead,
  "Your account is already tracking."
);
eq(
  "the tracking line carries no reinstall caveat",
  installedNote({ presence: { status: "active" }, devices: [] }, ago)?.detail,
  undefined
);

// A token minted and never used is not evidence of an install, and naming it would
// invent a machine out of a label.
eq(
  "offline with only undated devices claims nothing",
  installedNote({ presence: { status: "offline" }, devices: [dev("never-used", null)] }, ago),
  null
);
eq(
  "offline with no devices claims nothing",
  installedNote({ presence: { status: "offline" }, devices: [] }, ago),
  null
);

const dated = installedNote(
  { presence: { status: "offline" }, devices: [dev("never-used", null), dev("desktop", T0), dev("laptop", T1)] },
  ago
);
eq("a dated device earns a line, newest first", dated?.lead, "Last tracked from laptop - 12m ago.".replace(" - ", " · "));
eq("it never says installed on, or this machine", /installed on|this machine/i.test(dated?.lead ?? ""), false);

// Installed-but-offline needs *starting*, not reinstalling - step 2 is the Start step.
eq("the advice is to start again, not to reinstall", /Run step 2 again\./.test(dated?.detail ?? ""), true);
eq("and it is never step 1", /step 1/.test(dated?.detail ?? ""), false);
eq(
  "the reinstall caveat says a running tracker keeps its old settings",
  /keeps its old settings until you stop and start it yourself/.test(dated?.detail ?? ""),
  true
);
eq(
  "and that stopping or starting is only ever the user own command",
  /until you stop and start it yourself\./.test(dated?.detail ?? ""),
  true
);

// Neither branch may resurrect the two deleted claims.
const everyNote = [installedNote({ presence: { status: "active" }, devices: [] }, ago), dated].map(
  (n) => (n?.lead ?? "") + " " + (n?.detail ?? "")
);
eq(
  "never Already set up on this machine again",
  everyNote.map((t) => /already set up on this machine/i.test(t)),
  [false, false]
);
eq(
  "never Opening your editor usually brings it back again",
  everyNote.map((t) => /opening your editor/i.test(t)),
  [false, false]
);

// Baseline, current status and initial-live flag travel together through the hook.
const initialOffline = observePing(null, { lastSeenAt: T0, presence: { status: "offline" } });
const followingActive = observePing(initialOffline, { lastSeenAt: T1, presence: { status: "active" } });
eq("the first observation sets the session baseline", initialOffline.baselineAt, T0);
eq("a later poll preserves that baseline", followingActive.baselineAt, T0);
eq("a new connection does not become already-live retroactively", followingActive.liveAtOpen, false);
eq("the latest snapshot is still updated", followingActive.tracker.lastSeenAt, T1);
eq("a valid active first snapshot is already-live", observePing(null, { lastSeenAt: T1, presence: { status: "active" } }).liveAtOpen, true);
eq("active with no timestamp is not proof of an existing connection", observePing(null, { lastSeenAt: null, presence: { status: "active" } }).liveAtOpen, false);
eq("active with an invalid timestamp is not proof either", observePing(null, { lastSeenAt: "bad-date", presence: { status: "active" } }).liveAtOpen, false);
const staleObservation = visibleSnapshot({ session: 1, status: followingActive }, 2);
eq("reopening discards baseline and initial-live together", staleObservation, null);
eq("a reopened offline session cannot inherit an old live flag", observePing(staleObservation, { lastSeenAt: T1, presence: { status: "offline" } }).liveAtOpen, false);
eq("updating an observation does not mutate its predecessor", initialOffline.tracker.presence.status, "offline");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`trackerPing check failed: ${failures.join(", ")}`);
