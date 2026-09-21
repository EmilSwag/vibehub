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

const offline: PresenceSnapshot = { username: "emil", status: "offline", activity: null, tools: [], lastSeenAt: null };
const activeAt = (
  username: string,
  project: string,
  tool: string,
  model: string | null,
  lastSeenAt: string | null = at(11 * H).toISOString(),
  // null = this tool has no token counter anywhere (Quadcode); never 0-as-unknown.
  tokens: number | null = 0
): PresenceSnapshot => ({
  username,
  status: "active",
  activity: { projectAlias: project, tool, model, tokens, startedAt: at(10 * H).toISOString() },
  tools: [],
  lastSeenAt,
});
const idleAt = (username: string, lastSeenAt: string | null = at(11 * H).toISOString()): PresenceSnapshot => ({
  username,
  status: "idle",
  activity: { projectAlias: "dozing", tool: "cursor", model: null, tokens: 0, startedAt: at(9 * H).toISOString() },
  tools: [],
  lastSeenAt,
});
// Offline does not mean "never seen" — self can go offline after being seen earlier.
const offlineSeenAt = (username: string, lastSeenAt: string | null): PresenceSnapshot => ({
  username,
  status: "offline",
  activity: null,
  tools: [],
  lastSeenAt,
});

const base: TrackerMeInput = {
  user: ME,
  level: 7,
  presence: activeAt("emil", "vibehub", "claude-code", "claude-opus-5"),
  today: { activeSeconds: 8_040, tokens: 125_000, sessionStartedAt: at(10 * H), estimatedUsd: 1.25, byModel: { "claude-opus-5": 1.25 } },
  lastSeenAt: at(11 * H),
  devices: [{ label: "MacBook Pro", lastSeenAt: at(11 * H) }],
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
  tokens: 0,
  since: at(10 * H).toISOString(),
});
eq("presence.lastSeenAt", full.presence.lastSeenAt, at(11 * H).toISOString());
eq("presence keys", Object.keys(full.presence), ["status", "activity", "lastSeenAt"]);
eq("today", full.today, {
  activeSeconds: 8_040,
  tokens: 125_000,
  sessionStartedAt: at(10 * H).toISOString(),
  // Lane B (mac app): ≈$ for the Island pill, passed through from foldToday untouched.
  estimatedUsd: 1.25,
  byModel: { "claude-opus-5": 1.25 },
});
eq("today keys", Object.keys(full.today), ["activeSeconds", "tokens", "sessionStartedAt", "estimatedUsd", "byModel"]);
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
eq("presence.lastSeenAt(never seen)", off.presence.lastSeenAt, null);

// Offline is not the same as "never seen": self can be offline yet still report when
// they were last online, exactly like an offline friend would if this route showed them.
const staleOffline = buildTrackerMePayload({ ...base, presence: offlineSeenAt("emil", at(2 * H).toISOString()) });
eq("presence.lastSeenAt survives while offline", staleOffline.presence, {
  status: "offline",
  activity: null,
  lastSeenAt: at(2 * H).toISOString(),
});

// A presence-only tool reports no model: the segment degrades to null, and the tool is
// never dropped (the tracker detection contract).
eq(
  "model:null survives, tool does not",
  buildTrackerMePayload({ ...base, presence: activeAt("emil", "neon", "cursor", null) }).presence.activity,
  { project: "neon", tool: "cursor", model: null, tokens: 0, since: at(10 * H).toISOString() }
);

// Round 4: a tokenless tool reports unknown as null all the way to the wire. A 0 here
// would tell the app a measurement was taken and came back empty, which is false.
eq(
  "tokenless tool reports null tokens, never 0",
  buildTrackerMePayload({ ...base, presence: activeAt("emil", "vibehub", "quadcode", "claude-fable-5-1", at(11 * H).toISOString(), null) }).presence.activity,
  { project: "vibehub", tool: "quadcode", model: "claude-fable-5-1", tokens: null, since: at(10 * H).toISOString() }
);

// ---- the Round 5 trap: connected must not come from token lastUsedAt ----
// Even if a caller supplies legacy authentication metadata, it cannot become a
// connection timestamp on either the account or its device.
const verifiedOnlyDevice = { label: "MacBook Pro", lastSeenAt: null, lastUsedAt: at(11 * H) };
eq(
  "connected and lastSeenAt ignore a freshly-verified device token",
  buildTrackerMePayload({
    ...base,
    presence: offline,
    lastSeenAt: null,
    devices: [verifiedOnlyDevice],
  }).tracker,
  { connected: false, lastSeenAt: null, devices: [{ name: "MacBook Pro", lastSeenAt: null }] }
);

// ---- nulls the app must tolerate ----
eq(
  "brand-new account: no display name, no avatar, no device, nothing seen",
  buildTrackerMePayload({
    ...base,
    user: { id: "u_new", username: "newbie", displayName: null, avatarUrl: null },
    level: 1,
    presence: offline,
    today: { activeSeconds: 0, tokens: 0, sessionStartedAt: null, estimatedUsd: 0, byModel: {} },
    lastSeenAt: null,
    devices: [],
  }),
  {
    user: { id: "u_new", username: "newbie", displayName: null, avatarUrl: null, level: 1 },
    presence: { status: "offline", activity: null, lastSeenAt: null },
    today: { activeSeconds: 0, tokens: 0, sessionStartedAt: null, estimatedUsd: 0, byModel: {} },
    tracker: { connected: false, lastSeenAt: null, devices: [] },
    friendsOnline: { count: 0, sample: [] },
  }
);
eq(
  "device that has never been used",
  buildTrackerMePayload({ ...base, devices: [{ label: "iMac", lastSeenAt: null }] }).tracker.devices,
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
    activity: { project: "atlas", tool: "codex", model: "gpt-5-codex", tokens: 0, since: at(10 * H).toISOString() },
    lastSeenAt: at(11 * H).toISOString(),
  },
  {
    username: "cy",
    displayName: "CY",
    avatarUrl: null,
    status: "idle",
    activity: { project: "dozing", tool: "cursor", model: null, tokens: 0, since: at(9 * H).toISOString() },
    lastSeenAt: at(11 * H).toISOString(),
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
// Rows default to claude-opus-5 ($5 / $25 per million input / output, lib/token-pricing.ts),
// so the ≈$ pins below are: input tokens × 5e-6 + output tokens × 25e-6.
const stat = (date: Date, activeSeconds: number, tokensInput: number, tokensOutput: number, model = "claude-opus-5") => ({
  date,
  model,
  activeSeconds,
  tokensInput,
  tokensOutput,
});
const session = (startedAt: Date, lastHeartbeatAt: Date, tokensInput = 0, tokensOutput = 0, model: string | null = "claude-opus-5", tool = "claude-code") => ({
  tool,
  startedAt,
  lastHeartbeatAt,
  model,
  tokensInput,
  tokensOutput,
});
const yesterday = new Date(DAY - 86_400_000);

eq("foldToday(nothing)", foldToday([], [], today), { activeSeconds: 0, tokens: 0, sessionStartedAt: null, estimatedUsd: 0, byModel: {} });
eq("foldToday(closed work only)", foldToday([stat(today, 3_600, 10, 20)], [], today), {
  activeSeconds: 3_600,
  tokens: 30,
  sessionStartedAt: null,
  estimatedUsd: 0.00055,
  byModel: { "claude-opus-5": 0.00055 },
});
eq(
  "foldToday drops DailyStat rows from other days",
  foldToday([stat(yesterday, 9_999, 999, 999), stat(today, 60, 1, 1)], [], today),
  { activeSeconds: 60, tokens: 2, sessionStartedAt: null, estimatedUsd: 0.00003, byModel: { "claude-opus-5": 0.00003 } }
);
// Open session elapsed is measured to lastHeartbeatAt, never to now — a tracker that
// died mid-session must stop accruing.
// foldToday runs pre-serialization, so sessionStartedAt is still a Date — assert it
// through toISOString() rather than against the payload's string form.
const folded = foldToday([stat(today, 3_600, 10, 20)], [session(at(10 * H), at(11 * H), 5, 5)], today);
eq("foldToday.activeSeconds", folded.activeSeconds, 7_200);
eq("foldToday.tokens", folded.tokens, 40);
eq("foldToday.sessionStartedAt", folded.sessionStartedAt?.toISOString() ?? null, at(10 * H).toISOString());
// The open session's live tokens are priced too (5 in + 5 out at opus-5 = $0.00015 on top of $0.00055).
eq("foldToday.estimatedUsd prices closed rows and the open session", folded.estimatedUsd, 0.0007);
eq("foldToday.byModel merges rows of one model", folded.byModel, { "claude-opus-5": 0.0007 });

// ---- ≈$ rules the Island must be able to rely on ----
// A presence-only tool has no model: its tokens count, but nothing can be priced.
const unpriced = foldToday([], [session(at(10 * H), at(11 * H), 5, 5, null)], today);
eq("foldToday: null-model tokens are counted", unpriced.tokens, 10);
eq("foldToday: null-model tokens are not priced", [unpriced.estimatedUsd, unpriced.byModel], [null, {}]);
// The DailyStat "unknown" bucket (LEGACY_UNKNOWN_MODEL) is unpriced the same way.
eq("foldToday: the unknown bucket is not priced", foldToday([stat(today, 60, 100, 100, "unknown")], [], today).estimatedUsd, null);
// Mixed: priced models report their part; the unpriced remainder is simply absent.
const partial = foldToday([stat(today, 0, 1_000_000, 0, "gpt-4.1"), stat(today, 0, 7, 0, "unknown")], [], today);
eq("foldToday: mixed day prices what it can", [partial.tokens, partial.estimatedUsd], [1_000_007, 2]);
eq("foldToday: byModel lists priced models only", partial.byModel, { "gpt-4.1": 2 });
// Yesterday's still-open session is excluded from today's ≈$ exactly as from its time.
eq("foldToday: overnight session is not priced into today", foldToday([], [session(at(-2 * H), at(1 * H), 1_000_000, 0)], today).estimatedUsd, 0);

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

// ---- Round 4: a tokenless tool measures nothing, so cost is unknown, not zero ----
// Quadcode reports activity and model but no counts anywhere in its format. A priced
// zero-token row would make the day read as $0.00 spent, which is a claim; unknown is
// the truth, so the fold must return null.
const tokenless = foldToday([], [session(at(10 * H), at(11 * H), 0, 0, "claude-fable-5-1", "quadcode")], today);
eq("foldToday: a tokenless-only day reports estimatedUsd null, never 0", tokenless.estimatedUsd, null);
// Superseded by the payload rule below: the count is UNKNOWN, not a measured zero.
eq("foldToday: a tokenless-only day reports tokens null, never 0", tokenless.tokens, null);
eq("foldToday: a tokenless-only day prices no model", tokenless.byModel, {});
eq("foldToday: a tokenless session still accrues its elapsed time", tokenless.activeSeconds, 3_600);

// An empty day is still a real zero - the null above must not leak into it.
eq("foldToday: an empty day still reports estimatedUsd 0", foldToday([], [], today).estimatedUsd, 0);

// A mixed day still reports the priced part: the tokenless row must not void it.
const mixedTokenless = foldToday(
  [stat(today, 0, 1_000_000, 0, "gpt-4.1")],
  [session(at(10 * H), at(11 * H), 0, 0, "claude-fable-5-1", "quadcode")],
  today
);
eq("foldToday: a mixed day still prices the measured part", (mixedTokenless.estimatedUsd ?? 0) > 0, true);
eq("foldToday: the mixed day counts only measured tokens", mixedTokenless.tokens, 1_000_000);
// ---- the wire contract the app decodes: unknown reaches the PAYLOAD as null ----
// foldToday is where the rule lives, but the app reads buildTrackerMePayload. Pin the
// whole path, not just the fold, or a passthrough regression would go unnoticed.
const quadcodeDay = foldToday([], [session(at(10 * H), at(11 * H), 0, 0, "claude-fable-5-1", "quadcode")], today);
const quadcodePayload = buildTrackerMePayload({ ...base, today: quadcodeDay });
eq("payload today.tokens is null for a Quadcode-only day", quadcodePayload.today.tokens, null);
eq("payload today.estimatedUsd is null for a Quadcode-only day", quadcodePayload.today.estimatedUsd, null);
eq("payload today.byModel stays empty for a Quadcode-only day", quadcodePayload.today.byModel, {});
eq("payload today keys are unchanged by the nullable tokens", Object.keys(quadcodePayload.today),
  ["activeSeconds", "tokens", "sessionStartedAt", "estimatedUsd", "byModel"]);

// A genuine measured zero must survive: a measuring tool that really used nothing
// reports 0, and that 0 must NOT be rewritten to null by the rule above.
const measuredZero = foldToday([], [session(at(10 * H), at(11 * H), 0, 0, "claude-opus-5", "claude-code")], today);
const measuredZeroPayload = buildTrackerMePayload({ ...base, today: measuredZero });
eq("a measuring tool that used nothing reports 0, not null", measuredZeroPayload.today.tokens, 0);
eq("...and its day is priced at 0, not unknown", measuredZeroPayload.today.estimatedUsd, 0);

// An empty day has nothing to be unknown about.
eq("an empty day still reports tokens 0 on the payload",
  buildTrackerMePayload({ ...base, today: foldToday([], [], today) }).today.tokens, 0);

// A mixed day reports its measured count, unreduced by the tokenless session.
eq("a mixed day reports only the measured tokens on the payload",
  buildTrackerMePayload({ ...base, today: mixedTokenless }).today.tokens, 1_000_000);
// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`trackerMe.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
