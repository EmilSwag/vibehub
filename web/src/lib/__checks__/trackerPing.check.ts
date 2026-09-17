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
  homeDevices,
  installedNote,
  newer,
  observePing,
  connectionAlive,
  pingStage,
  revokePrompt,
  sessionKeyOf,
  shouldCelebrate,
  showHomeDevices,
  staleSinceWaiting,
  staleTrackerHint,
  STALE_TRACKER_FIX,
  STALE_TRACKER_LEAD,
  visibleSnapshot,
} from "../trackerPing";
import type { PingInputs, StaleStatus } from "../trackerPing";
import type { StaleTracker, TrackerStatus } from "../../types";

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
  { lead: "Your account is already connected." }
);
eq(
  "idle counts as tracking too - anything but offline",
  installedNote({ presence: { status: "idle" }, devices: [dev("laptop", T0)] }, ago)?.lead,
  "Your account is already connected."
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
eq("a dated device earns a line, newest first", dated?.lead, "Last connected from laptop - 12m ago.".replace(" - ", " · "));
eq("it never says installed on, or this machine", /installed on|this machine/i.test(dated?.lead ?? ""), false);

// Installed-but-offline needs the secondary Start / reconnect control, not reinstalling.
eq("the advice is to start again, not to reinstall", /Use Start \/ reconnect under Status, Stop & reconnect\./.test(dated?.detail ?? ""), true);
eq("and it has no obsolete numbered instruction", /step [12]/i.test(dated?.detail ?? ""), false);
// Round 10 made `start` replace a running daemon and re-read config every tick, so the
// old "keeps its old settings until you stop and start it yourself" caveat became false.
eq(
  "the second sentence says what start does: it replaces a running tracker",
  /Start replaces a tracker that is already running\./.test(dated?.detail ?? ""),
  true
);
eq(
  "and never claims a running tracker keeps its old settings",
  /keeps its old settings/.test(dated?.detail ?? ""),
  false
);

// Round 15 (seen on prod): `devices[].lastUsedAt` is bumped by `login`'s verify at
// install time, so a dated device is not proof that anything ever tracked. Only an
// accepted heartbeat (`lastSeenAt`) is. Install-only = offline, a dated device, and
// no heartbeat ever: the sheet must say nothing, not "Last connected from … · just now".
eq(
  "install-only (verified token, no heartbeat ever) claims nothing",
  installedNote({ presence: { status: "offline" }, devices: [dev("laptop", T1)], lastSeenAt: null }, ago),
  null
);
eq(
  "with a heartbeat on record the dated device still earns its line",
  installedNote({ presence: { status: "offline" }, devices: [dev("laptop", T0)], lastSeenAt: T0 }, ago)?.lead,
  "Last connected from laptop · 12m ago."
);
// A `stop` sends session_end and a reinstall verifies — both move lastUsedAt past the
// last ping. "tracked" is dated by the ping.
const agoSpy = (iso: string) => `at ${iso}`;
eq(
  "the time is the last heartbeat, not the token's last use",
  installedNote({ presence: { status: "offline" }, devices: [dev("laptop", T1)], lastSeenAt: T0 }, agoSpy)?.lead,
  `Last connected from laptop · at ${T0}.`
);
eq(
  "a status without the field keeps the old behaviour (dated by the device)",
  installedNote({ presence: { status: "offline" }, devices: [dev("laptop", T1)] }, agoSpy)?.lead,
  `Last connected from laptop · at ${T1}.`
);
eq(
  "no heartbeat ever also silences the reinstall disclosure",
  installedNote({ presence: { status: "offline" }, devices: [dev("laptop", T1)], lastSeenAt: null }, ago)?.detail,
  undefined
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

// ---- a tracker running with a revoked token (round 10, U1) ----
//
// The state these pin: a daemon on the person's machine heartbeats a token the server
// revoked. Every heartbeat is a 401, presence never goes active, and the site said
// "Offline" — the same word it uses for a closed laptop, which sends the person to start
// a tracker that is already running.

// Type pins. These are compile-time, not runtime: the check files sit inside
// web/tsconfig.json's `include`, so `tsc -b` fails the build if `staleTracker` is
// dropped from TrackerStatus, stops being optional, or changes shape. The runtime
// assertions below only prove the pins were actually evaluated.
const staleShape: StaleTracker = {
  lastRejectedAt: "2026-09-14T10:04:00.000Z",
  label: "Windows",
  revokedAt: "2026-09-14T09:00:00.000Z",
};
const staleField: TrackerStatus["staleTracker"] = staleShape;
/** A status object with no `staleTracker` key at all must still be a TrackerStatus — an
 *  older server omits it entirely, and `?` is what keeps that a valid response. */
const withoutStale: Omit<TrackerStatus, "staleTracker"> = {
  connected: false,
  lastSeenAt: T0,
  activeTokens: 1,
  tools: [],
  tokenLastUsedAt: null,
  heartbeatIntervalMs: 30_000,
  presence: { status: "offline", activity: null },
  sources: [],
  devices: [],
};
const olderServerStatus: TrackerStatus = withoutStale;
eq("staleTracker is typed and carries the server's three fields", Object.keys(staleShape).sort(), [
  "label",
  "lastRejectedAt",
  "revokedAt",
]);
eq("staleTracker is optional — a status without the key is a valid TrackerStatus", "staleTracker" in olderServerStatus, false);
eq("the typed field accepts the server's shape", staleField?.lastRejectedAt, "2026-09-14T10:04:00.000Z");

const offlineAndStale: StaleStatus = { connected: false, staleTracker: staleShape };

// The rule itself: the rejection must be newer than the last accepted heartbeat.
eq("offline with a revoked token still heartbeating → say so", staleTrackerHint(offlineAndStale)?.lead, STALE_TRACKER_LEAD);
eq("and it carries the fix sentence", staleTrackerHint(offlineAndStale)?.fix, STALE_TRACKER_FIX);
// staleShape was rejected at 10:04. A good ping at 10:05 means a working tracker has
// spoken since — a second machine's dead token must not put a warning on this one.
eq(
  "connected, and a heartbeat was accepted after the rejection → silent",
  staleTrackerHint({ connected: true, lastSeenAt: "2026-09-14T10:05:00.000Z", staleTracker: staleShape }),
  null,
);
// Round 12: revoking your only device. `connected` lingers for the presence window, but
// nothing has been accepted since the rejection — that is the stale case, say so now.
eq(
  "connected, but the rejection is newer than the last accepted ping → say so",
  staleTrackerHint({ connected: true, lastSeenAt: "2026-09-14T10:03:00.000Z", staleTracker: staleShape })?.lead,
  STALE_TRACKER_LEAD,
);
eq(
  "a rejection at the same instant as the last good ping is not newer → silent",
  staleTrackerHint({ connected: true, lastSeenAt: "2026-09-14T10:04:00.000Z", staleTracker: staleShape }),
  null,
);
eq(
  "offline, but a tracker pinged fine after the old rejection → silent (that one was replaced)",
  staleTrackerHint({ connected: false, lastSeenAt: "2026-09-14T11:00:00.000Z", staleTracker: staleShape }),
  null,
);
eq("offline with nothing stale → silent (plain Offline, as before)", staleTrackerHint({ connected: false, staleTracker: null }), null);
eq("offline on a server that omits the field → silent", staleTrackerHint({ connected: false }), null);
eq("no status at all → silent", staleTrackerHint(null), null);

// The sheet's extra gate. T0 = 10:00, T1 = 10:05.
const at = (iso: string) => Date.parse(iso);
const hintAt = (iso: string) => staleTrackerHint({ connected: false, staleTracker: { ...staleShape, lastRejectedAt: iso } });

eq("rejected after this attempt started waiting → the sheet speaks", staleSinceWaiting(hintAt(T1), at(T0)), true);
eq("rejected before it started waiting → the sheet stays neutral", staleSinceWaiting(hintAt(T0), at(T1)), false);
eq("rejected at the same instant is not newer", staleSinceWaiting(hintAt(T0), at(T0)), false);
eq("not waiting yet → nothing to be newer than", staleSinceWaiting(hintAt(T1), null), false);
eq("no hint → nothing to say regardless of timing", staleSinceWaiting(null, at(T0)), false);
eq("an unparseable server timestamp is not evidence", staleSinceWaiting(hintAt("not-a-date"), at(T0)), false);
// Home and Settings deliberately do not apply this gate: they are ambient, with no
// "moment this attempt began" to compare against.
eq("the ambient rule ignores timing entirely", staleTrackerHint(offlineAndStale) !== null, true);

// ---- Home's Devices section: a second *machine*, never a pending token (round 14) ----
// Opening the connect sheet mints a token. If the person then closes the sheet, or follows
// "Run step 2 again" so the old key reconnects, that token stays never-used. It is not a
// device and must not conjure a Devices section on Home.
const one = [dev("desktop", T0)];
const oneAndPending = [dev("pending", null), dev("desktop", T0)];
const two = [dev("desktop", T0), dev("laptop", T1)];
eq("a single machine → no section", showHomeDevices(one), false);
eq("one machine plus a never-used token → still no section", showHomeDevices(oneAndPending), false);
eq("two machines → section", showHomeDevices(two), true);
eq("two machines plus a pending token → section", showHomeDevices([dev("pending", null), ...two]), true);
eq(
  "and the pending token is not listed",
  homeDevices([dev("pending", null), ...two]).map((d) => d.label),
  ["desktop", "laptop"]
);
eq("nothing used yet → nothing listed", homeDevices([dev("pending", null)]), []);
eq("order of the used ones is preserved", homeDevices(two).map((d) => d.label), ["desktop", "laptop"]);

// ---- the question before revoking a live device (round 14) ----
// One ghost click used to end a machine's tracking with no way back but a reinstall.
const q = revokePrompt("Windows · Sep 16");
eq("names the machine", q.startsWith("Revoke Windows · Sep 16?"), true);
eq("states remote reporting authorization, not local process control", /removes reporting authorization/.test(q), true);
eq("makes no guarantee of local shutdown", /does not guarantee local shutdown/.test(q), true);
eq("makes no history-erasure promise", /or erase history/.test(q), true);
eq("says how to report again", /Reconnect with a new device command to report again\./.test(q), true);
eq("never mentions keys or tokens", /token|key/i.test(q), false);
eq("keeps the critical disclosure concise, not truncated", q.length < 220, true);
eq("revoked-key recovery uses the one-command path", /new install & start command/.test(STALE_TRACKER_FIX), true);
eq("revoked-key recovery contains no numbered split steps", /step [12]/i.test(STALE_TRACKER_FIX), false);

// The web receives normalized status, not the raw connection-v1 POST receipt.
// An accepted connection with no AI sessions is idle, with empty activity/sources.
// Token verification alone still cannot complete the connection.
const idleSnapshot: TrackerStatus = {
  ...olderServerStatus,
  lastSeenAt: T1,
  connected: true,
  presence: { status: "idle", activity: null },
};
const idleBefore = JSON.stringify(idleSnapshot);
eq("idle with an accepted heartbeat is connected", connectionAlive(idleSnapshot), true);
eq("idle verification without a heartbeat is not connected", connectionAlive({ ...idleSnapshot, lastSeenAt: null }), false);
eq("idle with an invalid heartbeat is not connected", connectionAlive({ ...idleSnapshot, lastSeenAt: "bad-date" }), false);
eq("explicit server disconnect wins over idle label", connectionAlive({ ...idleSnapshot, connected: false }), false);
eq("offline with an old heartbeat remains offline", connectionAlive({ ...idleSnapshot, presence: { status: "offline" } }), false);
eq("unknown presence cannot prove connection", connectionAlive({ ...idleSnapshot, presence: { status: "unknown" } }), false);
eq("no response is not connected", connectionAlive(null), false);
const firstIdle = observePing(null, idleSnapshot);
eq("an existing idle connection is already-live on open", firstIdle.liveAtOpen, true);
eq("existing idle connection does not celebrate again", shouldCelebrate(pingStage({ ...waiting, liveAtOpen: firstIdle.liveAtOpen, baselineAt: T1, lastSeenAt: T1, presenceActive: connectionAlive(idleSnapshot) }), firstIdle.liveAtOpen), false);
eq("receipt-only observation keeps AI activity empty", firstIdle.tracker.presence.activity, null);
eq("receipt-only observation keeps sources empty", firstIdle.tracker.sources, []);
eq("receipt-only observation keeps tools empty", firstIdle.tracker.tools, []);
eq("receipt-only note says connected without claiming AI activity", installedNote(firstIdle.tracker, ago)?.lead, "Your account is already connected.");
const followingIdle = observePing(observePing(null, olderServerStatus), idleSnapshot);
const freshIdleInputs = {
  ...waiting,
  liveAtOpen: followingIdle.liveAtOpen,
  baselineAt: followingIdle.baselineAt,
  lastSeenAt: followingIdle.tracker.lastSeenAt,
  presenceActive: connectionAlive(followingIdle.tracker),
};
eq("a fresh idle heartbeat completes connection", pingStage(freshIdleInputs), "live");
eq("a new idle connection may celebrate", shouldCelebrate(pingStage(freshIdleInputs), false), true);
eq("idle label cannot turn a cached heartbeat into a new connection", pingStage({ ...freshIdleInputs, baselineAt: T1 }), "waiting");
eq("the first response is not a witnessed new connection", freshPing({ ...freshIdleInputs, baselineReady: false }), false);
eq("connection check never changes AI presence to active", idleSnapshot.presence.status, "idle");
eq("connection observation never mutates the receipt-only status", JSON.stringify(idleSnapshot), idleBefore);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`trackerPing check failed: ${failures.join(", ")}`);
