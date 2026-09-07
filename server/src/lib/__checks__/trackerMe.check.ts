// Contract pins for lib/tracker-me.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx server/src/lib/__checks__/trackerMe.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.
//
// This is the wire contract the macOS menu-bar app decodes, so every field name and
// every null here is load-bearing. lib/tracker-me.ts is Prisma-free precisely so this
// file can run without a database or a server.

import type { PresenceSnapshot } from "../sessions";
import { buildTrackerMePayload, foldToday, FRIENDS_SAMPLE_LIMIT, type TrackerMeInput } from "../tracker-me";

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

const DAY = Date.UTC(2026, 8, 7); // 2026-09-07, a UTC midnight — matches utcDay()
const today = new Date(DAY);
const at = (ms: number) => new Date(DAY + ms);
const H = 3_600_000;

// ---- fixtures ----
const ME = { id: "u_me", username: "emil", displayName: "Emil", avatarUrl: "https://cdn/a.png" };

const offline: PresenceSnapshot = { username: "emil", status: "offline", activity: null, tools: [] };
const activeAt = (username: string, project: string, tool: string, model: string | null): PresenceSnapshot => ({
  username,
  status: "active",
  activity: { projectAlias: project, tool, model, startedAt: at(10 * H).toISOString() },
  tools: [],
});
const idleAt = (username: string): PresenceSnapshot => ({
  username,
  status: "idle",
  activity: { projectAlias: "dozing", tool: "cursor", model: null, startedAt: at(9 * H).toISOString() },
  tools: [],
});

const base: TrackerMeInput = {
  user: ME,
  level: 7,
  presence: activeAt("emil", "vibehub", "claude-code", "claude-opus-5"),
  today: { activeSeconds: 8_040, tokens: 125_000, sessionStartedAt: at(10 * H) },
  lastSeenAt: at(11 * H),
  devices: [{ label: "MacBook Pro", lastUsedAt: at(11 * H) }],
  friends: [],
};

// ---- the happy path, field by field ----
const full = buildTrackerMePayload(base);
eq("user", full.user, { id: "u_me", username: "emil", displayName: "Emil", avatarUrl: "https://cdn/a.png", level: 7 });
eq("presence.status", full.presence.status, "active");
// PresenceActivity's projectAlias/startedAt are renamed to project/since on the wire.
eq("presence.activity", full.presence.activity, {
  project: "vibehub",
  tool: "claude-code",
  model: "claude-opus-5",
  since: at(10 * H).toISOString(),
});
eq("today", full.today, {
  activeSeconds: 8_040,
  tokens: 125_000,
  sessionStartedAt: at(10 * H).toISOString(),
});
eq("tracker.connected(active)", full.tracker.connected, true);
eq("tracker.lastSeenAt is ISO", full.tracker.lastSeenAt, at(11 * H).toISOString());
eq("tracker.devices", full.tracker.devices, [{ name: "MacBook Pro", lastSeenAt: at(11 * H).toISOString() }]);
eq("friendsOnline(empty)", full.friendsOnline, { count: 0, sample: [] });

// Top-level keys are exactly the five the app decodes — a stray key means the Swift
// model and the server have drifted.
eq("payload keys", Object.keys(full), ["user", "presence", "today", "tracker", "friendsOnline"]);

// ---- presence degradation ----
eq(
  "connected(idle) — an idle tracker is still connected",
  buildTrackerMePayload({ ...base, presence: idleAt("emil") }).tracker.connected,
  true
);
const off = buildTrackerMePayload({ ...base, presence: offline });
eq("connected(offline)", off.tracker.connected, false);
eq("activity(offline) is null", off.presence.activity, null);

// A presence-only tool reports no model: the segment degrades to null, and the tool is
// never dropped (the tracker detection contract).
eq(
  "model:null survives, tool does not",
  buildTrackerMePayload({ ...base, presence: activeAt("emil", "neon", "cursor", null) }).presence.activity,
  { project: "neon", tool: "cursor", model: null, since: at(10 * H).toISOString() }
);

// ---- the Round 5 trap: connected must not come from token lastUsedAt ----
// A device token used minutes ago (this route's own middleware bumps it) while presence
// is offline must still report disconnected.
eq(
  "connected ignores a freshly-used device token",
  buildTrackerMePayload({
    ...base,
    presence: offline,
    lastSeenAt: null,
    devices: [{ label: "MacBook Pro", lastUsedAt: at(11 * H) }],
  }).tracker,
  { connected: false, lastSeenAt: null, devices: [{ name: "MacBook Pro", lastSeenAt: at(11 * H).toISOString() }] }
);

// ---- nulls the app must tolerate ----
eq(
  "brand-new account: no display name, no avatar, no device, nothing seen",
  buildTrackerMePayload({
    ...base,
    user: { id: "u_new", username: "newbie", displayName: null, avatarUrl: null },
    level: 1,
    presence: offline,
    today: { activeSeconds: 0, tokens: 0, sessionStartedAt: null },
    lastSeenAt: null,
    devices: [],
  }),
  {
    user: { id: "u_new", username: "newbie", displayName: null, avatarUrl: null, level: 1 },
    presence: { status: "offline", activity: null },
    today: { activeSeconds: 0, tokens: 0, sessionStartedAt: null },
    tracker: { connected: false, lastSeenAt: null, devices: [] },
    friendsOnline: { count: 0, sample: [] },
  }
);
eq(
  "device that has never been used",
  buildTrackerMePayload({ ...base, devices: [{ label: "iMac", lastUsedAt: null }] }).tracker.devices,
  [{ name: "iMac", lastSeenAt: null }]
);

// ---- friendsOnline ----
const friend = (username: string, presence: PresenceSnapshot) => ({
  user: { username, displayName: username.toUpperCase(), avatarUrl: null },
  presence,
});
const mixed = buildTrackerMePayload({
  ...base,
  friends: [
    friend("ann", activeAt("ann", "atlas", "codex", "gpt-5-codex")),
    friend("bo", offline),
    friend("cy", idleAt("cy")),
  ],
});
eq("friendsOnline.count excludes offline", mixed.friendsOnline.count, 2);
eq("friendsOnline.sample order + shape", mixed.friendsOnline.sample, [
  {
    username: "ann",
    displayName: "ANN",
    avatarUrl: null,
    status: "active",
    activity: { project: "atlas", tool: "codex", model: "gpt-5-codex", since: at(10 * H).toISOString() },
  },
  {
    username: "cy",
    displayName: "CY",
    avatarUrl: null,
    status: "idle",
    activity: { project: "dozing", tool: "cursor", model: null, since: at(9 * H).toISOString() },
  },
]);

// count is every online friend; sample is only what the popover can draw.
const many = buildTrackerMePayload({
  ...base,
  friends: Array.from({ length: 9 }, (_, i) => friend(`f${i}`, activeAt(`f${i}`, "p", "vscode", null))),
});
eq("friendsOnline.count is not capped", many.friendsOnline.count, 9);
eq("friendsOnline.sample is capped", many.friendsOnline.sample.length, FRIENDS_SAMPLE_LIMIT);
eq("FRIENDS_SAMPLE_LIMIT matches the popover", FRIENDS_SAMPLE_LIMIT, 4);

// ---- foldToday ----
const stat = (date: Date, activeSeconds: number, tokensInput: number, tokensOutput: number) => ({
  date,
  activeSeconds,
  tokensInput,
  tokensOutput,
});
const session = (startedAt: Date, lastHeartbeatAt: Date, tokensInput = 0, tokensOutput = 0) => ({
  startedAt,
  lastHeartbeatAt,
  tokensInput,
  tokensOutput,
});
const yesterday = new Date(DAY - 86_400_000);

eq("foldToday(nothing)", foldToday([], [], today), { activeSeconds: 0, tokens: 0, sessionStartedAt: null });
eq("foldToday(closed work only)", foldToday([stat(today, 3_600, 10, 20)], [], today), {
  activeSeconds: 3_600,
  tokens: 30,
  sessionStartedAt: null,
});
eq(
  "foldToday drops DailyStat rows from other days",
  foldToday([stat(yesterday, 9_999, 999, 999), stat(today, 60, 1, 1)], [], today),
  { activeSeconds: 60, tokens: 2, sessionStartedAt: null }
);
// Open session elapsed is measured to lastHeartbeatAt, never to now — a tracker that
// died mid-session must stop accruing.
// foldToday runs pre-serialization, so sessionStartedAt is still a Date — assert it
// through toISOString() rather than against the payload's string form.
const folded = foldToday([stat(today, 3_600, 10, 20)], [session(at(10 * H), at(11 * H), 5, 5)], today);
eq("foldToday.activeSeconds", folded.activeSeconds, 7_200);
eq("foldToday.tokens", folded.tokens, 40);
eq("foldToday.sessionStartedAt", folded.sessionStartedAt?.toISOString() ?? null, at(10 * H).toISOString());

// A session that began yesterday and is still open belongs to yesterday's bucket — the
// same day foldIntoDailyStat will use when it closes.
const overnight = foldToday([], [session(at(-2 * H), at(1 * H))], today);
eq("foldToday ignores a session started yesterday", overnight.activeSeconds, 0);
eq("foldToday still reports it as the open session", overnight.sessionStartedAt?.toISOString() ?? null, at(-2 * H).toISOString());

// Freshest heartbeat wins when several sessions are open.
const multi = foldToday([], [session(at(2 * H), at(3 * H)), session(at(8 * H), at(11 * H))], today);
eq("foldToday.sessionStartedAt picks the freshest", multi.sessionStartedAt?.toISOString() ?? null, at(8 * H).toISOString());
eq("foldToday sums every open session today", multi.activeSeconds, H / 1000 + (3 * H) / 1000);

// Clock skew: a heartbeat older than the start must never produce negative time.
eq("foldToday clamps negative elapsed", foldToday([], [session(at(5 * H), at(4 * H))], today).activeSeconds, 0);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`trackerMe.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
