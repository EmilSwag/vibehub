import type { Achievement, AchievementId } from "../types";
import { relativeDay } from "./format";

export type { Achievement, AchievementId } from "../types";

// Badge copy, and nothing else. The rules live on the server
// (server/src/lib/achievements.ts), where every badge maps to rows: this file has no
// idea how many hours anyone has, and must not. The `evaluateAchievements` that used to
// live here unlocked Night Owl from `hours >= 10`, invented three tools for Polyglot and
// a seven-day streak from `hours > 30`, which put "6 of 6 unlocked" on every account
// with a few hours (meta/plans/vibehub-honest-achievements-feed.md, F2).

export interface AchievementDefinition {
  title: string;
  tagline: string;
  description: string;
  /** The threshold in words — the same number the server's rule checks. */
  requirement: string;
}

/** Display order, shared with the server. */
export const ACHIEVEMENT_IDS: readonly AchievementId[] = [
  "token-millionaire",
  "opus-tamer",
  "night-owl",
  "deep-flow",
  "polyglot",
  "streak-master",
];

export const ACHIEVEMENTS_DEF: Record<AchievementId, AchievementDefinition> = {
  "token-millionaire": {
    title: "Token Millionaire",
    tagline: "1M+ tokens",
    description: "1M tokens in measured tools.",
    requirement: "1,000,000 tokens",
  },
  "opus-tamer": {
    title: "Opus Tamer",
    tagline: "10h flagships",
    description: "10h on Opus or GPT-5.",
    requirement: "10 hours on Opus or GPT-5",
  },
  "night-owl": {
    title: "Night Owl",
    tagline: "Night ship",
    description: "Active between 03:00 and 06:00.",
    requirement: "20m between 03:00 and 06:00",
  },
  "deep-flow": {
    title: "Deep Flow",
    tagline: "2h+ focus",
    description: "One unbroken 2h+ session.",
    requirement: "One session of 2 hours",
  },
  polyglot: {
    title: "Polyglot",
    tagline: "3+ tools",
    description: "3 different tools with activity.",
    requirement: "3 different tools",
  },
  "streak-master": {
    title: "Streak Master",
    tagline: "7-day streak",
    description: "7 active days in a row.",
    requirement: "7 days in a row",
  },
};

export const isAchievementId = (value: unknown): value is AchievementId =>
  typeof value === "string" && (ACHIEVEMENT_IDS as readonly string[]).includes(value);

/**
 * The rows this build knows how to draw, in the server's order. An id we have no
 * copy or badge for (a newer server) is skipped, never rendered blank — and the
 * summary counts only what is shown.
 */
export function knownAchievements<T extends { id: string }>(rows: readonly T[]): (T & { id: AchievementId })[] {
  return rows.filter((row): row is T & { id: AchievementId } => isAchievementId(row.id));
}

/**
 * "Unlocked today" / "Unlocked 5d ago" / "Unlocked Sep 3" from the stored moment —
 * the same day-grained shape project cards use. Plain "Unlocked" when the server sent
 * no usable date, never "Invalid Date".
 */
export function unlockedLabel(unlockedAt: string | null, now: number = Date.now()): string {
  const when = unlockedAt ? relativeDay(unlockedAt, now) : "";
  return when ? `Unlocked ${when}` : "Unlocked";
}

/**
 * The badge "Preview alert" shows: the locked one closest to unlocking (the alert the
 * owner is about to earn), else the most recently unlocked, else null when there is
 * nothing to show.
 */
export function pickPreview(rows: readonly Achievement[]): Achievement | null {
  const locked = rows.filter((a) => !a.unlocked).sort((a, b) => b.progress - a.progress);
  if (locked.length > 0) return locked[0];
  const unlocked = rows
    .filter((a) => a.unlocked)
    .sort((a, b) => (Date.parse(b.unlockedAt ?? "") || 0) - (Date.parse(a.unlockedAt ?? "") || 0));
  return unlocked[0] ?? null;
}
