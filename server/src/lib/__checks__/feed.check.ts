// Contract pins for lib/feed.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx server/src/lib/__checks__/feed.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.
//
// Pins the wire contract in meta/plans/vibehub-honest-achievements-feed.md: stable
// event ids (= reaction targets), the event sources and their thresholds, ordering,
// the 30-day window and 200 cap, cursor paging, the reaction fold and the target regex.
// The shaping is pure, so this runs without a database or a server.

import {
  FEED_CAP,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  FEED_MIN_SESSION_SECONDS,
  FEED_WINDOW_DAYS,
  PROJECT_UPDATE_GAP_MS,
  REACTION_TARGET_RE,
  buildFeedEvents,
  feedQuerySchema,
  feedReactionSchema,
  foldReactions,
  formatDuration,
  interleaveRecommended,
  isReactionTarget,
  modelLabel,
  pageEvents,
  scoreRecommendedPost,
  toolLabel,
  type FeedEventCore,
  type FeedProjectRow,
  type FeedRows,
  type FeedScope,
  type FeedSessionRow,
  type FeedUser,
} from "../feed";

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

// ---- fixtures ----
const T0 = Date.UTC(2026, 8, 7, 12, 0, 0); // 2026-09-07T12:00:00Z
const H = 3_600_000;
const M = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0 + ms);
const NOW = at(0);
const IDLE_MS = 600_000;

const ada: FeedUser = { username: "ada", displayName: "Ada Lovelace", avatarUrl: "https://cdn/ada.png" };
const linus: FeedUser = { username: "linus", displayName: "Linus T.", avatarUrl: null };
const grace: FeedUser = { username: "grace", displayName: "Grace Hopper", avatarUrl: null };
const users = new Map<string, FeedUser>([
  ["u_ada", ada],
  ["u_linus", linus],
  ["u_grace", grace],
]);

const rows = (partial: Partial<FeedRows> = {}): FeedRows => ({
  users,
  sessions: [],
  achievements: [],
  projects: [],
  commitDays: [],
  friendships: [],
  ...partial,
});
const scope = (userIds: string[] = ["u_ada", "u_linus"], now = NOW): FeedScope => ({ userIds, now, idleTimeoutMs: IDLE_MS });
const build = (partial: Partial<FeedRows> = {}, s: FeedScope = scope()) => buildFeedEvents(rows(partial), s);

const session = (overrides: Partial<FeedSessionRow> = {}): FeedSessionRow => ({
  id: "s1",
  userId: "u_ada",
  projectAlias: "atlas",
  tool: "claude-code",
  model: "claude-opus-5",
  status: "ENDED",
  startedAt: at(-3 * H),
  endedAt: at(-3 * H + 84 * M),
  lastHeartbeatAt: at(-3 * H + 84 * M),
  ...overrides,
});
const project = (overrides: Partial<FeedProjectRow> = {}): FeedProjectRow => ({
  id: "p1",
  ownerId: "u_ada",
  name: "vibehub",
  description: "Steam for AI-assisted devs.",
  createdAt: at(-2 * DAY),
  updatedAt: at(-2 * DAY),
  ...overrides,
});

// ---- constants are the contract's numbers ----
eq("window / cap / limits / thresholds", [FEED_WINDOW_DAYS, FEED_CAP, FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT, FEED_MIN_SESSION_SECONDS, PROJECT_UPDATE_GAP_MS], [30, 200, 30, 100, 600, 3_600_000]);

// ---- target regex ----
for (const target of ["post:p123", "session:abc", "achievement:u1:deep-flow", "project:p1:new", "project:p1:upd:2026-09-22", "commits:u1:2026-09-22", "friendship:f1", `post:${"x".repeat(120)}`]) {
  eq(`target ok: ${target.slice(0, 40)}`, isReactionTarget(target), true);
}
for (const target of ["bad:1", "session:", "session:has space", `session:${"x".repeat(121)}`, "SESSION:abc", "session:a/b", "session:a.b", "", "session", ":abc", 7, null]) {
  eq(`target refused: ${JSON.stringify(target).slice(0, 40)}`, isReactionTarget(target), false);
}
eq("REACTION_TARGET_RE is the contract regex", REACTION_TARGET_RE.source, "^(post|session|achievement|project|commits|friendship):[A-Za-z0-9:_-]{1,120}$");
eq("reaction body: kind unknown refused", feedReactionSchema.safeParse({ target: "post:abc", kind: "angry" }).success, false);
eq("reaction body: a bad target is refused", feedReactionSchema.safeParse({ target: "bad:1", kind: "flame" }).success, false);
eq("reaction body: like ok", feedReactionSchema.parse({ target: "post:abc", kind: "like" }), { target: "post:abc", kind: "like" });
eq("reaction body: respect ok", feedReactionSchema.parse({ target: "post:abc", kind: "respect" }), { target: "post:abc", kind: "respect" });

// ---- query parsing ----
eq("query defaults", feedQuerySchema.parse({}), { limit: 30 });
eq("query limit is coerced and capped at 100", [feedQuerySchema.parse({ limit: "100" }).limit, feedQuerySchema.safeParse({ limit: "101" }).success, feedQuerySchema.safeParse({ limit: "0" }).success], [100, false, false]);
eq("query before must be an ISO instant", [feedQuerySchema.safeParse({ before: "yesterday" }).success, feedQuerySchema.parse({ before: "2026-09-07T10:00:00.000Z" }).before], [false, "2026-09-07T10:00:00.000Z"]);

// ---- labels ----
eq("toolLabel", ["claude-code", "codex", "cursor", "quadcode", "my-tool", "unknown", ""].map(toolLabel), ["Claude Code", "Codex CLI", "Cursor", "Quadcode AI", "My Tool", "Unknown tool", "Unknown tool"]);
eq("modelLabel", ["claude-opus-5", "claude-sonnet-4-5-20250929", "gpt-5-codex", "gpt-4.1", "o3", "gemini-2.5-pro", "grok-4", null, "<synthetic>", "unknown"].map(modelLabel), ["Claude Opus 5", "Claude Sonnet 4.5", "GPT-5 Codex", "GPT-4.1", "o3", "Gemini 2.5 Pro", "Grok 4", null, null, null]);
eq("formatDuration", [84 * 60, 600, 59, 7_200, 0].map(formatDuration), ["1h 24m", "10m", "0m", "2h 0m", "0m"]);

// ---- sessions ----
const [coded] = build({ sessions: [session()] });
eq("finished session event", coded, {
  id: "session:s1",
  type: "session",
  at: at(-3 * H + 84 * M).toISOString(),
  user: ada,
  title: "Coded 1h 24m in atlas",
  description: "Claude Code · Claude Opus 5",
});
eq("finished session has no live key", Object.hasOwn(coded, "live"), false);
eq("a 599 s session is not worth a line", build({ sessions: [session({ startedAt: at(-H), endedAt: at(-H + 599_000), lastHeartbeatAt: at(-H + 599_000) })] }), []);
eq("a 600 s session is", build({ sessions: [session({ startedAt: at(-H), endedAt: at(-H + 600_000), lastHeartbeatAt: at(-H + 600_000) })] })[0]?.title, "Coded 10m in atlas");
eq("no model → tool only", build({ sessions: [session({ tool: "cursor", model: null })] })[0]?.description, "Cursor");
eq("legacy sentinel model → tool only", build({ sessions: [session({ model: "<synthetic>" })] })[0]?.description, "Claude Code");
const live = build({ sessions: [session({ status: "ACTIVE", endedAt: null, startedAt: at(-7 * M), lastHeartbeatAt: at(-M) })] })[0];
eq("open + beating session is live, at its last beat, whatever its length", live, {
  id: "session:s1",
  type: "session",
  at: at(-M).toISOString(),
  live: true,
  user: ada,
  title: "Coding in atlas",
  description: "Claude Code · Claude Opus 5",
});
const stale = build({ sessions: [session({ status: "ACTIVE", endedAt: null, startedAt: at(-40 * M), lastHeartbeatAt: at(-20 * M) })] })[0];
eq("open but silent past the idle edge is a finished session ending at its last beat", [stale?.live, stale?.title, stale?.at], [undefined, "Coded 20m in atlas", at(-20 * M).toISOString()]);
eq("open, silent AND short is dropped like any short session", build({ sessions: [session({ status: "IDLE", endedAt: null, startedAt: at(-25 * M), lastHeartbeatAt: at(-20 * M) })] }), []);
eq("a session of someone outside the scope is not shown", build({ sessions: [session({ userId: "u_grace" })] }), []);
eq("a session of an unknown user is not shown", build({ sessions: [session({ userId: "u_ghost" })] }, scope(["u_ghost"])), []);

// ---- achievements ----
eq("achievement event", build({ achievements: [{ userId: "u_linus", achievementId: "deep-flow", unlockedAt: at(-H) }] }), [
  { id: "achievement:u_linus:deep-flow", type: "achievement", at: at(-H).toISOString(), user: linus, title: "Unlocked Deep Flow", description: null, badgeId: "deep-flow" },
]);
eq("every known badge has a title", ["token-millionaire", "opus-tamer", "night-owl", "polyglot", "streak-master"].map((id) => build({ achievements: [{ userId: "u_ada", achievementId: id, unlockedAt: at(-H) }] })[0]?.title), ["Unlocked Token Millionaire", "Unlocked Opus Tamer", "Unlocked Night Owl", "Unlocked Polyglot", "Unlocked Streak Master"]);
eq("an unknown badge id is ignored, not invented", build({ achievements: [{ userId: "u_ada", achievementId: "overachiever", unlockedAt: at(-H) }] }), []);

// ---- projects ----
eq("new project event", build({ projects: [project()] }), [
  { id: "project:p1:new", type: "project", at: at(-2 * DAY).toISOString(), user: ada, title: "New project: vibehub", description: "Steam for AI-assisted devs.", projectId: "p1" },
]);
const updated = build({ projects: [project({ updatedAt: at(-DAY + 2 * H) })] });
eq("updated > 1h after creation adds one dated update line", updated.map((e) => [e.id, e.title, e.at]), [
  ["project:p1:upd:2026-09-06", "Updated vibehub", at(-DAY + 2 * H).toISOString()],
  ["project:p1:new", "New project: vibehub", at(-2 * DAY).toISOString()],
]);
eq("updated within 1h of creation is just the creation", build({ projects: [project({ updatedAt: at(-2 * DAY + 59 * M) })] }).map((e) => e.id), ["project:p1:new"]);
eq("updated exactly 1h after creation is not an update (strictly greater)", build({ projects: [project({ updatedAt: at(-2 * DAY + H) })] }).map((e) => e.id), ["project:p1:new"]);
eq("project with no description", build({ projects: [project({ description: null })] })[0]?.description, null);

// ---- commits ----
eq("commit day event", build({ commitDays: [{ userId: "u_ada", date: new Date(Date.UTC(2026, 8, 5)), commitCount: 14 }] }), [
  { id: "commits:u_ada:2026-09-05", type: "commits", at: "2026-09-05T00:00:00.000Z", user: ada, title: "Pushed 14 commits", description: null },
]);
eq("one commit is singular", build({ commitDays: [{ userId: "u_ada", date: new Date(Date.UTC(2026, 8, 5)), commitCount: 1 }] })[0]?.title, "Pushed 1 commit");
eq("zero commits is not an event", build({ commitDays: [{ userId: "u_ada", date: new Date(Date.UTC(2026, 8, 5)), commitCount: 0 }] }), []);

// ---- friendships ----
eq("friendship: the in-scope side is `user`, the other party is `other`", build({ friendships: [{ id: "f1", userAId: "u_ada", userBId: "u_grace", since: at(-H) }] }), [
  { id: "friendship:f1", type: "friendship", at: at(-H).toISOString(), user: ada, other: grace, title: "became friends", description: null },
]);
eq("friendship: works when the scope member is the B side", build({ friendships: [{ id: "f1", userAId: "u_grace", userBId: "u_linus", since: at(-H) }] })[0]?.user, linus);
eq("friendship between two scope members yields ONE event, A side as user", build({ friendships: [{ id: "f2", userAId: "u_ada", userBId: "u_linus", since: at(-H) }] }).map((e) => [e.id, e.user.username, e.other?.username]), [["friendship:f2", "ada", "linus"]]);
eq("friendship whose other party is unknown is skipped", build({ friendships: [{ id: "f3", userAId: "u_ada", userBId: "u_ghost", since: at(-H) }] }), []);
eq("friendship outside the scope is skipped", build({ friendships: [{ id: "f4", userAId: "u_grace", userBId: "u_ghost", since: at(-H) }] }), []);

// ---- ordering, window, cap, dedupe ----
const mixed = build({
  sessions: [session({ id: "s_old", startedAt: at(-2 * DAY), endedAt: at(-2 * DAY + H), lastHeartbeatAt: at(-2 * DAY + H) }), session({ id: "s_new" })],
  achievements: [{ userId: "u_linus", achievementId: "polyglot", unlockedAt: at(-30 * M) }],
  commitDays: [{ userId: "u_linus", date: new Date(Date.UTC(2026, 8, 7)), commitCount: 3 }],
  projects: [project({ createdAt: at(-3 * DAY), updatedAt: at(-3 * DAY) })],
});
eq("newest first", mixed.map((e) => e.id), ["achievement:u_linus:polyglot", "session:s_new", "commits:u_linus:2026-09-07", "session:s_old", "project:p1:new"]);
eq("a tie on `at` orders by id, deterministically", build({ sessions: [session({ id: "b" }), session({ id: "a" })] }).map((e) => e.id), ["session:a", "session:b"]);
eq("older than 30 days is outside the window", build({ projects: [project({ createdAt: at(-31 * DAY), updatedAt: at(-31 * DAY) })] }), []);
eq("exactly 30 days old is inside it", build({ projects: [project({ createdAt: at(-30 * DAY), updatedAt: at(-30 * DAY) })] }).length, 1);
const many = build({ sessions: Array.from({ length: 250 }, (_, i) => session({ id: `s${i}`, startedAt: at(-(i + 1) * H - H), endedAt: at(-(i + 1) * H), lastHeartbeatAt: at(-(i + 1) * H) })) });
eq("capped at 200 newest", [many.length, many[0].id, many[199].id], [200, "session:s0", "session:s199"]);
eq("duplicate ids collapse to one event", build({ sessions: [session(), session()] }).length, 1);

// ---- paging ----
const all = build({ sessions: Array.from({ length: 5 }, (_, i) => session({ id: `s${i}`, startedAt: at(-(i + 2) * H), endedAt: at(-(i + 1) * H), lastHeartbeatAt: at(-(i + 1) * H) })) });
const page1 = pageEvents(all, 2);
eq("page 1", [page1.events.map((e) => e.id), page1.nextBefore], [["session:s0", "session:s1"], at(-2 * H).toISOString()]);
const page2 = pageEvents(all, 2, new Date(page1.nextBefore!));
eq("page 2 is strictly older than the cursor", [page2.events.map((e) => e.id), page2.nextBefore], [["session:s2", "session:s3"], at(-4 * H).toISOString()]);
const page3 = pageEvents(all, 2, new Date(page2.nextBefore!));
eq("last page has no cursor", [page3.events.map((e) => e.id), page3.nextBefore], [["session:s4"], null]);
eq("a page that ends exactly at the end has no cursor", pageEvents(all, 5).nextBefore, null);
eq("an empty feed pages to nothing", pageEvents([], 30), { events: [], nextBefore: null });
// One sync stamps several unlocks with the same instant; a strict cursor must not lose the
// ones that fell past `limit`, so the page absorbs the whole tie.
const tied = build({
  achievements: ["deep-flow", "night-owl", "streak-master"].map((id) => ({ userId: "u_ada", achievementId: id, unlockedAt: at(-H) })),
  sessions: [session({ id: "s_older", startedAt: at(-4 * H), endedAt: at(-3 * H), lastHeartbeatAt: at(-3 * H) })],
});
const tiedPage1 = pageEvents(tied, 1);
eq("a tie on `at` is never split across pages", [tiedPage1.events.map((e) => e.id), tiedPage1.nextBefore], [
  ["achievement:u_ada:deep-flow", "achievement:u_ada:night-owl", "achievement:u_ada:streak-master"],
  at(-H).toISOString(),
]);
eq("...and the next page continues past the tie without losing anything", pageEvents(tied, 1, new Date(tiedPage1.nextBefore!)), { events: [tied[3]], nextBefore: null });
eq("a limit that lands exactly on a tie boundary does not over-extend", pageEvents(tied, 3).events.length, 3);
eq("walking a tied feed one page at a time visits every event exactly once", (() => {
  const seen: string[] = [];
  let cursor: Date | null = null;
  for (let i = 0; i < 10; i += 1) {
    const page: { events: FeedEventCore[]; nextBefore: string | null } = pageEvents(tied, 1, cursor);
    seen.push(...page.events.map((e) => e.id));
    if (!page.nextBefore) break;
    cursor = new Date(page.nextBefore);
  }
  return seen;
})(), tied.map((e) => e.id));

// ---- reactions ----
const core: FeedEventCore[] = build({ sessions: [session({ id: "s1" }), session({ id: "s2", startedAt: at(-5 * H), endedAt: at(-4 * H), lastHeartbeatAt: at(-4 * H) })] });
const folded = foldReactions(
  core,
  [
    { target: "session:s1", kind: "respect", count: 3 },
    { target: "session:s1", kind: "flame", count: 1 },
    { target: "session:s1", kind: "like", count: 99 },
    { target: "session:elsewhere", kind: "flame", count: 7 },
  ],
  [{ target: "session:s1", kind: "flame" }, { target: "session:s1", kind: "like" }]
);
eq("reactions folded onto the right event, unknown kinds ignored", folded.map((e) => [e.id, e.reactions]), [
  ["session:s1", { like: 99, respect: 3, flame: 1, mine: { like: true, respect: false, flame: true } }],
  ["session:s2", { like: 0, respect: 0, flame: 0, mine: { like: false, respect: false, flame: false } }],
]);
eq("signed-out viewer: mine is all false", foldReactions(core, [{ target: "session:s2", kind: "respect", count: 2 }], [])[1].reactions, { like: 0, respect: 2, flame: 0, mine: { like: false, respect: false, flame: false } });
eq("event keys with reactions and views", Object.keys(folded[0]), ["id", "type", "at", "user", "title", "description", "views", "reactions"]);

// ---- ranking and interleave ----
const pFresh = { likes: 10, reactions: 5, views: 20, createdAt: new Date(T0) };
const pOld = { likes: 10, reactions: 5, views: 20, createdAt: new Date(T0 - 48 * H) };
const scoreFresh = scoreRecommendedPost(pFresh, T0, 0.5);
const scoreOld = scoreRecommendedPost(pOld, T0, 0.5);
eq("fresh post ranks higher than 48h old post with same engagement", scoreFresh > scoreOld, true);

const conn = [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" }, { id: "c6" }];
const rec = [{ id: "r1" }, { id: "r2" }];
const mixedPosts = interleaveRecommended(conn, rec, 10);
eq("interleave inserts recommended ~1 in 4 (at index 3 and 7)", mixedPosts.map((p) => p.id), ["c1", "c2", "c3", "r1", "c4", "c5", "c6", "r2"]);

// ---- inputs are not mutated ----
const frozen = rows({ sessions: [session()], projects: [project()] });
const snapshot = JSON.stringify([...frozen.sessions, ...frozen.projects]);
buildFeedEvents(frozen, scope());
eq("rows untouched", JSON.stringify([...frozen.sessions, ...frozen.projects]), snapshot);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`feed.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
