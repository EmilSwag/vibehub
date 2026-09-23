// Contract pins for lib/feedEvents.ts — plain assertions, no test framework, same
// pattern as format.check.ts. Run from web/:
//   node --import tsx src/lib/__checks__/feedEvents.check.ts
// (or `npm run test:checks` for all of them). Exits non-zero when any expectation fails.
//
// What is pinned: the relative-time shapes a feed row prints, the optimistic reaction
// toggle (and that applying it twice is the rollback), the server's answer winning
// over the guess, and "Load more" never doubling a row.

import { appendPage, applyReactionResult, feedTimeLabel, toggleReactionLocally, updateEvent } from "../feedEvents";
import { formatShortDate } from "../format";
import type { FeedEvent } from "../../types";

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

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const event = (id: string, overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  id,
  type: "session",
  at: ago(HOUR),
  user: { username: "ada", displayName: "Ada Lovelace", avatarUrl: null },
  title: "Coded 1h 24m in atlas",
  description: "Claude Code · Claude Opus 5",
  reactions: { respect: 2, flame: 0, mine: { respect: false, flame: false } },
  ...overrides,
});

// ---- feedTimeLabel ----
eq("live → now, whatever `at` says", feedTimeLabel({ at: ago(3 * DAY), live: true }, NOW), "now");
eq("0s → just now", feedTimeLabel({ at: ago(0) }, NOW), "just now");
eq("45s → just now", feedTimeLabel({ at: ago(45_000) }, NOW), "just now");
eq("14m → 14m ago", feedTimeLabel({ at: ago(14 * MIN) }, NOW), "14m ago");
eq("1h 42m → 1h 42m ago", feedTimeLabel({ at: ago(HOUR + 42 * MIN) }, NOW), "1h 42m ago");
eq("23h 59m → still minutes", feedTimeLabel({ at: ago(23 * HOUR + 59 * MIN) }, NOW), "23h 59m ago");
eq("24h → yesterday", feedTimeLabel({ at: ago(DAY) }, NOW), "yesterday");
eq("5d → 5d ago", feedTimeLabel({ at: ago(5 * DAY) }, NOW), "5d ago");
{
  const iso = ago(40 * DAY);
  eq("40d → the date (formatShortDate delegate)", feedTimeLabel({ at: iso }, NOW), formatShortDate(iso));
}
eq("future (clock skew) → just now, never negative", feedTimeLabel({ at: new Date(NOW + 5 * MIN).toISOString() }, NOW), "just now");
eq("garbage → empty, never Invalid Date", feedTimeLabel({ at: "not-a-date" }, NOW), "");

// ---- toggleReactionLocally ----
{
  const off = event("session:1");
  const on = toggleReactionLocally(off, "respect");
  eq("off → on: count +1, mine true", on.reactions, { respect: 3, flame: 0, mine: { respect: true, flame: false } });
  eq("input not mutated", off.reactions, { respect: 2, flame: 0, mine: { respect: false, flame: false } });
  eq("on → off: count -1, mine false", toggleReactionLocally(on, "respect").reactions, off.reactions);
  eq("toggling twice restores the original (the rollback)", toggleReactionLocally(toggleReactionLocally(off, "flame"), "flame"), off);
  eq("the other kind is untouched", toggleReactionLocally(off, "flame").reactions.respect, 2);
}
{
  const stale = event("session:2", { reactions: { respect: 0, flame: 0, mine: { respect: true, flame: false } } });
  eq("a count never drops below 0 (stale mine=true with count 0)", toggleReactionLocally(stale, "respect").reactions.respect, 0);
}

// ---- applyReactionResult ----
{
  const guessed = toggleReactionLocally(event("achievement:u:deep-flow"), "respect"); // respect 3, mine true
  const settled = applyReactionResult(guessed, { target: "achievement:u:deep-flow", kind: "respect", active: true, count: 5 });
  eq("server count wins over the optimistic guess", settled.reactions, { respect: 5, flame: 0, mine: { respect: true, flame: false } });
  const raced = applyReactionResult(guessed, { target: "achievement:u:deep-flow", kind: "respect", active: false, count: 2 });
  eq("server active wins too (a raced double tap)", raced.reactions, { respect: 2, flame: 0, mine: { respect: false, flame: false } });
  eq("a result for another target is ignored", applyReactionResult(guessed, { target: "session:9", kind: "respect", active: false, count: 0 }), guessed);
  eq("a negative count is clamped", applyReactionResult(guessed, { target: "achievement:u:deep-flow", kind: "flame", active: true, count: -1 }).reactions.flame, 0);
}

// ---- updateEvent keeps every other row's identity ----
{
  const a = event("session:a");
  const b = event("session:b");
  const next = updateEvent([a, b], "session:b", (e) => toggleReactionLocally(e, "flame"));
  eq("only the matching row changes", next.map((e) => e.reactions.flame), [0, 1]);
  eq("the untouched row is the same object", next[0] === a, true);
  eq("an unknown id changes nothing", updateEvent([a, b], "session:zzz", () => event("x")).map((e) => e.id), ["session:a", "session:b"]);
}

// ---- appendPage ----
{
  const first = [event("session:1", { at: ago(HOUR) }), event("session:2", { at: ago(2 * HOUR) })];
  const second = [event("session:2", { at: ago(2 * HOUR + MIN) }), event("commits:u:2026-09-20", { at: ago(3 * DAY) })];
  eq("appendPage keeps existing rows first and drops a repeated id", appendPage(first, second).map((e) => e.id), [
    "session:1",
    "session:2",
    "commits:u:2026-09-20",
  ]);
  eq("appendPage keeps the row already on screen, not the repeat", appendPage(first, second)[1].at, ago(2 * HOUR));
  eq("appendPage of an empty page is the same list", appendPage(first, []).map((e) => e.id), ["session:1", "session:2"]);
}

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`feedEvents.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
