import { prisma } from "../db";
import { normalizeModel } from "./sessions";
import { isTokenlessTool } from "./tools";

// Honest achievements — meta/plans/vibehub-honest-achievements-feed.md, "Contract".
//
// Every badge maps to rows (DailyStat, Session, UserStreak) and nothing is inferred from
// unrelated data. The web used to unlock Night Owl from `hours >= 10`, invent three tools
// for Polyglot from `hours > 20` and a seven-day streak from `hours > 30`, which put
// "6 of 6 unlocked" on every account with a few hours. The rules live here, once, so the
// profile, the feed and the unlock toast all report the same numbers — and the unlock
// moment is persisted (UserAchievement.unlockedAt) so the feed can say *when*.
//
// `evaluateAchievements` is pure so lib/__checks__/achievements.check.ts pins every rule
// without a database; `syncAchievements` is the only Prisma-touching entry point.

export const ACHIEVEMENT_IDS = [
  "token-millionaire",
  "opus-tamer",
  "night-owl",
  "deep-flow",
  "polyglot",
  "streak-master",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Display names, used by the feed's "Unlocked Deep Flow" title. Definitions stay in the web. */
export const ACHIEVEMENT_TITLES: Record<AchievementId, string> = {
  "token-millionaire": "Token Millionaire",
  "opus-tamer": "Opus Tamer",
  "night-owl": "Night Owl",
  "deep-flow": "Deep Flow",
  polyglot: "Polyglot",
  "streak-master": "Streak Master",
};

export const isAchievementId = (value: unknown): value is AchievementId =>
  typeof value === "string" && (ACHIEVEMENT_IDS as readonly string[]).includes(value);

// Thresholds — the contract table, as constants so the checks pin the same numbers.
export const TOKEN_MILLIONAIRE_TOKENS = 1_000_000;
export const OPUS_TAMER_SECONDS = 36_000; // 10h
/** Models that count for Opus Tamer, matched against `normalizeModel(model)`. */
export const OPUS_TAMER_MODEL = /opus|gpt-?5/i;
export const NIGHT_OWL_START_HOUR = 3;
export const NIGHT_OWL_END_HOUR = 6;
export const NIGHT_OWL_MIN_OVERLAP_MS = 20 * 60_000;
export const DEEP_FLOW_SECONDS = 7_200; // 2h
export const POLYGLOT_TOOLS = 3;
export const STREAK_MASTER_DAYS = 7;

/** Achievement on the wire: `GET /users/:username/achievements` → `{ achievements: Achievement[] }`. */
export interface Achievement {
  id: AchievementId;
  unlocked: boolean;
  /** 0..1 — 1 whenever unlocked. */
  progress: number;
  /** Human progress while locked, e.g. "812k / 1,000k tokens"; still the real numbers once unlocked. */
  progressLabel: string;
  /** ISO moment the badge was earned (the stored row), null while locked. */
  unlockedAt: string | null;
}

// ---- inputs: the row shapes the rules read (selected by syncAchievements, built by the checks) ----

export interface AchievementStatRow {
  tool: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
}

export interface AchievementSessionRow {
  tool: string;
  model: string | null;
  /** "ACTIVE" | "IDLE" | "ENDED" — only ENDED rows are already folded into DailyStat. */
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  lastHeartbeatAt: Date;
  tokensInput: number;
  tokensOutput: number;
  /** Minutes to add to UTC for the host's local time; null = unknown, and unknown is never guessed. */
  tzOffsetMinutes: number | null;
}

export interface AchievementStreakRow {
  currentStreak: number;
  longestStreak: number;
}

export interface AchievementInputs {
  dailyStats: readonly AchievementStatRow[];
  sessions: readonly AchievementSessionRow[];
  streak: AchievementStreakRow | null;
  /** Badges already earned (UserAchievement rows): achievementId → unlockedAt. */
  earned: ReadonlyMap<string, Date>;
}

interface RuleResult {
  unlocked: boolean;
  progress: number;
  progressLabel: string;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const isOpen = (session: AchievementSessionRow): boolean => session.status !== "ENDED";
/** Where a session's measured interval ends: its close, or the last beat we heard while open. */
const sessionEnd = (session: AchievementSessionRow): Date => session.endedAt ?? session.lastHeartbeatAt;
const sessionSeconds = (session: AchievementSessionRow): number =>
  Math.max(0, Math.round((sessionEnd(session).getTime() - session.startedAt.getTime()) / 1000));

/** "812k" — floored, never rounded up: 999,999 tokens must not read as "1,000k" while locked. */
export const formatK = (n: number): string => `${Math.floor(Math.max(0, n) / 1000).toLocaleString("en-US")}k`;
/** "6.2h" for a measurement — floored to a tenth so 7,199 s reads "1.9h", never the "2h" it has not reached. */
const formatHours = (seconds: number): string => `${(Math.floor((Math.max(0, seconds) / 3600) * 10) / 10).toFixed(1)}h`;
const formatWholeHours = (seconds: number): string => `${Math.round(seconds / 3600)}h`;

// ---- the rules: each reads rows, nothing else ----

/**
 * Σ tokens over DailyStat (closed work + v2 `usage[]`) plus sessions still open (their
 * tokens have not reached DailyStat yet — the same "one place at a time" rule as
 * routes/stats.ts, so nothing double counts). Tokenless tools are excluded: their
 * counts are unknown, not zero, and could never have been measured.
 */
function tokenMillionaire({ dailyStats, sessions }: AchievementInputs): RuleResult {
  let tokens = 0;
  for (const row of dailyStats) if (!isTokenlessTool(row.tool)) tokens += row.tokensInput + row.tokensOutput;
  for (const session of sessions) {
    if (isOpen(session) && !isTokenlessTool(session.tool)) tokens += session.tokensInput + session.tokensOutput;
  }
  return {
    unlocked: tokens >= TOKEN_MILLIONAIRE_TOKENS,
    progress: clamp01(tokens / TOKEN_MILLIONAIRE_TOKENS),
    progressLabel: `${formatK(tokens)} / ${formatK(TOKEN_MILLIONAIRE_TOKENS)} tokens`,
  };
}

/** Σ activeSeconds on an Opus / GPT-5 model — folded rows plus the elapsed time of open sessions. */
function opusTamer({ dailyStats, sessions }: AchievementInputs): RuleResult {
  const counts = (model: string | null): boolean => OPUS_TAMER_MODEL.test(normalizeModel(model) ?? "");
  let seconds = 0;
  for (const row of dailyStats) if (counts(row.model)) seconds += Math.max(0, row.activeSeconds);
  for (const session of sessions) if (isOpen(session) && counts(session.model)) seconds += sessionSeconds(session);
  return {
    unlocked: seconds >= OPUS_TAMER_SECONDS,
    progress: clamp01(seconds / OPUS_TAMER_SECONDS),
    progressLabel: `${formatHours(seconds)} / ${formatWholeHours(OPUS_TAMER_SECONDS)}`,
  };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A session cannot honestly span more nights than this; guards the loop against a corrupt row. */
const MAX_NIGHTS_PER_SESSION = 400;

/**
 * Milliseconds of `session` that fall inside 03:00–06:00 *local* time, summed over every
 * night the session touches. Sessions without a zone return 0 — a 03:00 UTC session is
 * not a night session for someone in Los Angeles, and guessing a zone from anything else
 * would be exactly the fabrication this rule replaces.
 */
export function nightOverlapMs(session: AchievementSessionRow): number {
  const tz = session.tzOffsetMinutes;
  if (tz === null || !Number.isFinite(tz)) return 0;
  // Shift both instants by the offset so the local wall clock can be read off UTC getters.
  const shift = tz * 60_000;
  const startLocal = session.startedAt.getTime() + shift;
  const endLocal = sessionEnd(session).getTime() + shift;
  if (!(endLocal > startLocal)) return 0;

  let overlap = 0;
  let day = Math.floor(startLocal / DAY_MS) * DAY_MS;
  for (let nights = 0; day <= endLocal && nights < MAX_NIGHTS_PER_SESSION; day += DAY_MS, nights += 1) {
    const windowStart = day + NIGHT_OWL_START_HOUR * HOUR_MS;
    const windowEnd = day + NIGHT_OWL_END_HOUR * HOUR_MS;
    overlap += Math.max(0, Math.min(endLocal, windowEnd) - Math.max(startLocal, windowStart));
  }
  return overlap;
}

function nightOwl({ sessions }: AchievementInputs): RuleResult {
  const unlocked = sessions.some((session) => nightOverlapMs(session) >= NIGHT_OWL_MIN_OVERLAP_MS);
  return { unlocked, progress: unlocked ? 1 : 0, progressLabel: unlocked ? "Night session logged" : "No night session yet" };
}

/** One session (open ones measured to their last beat) of at least two hours. */
function deepFlow({ sessions }: AchievementInputs): RuleResult {
  const longest = sessions.reduce((max, session) => Math.max(max, sessionSeconds(session)), 0);
  return {
    unlocked: longest >= DEEP_FLOW_SECONDS,
    progress: clamp01(longest / DEEP_FLOW_SECONDS),
    progressLabel: `${formatHours(longest)} / ${formatWholeHours(DEEP_FLOW_SECONDS)} session`,
  };
}

/**
 * Distinct tools across DailyStat ∪ Session, lower-cased. The heartbeat's "unknown"
 * fallback (routes/tracker.ts) and blanks are not tools and do not count.
 */
export const NOT_A_TOOL = new Set(["", "unknown"]);
function polyglot({ dailyStats, sessions }: AchievementInputs): RuleResult {
  const tools = new Set<string>();
  const add = (tool: string) => {
    const key = tool.trim().toLowerCase();
    if (!NOT_A_TOOL.has(key)) tools.add(key);
  };
  for (const row of dailyStats) add(row.tool);
  for (const session of sessions) add(session.tool);
  return {
    unlocked: tools.size >= POLYGLOT_TOOLS,
    progress: clamp01(tools.size / POLYGLOT_TOOLS),
    progressLabel: `${tools.size} / ${POLYGLOT_TOOLS} tools`,
  };
}

/** UserStreak.longestStreak ≥ 7; progress shows the streak being built right now. */
function streakMaster({ streak }: AchievementInputs): RuleResult {
  const longest = Math.max(0, streak?.longestStreak ?? 0);
  const current = Math.max(0, streak?.currentStreak ?? 0);
  const unlocked = longest >= STREAK_MASTER_DAYS;
  return {
    unlocked,
    progress: clamp01(current / STREAK_MASTER_DAYS),
    progressLabel: unlocked ? `Best streak ${longest} days` : `${current} / ${STREAK_MASTER_DAYS} days`,
  };
}

const RULES: Record<AchievementId, (inputs: AchievementInputs) => RuleResult> = {
  "token-millionaire": tokenMillionaire,
  "opus-tamer": opusTamer,
  "night-owl": nightOwl,
  "deep-flow": deepFlow,
  polyglot,
  "streak-master": streakMaster,
};

/**
 * Every badge, in ACHIEVEMENT_IDS order. A stored row wins over the rule (earned stays
 * earned, even if the rows behind it are later deleted) and supplies `unlockedAt`; a
 * rule that is true with no row yet reports `now`, which is what syncAchievements is
 * about to persist.
 */
export function evaluateAchievements(inputs: AchievementInputs, now: Date = new Date()): Achievement[] {
  return ACHIEVEMENT_IDS.map((id) => {
    const rule = RULES[id](inputs);
    const stored = inputs.earned.get(id) ?? null;
    const unlocked = rule.unlocked || stored !== null;
    return {
      id,
      unlocked,
      progress: unlocked ? 1 : rule.progress,
      progressLabel: rule.progressLabel,
      unlockedAt: stored ? stored.toISOString() : rule.unlocked ? now.toISOString() : null,
    };
  });
}

/** Ids whose rule is true right now and that have no stored row yet — what a sync inserts. */
export function newlyUnlockedIds(inputs: AchievementInputs): AchievementId[] {
  return ACHIEVEMENT_IDS.filter((id) => !inputs.earned.has(id) && RULES[id](inputs).unlocked);
}

/**
 * Evaluate against the user's real rows, persist every newly earned badge with
 * `unlockedAt: now`, and return the full list with stored unlock moments. Rows are only
 * ever inserted here — never updated or deleted — and the upsert (not createMany, which
 * cannot skip duplicates on SQLite) makes concurrent syncs of the same user harmless.
 */
export async function syncAchievements(userId: string, now: Date = new Date()): Promise<Achievement[]> {
  const [dailyStats, sessions, streak, rows] = await Promise.all([
    prisma.dailyStat.findMany({
      where: { userId },
      select: { tool: true, model: true, tokensInput: true, tokensOutput: true, activeSeconds: true },
    }),
    prisma.session.findMany({
      where: { userId },
      select: {
        tool: true,
        model: true,
        status: true,
        startedAt: true,
        endedAt: true,
        lastHeartbeatAt: true,
        tokensInput: true,
        tokensOutput: true,
        tzOffsetMinutes: true,
      },
    }),
    prisma.userStreak.findUnique({ where: { userId }, select: { currentStreak: true, longestStreak: true } }),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true, unlockedAt: true } }),
  ]);

  const earned = new Map<string, Date>(rows.map((row) => [row.achievementId, row.unlockedAt]));
  const inputs: AchievementInputs = { dailyStats, sessions, streak, earned };

  for (const id of newlyUnlockedIds(inputs)) {
    const row = await prisma.userAchievement.upsert({
      where: { userId_achievementId: { userId, achievementId: id } },
      create: { userId, achievementId: id, unlockedAt: now },
      update: {},
      select: { unlockedAt: true },
    });
    earned.set(id, row.unlockedAt);
  }

  return evaluateAchievements(inputs, now);
}
