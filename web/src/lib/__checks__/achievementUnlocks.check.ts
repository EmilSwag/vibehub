// Contract pins for lib/achievementUnlocks.ts and the copy-only lib/achievements.ts —
// plain assertions, no test framework, same pattern as format.check.ts. Run from web/:
//   node --import tsx src/lib/__checks__/achievementUnlocks.check.ts
// (or `npm run test:checks` for all of them). Exits non-zero when any expectation fails.
//
// What is pinned: the first run on a device seeds silently, later runs announce only
// ids that are unlocked now and unseen before, the seen set only grows, and anything
// unreadable in storage is treated as "never looked" — never as "announce everything".

import { diffUnlocks, readSeen, seenStorageKey, writeSeen } from "../achievementUnlocks";
import type { StorageLike } from "../achievementUnlocks";
import { ACHIEVEMENT_IDS, ACHIEVEMENTS_DEF, isAchievementId, knownAchievements, pickPreview, unlockedLabel } from "../achievements";
import { formatShortDate } from "../format";
import type { Achievement, AchievementId } from "../../types";

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual, (_k, v: unknown) => (v instanceof Set ? [...v].sort() : v));
  const e = JSON.stringify(expected, (_k, v: unknown) => (v instanceof Set ? [...v].sort() : v));
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} → ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;

const badge = (id: AchievementId, unlocked: boolean, progress = unlocked ? 1 : 0.5, unlockedAt: string | null = unlocked ? ago(DAY) : null): Achievement => ({
  id,
  unlocked,
  progress,
  progressLabel: unlocked ? "done" : "half",
  unlockedAt,
});

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

// ---- the contract's fixed ids and their copy ----
eq("ACHIEVEMENT_IDS is the contract list, in order", [...ACHIEVEMENT_IDS], [
  "token-millionaire",
  "opus-tamer",
  "night-owl",
  "deep-flow",
  "polyglot",
  "streak-master",
]);
eq(
  "every id has a title, tagline, description and requirement",
  ACHIEVEMENT_IDS.every((id) => {
    const d = ACHIEVEMENTS_DEF[id];
    return [d.title, d.tagline, d.description, d.requirement].every((s) => typeof s === "string" && s.trim().length > 0);
  }),
  true
);
eq("isAchievementId accepts a contract id", isAchievementId("night-owl"), true);
eq("isAchievementId rejects a stranger", isAchievementId("level-165"), false);
eq("isAchievementId rejects a non-string", isAchievementId(42), false);

// ---- knownAchievements: unknown ids skipped, order kept ----
const wire = [
  { id: "deep-flow", unlocked: true },
  { id: "time-traveller", unlocked: true },
  { id: "polyglot", unlocked: false },
];
eq(
  "knownAchievements drops an id this build cannot draw, keeps the rest in order",
  knownAchievements(wire).map((r) => r.id),
  ["deep-flow", "polyglot"]
);
eq("knownAchievements of nothing is nothing", knownAchievements([]), []);

// ---- seen storage key ----
eq("seenStorageKey is per account", seenStorageKey("user_1"), "vh.achievements.seen.user_1");

// ---- readSeen: null means never looked; an empty set means looked and saw nothing ----
const KEY = seenStorageKey("u");
eq("readSeen: no storage → null", readSeen(null, KEY), null);
eq("readSeen: missing key → null", readSeen(new MemoryStorage(), KEY), null);
{
  const s = new MemoryStorage();
  s.setItem(KEY, "[]");
  eq("readSeen: empty array → empty set (not null)", readSeen(s, KEY), new Set<string>());
}
{
  const s = new MemoryStorage();
  s.setItem(KEY, JSON.stringify(["deep-flow", "night-owl"]));
  eq("readSeen: stored ids come back", readSeen(s, KEY), new Set(["deep-flow", "night-owl"]));
}
{
  const s = new MemoryStorage();
  s.setItem(KEY, JSON.stringify(["deep-flow", 7, null, { id: "x" }]));
  eq("readSeen: non-string entries are dropped", readSeen(s, KEY), new Set(["deep-flow"]));
}
{
  const s = new MemoryStorage();
  s.setItem(KEY, JSON.stringify({ seen: ["deep-flow"] }));
  eq("readSeen: a non-array value → null (seed again, announce nothing)", readSeen(s, KEY), null);
}
{
  const s = new MemoryStorage();
  s.setItem(KEY, "{not json");
  eq("readSeen: corrupt JSON → null", readSeen(s, KEY), null);
}
{
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  eq("readSeen: a throwing Storage → null", readSeen(throwing, KEY), null);
  let threw = false;
  try {
    writeSeen(throwing, KEY, new Set(["deep-flow"]));
  } catch {
    threw = true;
  }
  eq("writeSeen: a throwing Storage is swallowed", threw, false);
}

// ---- writeSeen: sorted, stable, round-trips ----
{
  const s = new MemoryStorage();
  writeSeen(s, KEY, new Set(["polyglot", "deep-flow", "night-owl"]));
  eq("writeSeen stores a sorted array", s.getItem(KEY), JSON.stringify(["deep-flow", "night-owl", "polyglot"]));
  eq("writeSeen → readSeen round-trips", readSeen(s, KEY), new Set(["deep-flow", "night-owl", "polyglot"]));
  writeSeen(null, KEY, new Set(["x"]));
  eq("writeSeen with no storage is a no-op", s.getItem(KEY), JSON.stringify(["deep-flow", "night-owl", "polyglot"]));
}

// ---- diffUnlocks ----
const twoUnlocked = [badge("token-millionaire", false, 0.8), badge("deep-flow", true), badge("night-owl", true), badge("polyglot", false)];

{
  const first = diffUnlocks(null, twoUnlocked);
  eq("first run announces nothing", first.announce.map((a) => a.id), []);
  eq("first run records every unlocked id", first.next, new Set(["deep-flow", "night-owl"]));
}
{
  const again = diffUnlocks(new Set(["deep-flow", "night-owl"]), twoUnlocked);
  eq("same state again announces nothing", again.announce.map((a) => a.id), []);
  eq("same state again stores the same set", again.next, new Set(["deep-flow", "night-owl"]));
}
{
  const grown = diffUnlocks(new Set(["deep-flow"]), twoUnlocked);
  eq("a newly unlocked id is announced", grown.announce.map((a) => a.id), ["night-owl"]);
  eq("…and recorded", grown.next, new Set(["deep-flow", "night-owl"]));
}
{
  const empty = diffUnlocks(new Set(), twoUnlocked);
  eq("an empty seen set (looked, saw nothing) announces every unlocked id, in display order", empty.announce.map((a) => a.id), ["deep-flow", "night-owl"]);
}
{
  const kept = diffUnlocks(new Set(["streak-master"]), twoUnlocked);
  eq("a seen id the server no longer lists as unlocked stays seen (earned stays earned, no re-fire later)", kept.next, new Set(["streak-master", "deep-flow", "night-owl"]));
}
{
  const locked = diffUnlocks(new Set(), [badge("polyglot", false, 0.99)]);
  eq("a locked badge is never announced, however close", locked.announce, []);
  eq("…nor recorded", locked.next, new Set<string>());
}
{
  const order = diffUnlocks(new Set(), [badge("streak-master", true), badge("token-millionaire", true)]);
  eq("announce keeps the server's order, not alphabetical", order.announce.map((a) => a.id), ["streak-master", "token-millionaire"]);
}

// ---- unlockedLabel: the stored moment, day-grained, never "Invalid Date" ----
eq("unlockedLabel today", unlockedLabel(ago(2 * 3_600_000), NOW), "Unlocked today");
eq("unlockedLabel yesterday", unlockedLabel(ago(DAY + 3_600_000), NOW), "Unlocked yesterday");
eq("unlockedLabel 5d ago", unlockedLabel(ago(5 * DAY), NOW), "Unlocked 5d ago");
{
  const iso = ago(40 * DAY);
  eq("unlockedLabel beyond 30d → the date", unlockedLabel(iso, NOW), `Unlocked ${formatShortDate(iso)}`);
}
eq("unlockedLabel null → plain Unlocked", unlockedLabel(null, NOW), "Unlocked");
eq("unlockedLabel garbage → plain Unlocked", unlockedLabel("not-a-date", NOW), "Unlocked");

// ---- pickPreview: the badge the owner is closest to earning ----
eq(
  "pickPreview: the locked badge with the highest progress",
  pickPreview([badge("deep-flow", true), badge("polyglot", false, 0.33), badge("token-millionaire", false, 0.81)])?.id,
  "token-millionaire"
);
eq(
  "pickPreview: all unlocked → the most recently unlocked",
  pickPreview([badge("deep-flow", true, 1, ago(10 * DAY)), badge("night-owl", true, 1, ago(DAY)), badge("polyglot", true, 1, ago(3 * DAY))])?.id,
  "night-owl"
);
eq("pickPreview: nothing → null", pickPreview([]), null);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`achievementUnlocks.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
