// Contract pins for lib/achievements.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx server/src/lib/__checks__/achievements.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.
//
// The rules replace a web-side evaluator that unlocked badges from unrelated data
// (Night Owl from hours ≥ 10, Polyglot from hours > 20, a 7-day streak from hours > 30).
// Every pin below maps a badge to the rows that back it — and to nothing else. The
// evaluation is pure, so this runs without a database or a server.

import {
  ACHIEVEMENT_IDS,
  DEEP_FLOW_SECONDS,
  NIGHT_OWL_MIN_OVERLAP_MS,
  OPUS_TAMER_SECONDS,
  TOKEN_MILLIONAIRE_TOKENS,
  evaluateAchievements,
  formatK,
  newlyUnlockedIds,
  nightOverlapMs,
  type Achievement,
  type AchievementId,
  type AchievementInputs,
  type AchievementSessionRow,
  type AchievementStatRow,
} from "../achievements";

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
const NOW = at(5 * H);

const stat = (tool: string, model: string, tokensInput = 0, tokensOutput = 0, activeSeconds = 0): AchievementStatRow => ({
  tool,
  model,
  tokensInput,
  tokensOutput,
  activeSeconds,
});
const session = (overrides: Partial<AchievementSessionRow> = {}): AchievementSessionRow => ({
  tool: "claude-code",
  model: "claude-opus-5",
  status: "ENDED",
  startedAt: at(0),
  endedAt: at(H),
  lastHeartbeatAt: at(H),
  tokensInput: 0,
  tokensOutput: 0,
  tzOffsetMinutes: null,
  ...overrides,
});
const inputs = (partial: Partial<AchievementInputs> = {}): AchievementInputs => ({
  dailyStats: [],
  sessions: [],
  streak: null,
  earned: new Map(),
  ...partial,
});
const badge = (list: Achievement[], id: AchievementId): Achievement => {
  const found = list.find((a) => a.id === id);
  if (!found) throw new Error(`no ${id} in result`);
  return found;
};
const evaluate = (partial: Partial<AchievementInputs> = {}) => evaluateAchievements(inputs(partial), NOW);
const state = (partial: Partial<AchievementInputs>, id: AchievementId) => {
  const b = badge(evaluate(partial), id);
  return { unlocked: b.unlocked, progress: b.progress, progressLabel: b.progressLabel };
};

// ---- shape: fixed ids, fixed order, every badge always present ----
eq("ids", [...ACHIEVEMENT_IDS], ["token-millionaire", "opus-tamer", "night-owl", "deep-flow", "polyglot", "streak-master"]);
eq("every badge is reported, in contract order", evaluate().map((a) => a.id), [...ACHIEVEMENT_IDS]);
eq("achievement keys", Object.keys(evaluate()[0]), ["id", "unlocked", "progress", "progressLabel", "unlockedAt"]);

// ---- an empty account earns nothing — the exact opposite of the old "6 of 6" ----
eq(
  "empty account: everything locked, nothing fabricated",
  evaluate(),
  [
    { id: "token-millionaire", unlocked: false, progress: 0, progressLabel: "0k / 1,000k tokens", unlockedAt: null },
    { id: "opus-tamer", unlocked: false, progress: 0, progressLabel: "0.0h / 10h", unlockedAt: null },
    { id: "night-owl", unlocked: false, progress: 0, progressLabel: "No night session yet", unlockedAt: null },
    { id: "deep-flow", unlocked: false, progress: 0, progressLabel: "0.0h / 2h session", unlockedAt: null },
    { id: "polyglot", unlocked: false, progress: 0, progressLabel: "0 / 3 tools", unlockedAt: null },
    { id: "streak-master", unlocked: false, progress: 0, progressLabel: "0 / 7 days", unlockedAt: null },
  ]
);

// The old evaluator's trigger — lots of hours, nothing else — must not unlock anything
// but what the hours themselves support.
const busyButPlain = evaluate({
  dailyStats: [stat("claude-code", "claude-sonnet-5", 500_000, 200_000, 40 * 3600)],
  streak: { currentStreak: 3, longestStreak: 3 },
});
eq(
  "40 hours on one tool and one non-Opus model unlock nothing",
  busyButPlain.map((a) => a.unlocked),
  [false, false, false, false, false, false]
);

// ---- token-millionaire: Σ measured tokens over DailyStat + OPEN sessions ----
eq("TOKEN_MILLIONAIRE_TOKENS", TOKEN_MILLIONAIRE_TOKENS, 1_000_000);
eq("formatK floors: 999,999 → 999k", formatK(999_999), "999k");
eq("formatK groups: 1,234,567 → 1,234k", formatK(1_234_567), "1,234k");
eq(
  "999,999 tokens stay locked, with the real count",
  state({ dailyStats: [stat("claude-code", "claude-opus-5", 900_000, 99_999)] }, "token-millionaire"),
  { unlocked: false, progress: 0.999999, progressLabel: "999k / 1,000k tokens" }
);
eq(
  "1,000,000 tokens unlock",
  state({ dailyStats: [stat("claude-code", "claude-opus-5", 600_000, 400_000)] }, "token-millionaire"),
  { unlocked: true, progress: 1, progressLabel: "1,000k / 1,000k tokens" }
);
eq(
  "progress is capped at 1",
  state({ dailyStats: [stat("codex", "gpt-5-codex", 2_000_000, 0)] }, "token-millionaire").progress,
  1
);
eq(
  "tokens sum across rows and tools",
  state({ dailyStats: [stat("claude-code", "claude-opus-5", 300_000, 200_000), stat("codex", "gpt-5-codex", 250_000, 250_000)] }, "token-millionaire").unlocked,
  true
);
eq(
  "an open session's live tokens count (not folded yet)",
  state(
    {
      dailyStats: [stat("claude-code", "claude-opus-5", 400_000, 0)],
      sessions: [session({ status: "ACTIVE", endedAt: null, tokensInput: 500_000, tokensOutput: 100_000 })],
    },
    "token-millionaire"
  ).unlocked,
  true
);
eq(
  "an ENDED session's tokens do NOT count again — they already live in DailyStat",
  state({ sessions: [session({ status: "ENDED", tokensInput: 5_000_000, tokensOutput: 0 })] }, "token-millionaire"),
  { unlocked: false, progress: 0, progressLabel: "0k / 1,000k tokens" }
);
for (const tool of ["cursor", "windsurf", "quadcode"]) {
  eq(
    `${tool} rows are unmeasurable and never count`,
    state({ dailyStats: [stat(tool, "claude-opus-5", 5_000_000, 5_000_000)], sessions: [session({ tool, status: "ACTIVE", endedAt: null, tokensInput: 9_000_000 })] }, "token-millionaire"),
    { unlocked: false, progress: 0, progressLabel: "0k / 1,000k tokens" }
  );
}

// ---- opus-tamer: Σ activeSeconds on /opus|gpt-?5/i ----
eq("OPUS_TAMER_SECONDS", OPUS_TAMER_SECONDS, 36_000);
eq(
  "10h on Opus unlock",
  state({ dailyStats: [stat("claude-code", "claude-opus-5", 0, 0, 36_000)] }, "opus-tamer"),
  { unlocked: true, progress: 1, progressLabel: "10.0h / 10h" }
);
eq(
  "6.2h on Opus is 62% with the real hours",
  state({ dailyStats: [stat("claude-code", "claude-opus-4-5", 0, 0, 22_320)] }, "opus-tamer"),
  { unlocked: false, progress: 0.62, progressLabel: "6.2h / 10h" }
);
eq(
  "GPT-5 counts (gpt-5-codex, gpt5)",
  state({ dailyStats: [stat("codex", "gpt-5-codex", 0, 0, 20_000), stat("codex", "gpt5", 0, 0, 16_000)] }, "opus-tamer").unlocked,
  true
);
eq(
  "Sonnet, GPT-4.1 and the unknown bucket do not count",
  state({ dailyStats: [stat("claude-code", "claude-sonnet-5", 0, 0, 36_000), stat("codex", "gpt-4.1", 0, 0, 36_000), stat("claude-code", "unknown", 0, 0, 36_000)] }, "opus-tamer"),
  { unlocked: false, progress: 0, progressLabel: "0.0h / 10h" }
);
eq(
  "a legacy <synthetic> model row normalizes to no model",
  state({ dailyStats: [stat("claude-code", "<synthetic>", 0, 0, 36_000)] }, "opus-tamer").unlocked,
  false
);
eq(
  "an open Opus session adds its elapsed time (to its last beat, not to now)",
  state(
    {
      dailyStats: [stat("claude-code", "claude-opus-5", 0, 0, 18_000)],
      sessions: [session({ status: "ACTIVE", endedAt: null, startedAt: at(0), lastHeartbeatAt: at(5 * H) })],
    },
    "opus-tamer"
  ),
  { unlocked: true, progress: 1, progressLabel: "10.0h / 10h" }
);
eq(
  "an ENDED Opus session is already folded and does not count twice",
  state({ sessions: [session({ status: "ENDED", startedAt: at(0), endedAt: at(12 * H), lastHeartbeatAt: at(12 * H) })] }, "opus-tamer").unlocked,
  false
);

// ---- night-owl: ≥ 20 min inside 03:00–06:00 LOCAL, and only with a known zone ----
eq("NIGHT_OWL_MIN_OVERLAP_MS", NIGHT_OWL_MIN_OVERLAP_MS, 20 * M);
// 00:10Z–00:40Z is 03:10–03:40 in UTC+3 (tz = +180): 30 minutes inside the window.
const nightUtc3 = session({ tzOffsetMinutes: 180, startedAt: new Date(Date.UTC(2026, 8, 7, 0, 10)), endedAt: new Date(Date.UTC(2026, 8, 7, 0, 40)), lastHeartbeatAt: new Date(Date.UTC(2026, 8, 7, 0, 40)) });
eq("nightOverlapMs: 30 min at 03:10 local", nightOverlapMs(nightUtc3), 30 * M);
eq("a 30-minute 03:10 local session unlocks", state({ sessions: [nightUtc3] }, "night-owl"), {
  unlocked: true,
  progress: 1,
  progressLabel: "Night session logged",
});
eq(
  "the same instants with NO zone are ignored, never guessed",
  state({ sessions: [{ ...nightUtc3, tzOffsetMinutes: null }] }, "night-owl"),
  { unlocked: false, progress: 0, progressLabel: "No night session yet" }
);
eq("nightOverlapMs: no zone → 0", nightOverlapMs({ ...nightUtc3, tzOffsetMinutes: null }), 0);
eq(
  "the same instants in UTC (00:10–00:40) are not a night session",
  state({ sessions: [{ ...nightUtc3, tzOffsetMinutes: 0 }] }, "night-owl").unlocked,
  false
);
// 10:30Z–11:00Z is 03:30–04:00 in Los Angeles (tz = −420).
const nightLa = session({ tzOffsetMinutes: -420, startedAt: new Date(Date.UTC(2026, 8, 7, 10, 30)), endedAt: new Date(Date.UTC(2026, 8, 7, 11, 0)), lastHeartbeatAt: new Date(Date.UTC(2026, 8, 7, 11, 0)) });
eq("a negative offset works the same (LA, 03:30 local)", state({ sessions: [nightLa] }, "night-owl").unlocked, true);
eq("...and those instants are not a night in UTC+3", state({ sessions: [{ ...nightLa, tzOffsetMinutes: 180 }] }, "night-owl").unlocked, false);
// Exactly 20 minutes of overlap is enough; 19 is not.
const local = (h: number, m: number) => new Date(Date.UTC(2026, 8, 7, h, m)); // tz 0 → local == UTC
eq(
  "exactly 20 min inside the window unlocks",
  state({ sessions: [session({ tzOffsetMinutes: 0, startedAt: local(2, 30), endedAt: local(3, 20), lastHeartbeatAt: local(3, 20) })] }, "night-owl").unlocked,
  true
);
eq(
  "19 min inside the window does not",
  state({ sessions: [session({ tzOffsetMinutes: 0, startedAt: local(2, 30), endedAt: local(3, 19), lastHeartbeatAt: local(3, 19) })] }, "night-owl").unlocked,
  false
);
eq(
  "only the part inside 03:00–06:00 counts: 02:00–03:15 is 15 min",
  nightOverlapMs(session({ tzOffsetMinutes: 0, startedAt: local(2, 0), endedAt: local(3, 15), lastHeartbeatAt: local(3, 15) })),
  15 * M
);
eq(
  "a session across the whole window counts 3 h, not its 5 h length",
  nightOverlapMs(session({ tzOffsetMinutes: 0, startedAt: local(2, 0), endedAt: local(7, 0), lastHeartbeatAt: local(7, 0) })),
  3 * H
);
eq(
  "05:45–06:30 is 15 min: the window ends at 06:00",
  nightOverlapMs(session({ tzOffsetMinutes: 0, startedAt: local(5, 45), endedAt: local(6, 30), lastHeartbeatAt: local(6, 30) })),
  15 * M
);
eq(
  "a session spanning two nights sums both",
  nightOverlapMs(session({ tzOffsetMinutes: 0, startedAt: local(5, 50), endedAt: new Date(local(3, 10).getTime() + DAY), lastHeartbeatAt: new Date(local(3, 10).getTime() + DAY) })),
  20 * M
);
eq(
  "an OPEN night session is measured to its last beat",
  state({ sessions: [session({ status: "ACTIVE", tzOffsetMinutes: 0, startedAt: local(3, 0), endedAt: null, lastHeartbeatAt: local(3, 25) })] }, "night-owl").unlocked,
  true
);
eq(
  "a day session in the same zone is not a night session",
  state({ sessions: [session({ tzOffsetMinutes: 180, startedAt: local(9, 0), endedAt: local(17, 0), lastHeartbeatAt: local(17, 0) })] }, "night-owl").unlocked,
  false
);
eq("nightOverlapMs: a zero-length or inverted interval is 0", nightOverlapMs(session({ tzOffsetMinutes: 0, startedAt: local(4, 0), endedAt: local(3, 0), lastHeartbeatAt: local(3, 0) })), 0);

// ---- deep-flow: one session ≥ 2 h ----
eq("DEEP_FLOW_SECONDS", DEEP_FLOW_SECONDS, 7_200);
eq(
  "7,199 s is locked and reads 1.9h, never 2.0h",
  state({ sessions: [session({ startedAt: at(0), endedAt: at(7_199_000), lastHeartbeatAt: at(7_199_000) })] }, "deep-flow"),
  { unlocked: false, progress: 7_199 / 7_200, progressLabel: "1.9h / 2h session" }
);
eq(
  "7,200 s unlocks",
  state({ sessions: [session({ startedAt: at(0), endedAt: at(2 * H), lastHeartbeatAt: at(2 * H) })] }, "deep-flow"),
  { unlocked: true, progress: 1, progressLabel: "2.0h / 2h session" }
);
eq(
  "the longest session decides, not the sum",
  state({ sessions: [session({ startedAt: at(0), endedAt: at(H) }), session({ startedAt: at(2 * H), endedAt: at(3 * H) }), session({ startedAt: at(4 * H), endedAt: at(4 * H + 84 * M), lastHeartbeatAt: at(4 * H + 84 * M) })] }, "deep-flow"),
  { unlocked: false, progress: 0.7, progressLabel: "1.4h / 2h session" }
);
eq(
  "an open session is measured to its last beat",
  state({ sessions: [session({ status: "ACTIVE", endedAt: null, startedAt: at(0), lastHeartbeatAt: at(2 * H) })] }, "deep-flow").unlocked,
  true
);
eq(
  "a tokenless tool's session is still a real session",
  state({ sessions: [session({ tool: "cursor", model: null, startedAt: at(0), endedAt: at(3 * H), lastHeartbeatAt: at(3 * H) })] }, "deep-flow").unlocked,
  true
);

// ---- polyglot: distinct tools across DailyStat ∪ Session ----
eq(
  "two tools is 2 / 3",
  state({ dailyStats: [stat("claude-code", "claude-opus-5")], sessions: [session({ tool: "codex" })] }, "polyglot"),
  { unlocked: false, progress: 2 / 3, progressLabel: "2 / 3 tools" }
);
eq(
  "three tools unlock",
  state({ dailyStats: [stat("claude-code", "claude-opus-5"), stat("cursor", "unknown")], sessions: [session({ tool: "codex" })] }, "polyglot"),
  { unlocked: true, progress: 1, progressLabel: "3 / 3 tools" }
);
eq(
  "tools are deduped case-insensitively and trimmed",
  state({ dailyStats: [stat("claude-code", "a"), stat("Claude-Code", "b")], sessions: [session({ tool: " claude-code " })] }, "polyglot").progressLabel,
  "1 / 3 tools"
);
eq(
  "blank and the heartbeat's unknown fallback are not tools",
  state({ dailyStats: [stat("unknown", "a"), stat("", "b"), stat("codex", "c")] }, "polyglot").progressLabel,
  "1 / 3 tools"
);
eq("many models on one tool are still one tool", state({ dailyStats: [stat("claude-code", "claude-opus-5"), stat("claude-code", "claude-sonnet-5"), stat("claude-code", "claude-haiku-4-5")] }, "polyglot").progressLabel, "1 / 3 tools");

// ---- streak-master: UserStreak.longestStreak ≥ 7, progress = current / 7 ----
eq(
  "4 current / 6 longest is locked at 4 / 7",
  state({ streak: { currentStreak: 4, longestStreak: 6 } }, "streak-master"),
  { unlocked: false, progress: 4 / 7, progressLabel: "4 / 7 days" }
);
eq(
  "a past 7-day streak unlocks even if today's streak is 2",
  state({ streak: { currentStreak: 2, longestStreak: 7 } }, "streak-master"),
  { unlocked: true, progress: 1, progressLabel: "Best streak 7 days" }
);
eq("no streak row is 0 / 7", state({ streak: null }, "streak-master"), { unlocked: false, progress: 0, progressLabel: "0 / 7 days" });
eq(
  "hours never invent a streak",
  state({ dailyStats: [stat("claude-code", "claude-opus-5", 0, 0, 200 * 3600)] }, "streak-master").unlocked,
  false
);

// ---- unlockedAt + earned stays earned ----
const yesterday = at(-DAY);
eq(
  "a rule that just became true reports now as its unlock moment",
  badge(evaluate({ streak: { currentStreak: 7, longestStreak: 7 } }), "streak-master").unlockedAt,
  NOW.toISOString()
);
eq(
  "a stored row supplies unlockedAt and wins over a rule that is no longer true",
  badge(evaluate({ earned: new Map([["night-owl", yesterday]]) }), "night-owl"),
  { id: "night-owl", unlocked: true, progress: 1, progressLabel: "No night session yet", unlockedAt: yesterday.toISOString() }
);
eq(
  "a stored row keeps its original moment even when the rule is still true",
  badge(evaluate({ streak: { currentStreak: 9, longestStreak: 9 }, earned: new Map([["streak-master", yesterday]]) }), "streak-master").unlockedAt,
  yesterday.toISOString()
);
eq(
  "a stored row for one badge does not unlock another",
  evaluate({ earned: new Map([["deep-flow", yesterday]]) }).filter((a) => a.unlocked).map((a) => a.id),
  ["deep-flow"]
);
eq("a stored row under an unknown id is ignored", evaluate({ earned: new Map([["overachiever", yesterday]]) }).some((a) => a.unlocked), false);

// ---- newlyUnlockedIds: what a sync inserts ----
eq("nothing new on an empty account", newlyUnlockedIds(inputs()), []);
eq(
  "true rules without a row are new",
  newlyUnlockedIds(inputs({ streak: { currentStreak: 7, longestStreak: 7 }, sessions: [session({ startedAt: at(0), endedAt: at(3 * H), lastHeartbeatAt: at(3 * H) })] })),
  ["deep-flow", "streak-master"]
);
eq(
  "already-stored badges are not inserted again",
  newlyUnlockedIds(inputs({ streak: { currentStreak: 7, longestStreak: 7 }, earned: new Map([["streak-master", yesterday]]) })),
  []
);
eq(
  "a stored row whose rule is now false is never re-inserted or removed",
  newlyUnlockedIds(inputs({ earned: new Map([["night-owl", yesterday]]) })),
  []
);

// ---- inputs are not mutated ----
const frozen = inputs({ dailyStats: [stat("claude-code", "claude-opus-5", 1, 1, 1)], sessions: [session()], streak: { currentStreak: 1, longestStreak: 1 } });
const snapshot = JSON.stringify(frozen);
evaluateAchievements(frozen, NOW);
newlyUnlockedIds(frozen);
eq("inputs untouched", JSON.stringify(frozen), snapshot);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`achievements.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
