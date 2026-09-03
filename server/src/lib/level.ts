import { prisma } from "../db";

/**
 * Account level — a single playful number shown next to a user in lists
 * (onboarding "Add friends", profile header). Derived, never stored.
 *
 *   xp    = activeHours*10 + tokens/10_000 + projects*20 + friends*15 + commits*2
 *   level = floor(sqrt(xp / 10)) + 1
 *
 * sqrt keeps early levels quick (first hour of tracked work → level 2) and late
 * levels slow, so a level-20 account is genuinely rare. All inputs are public
 * aggregates already exposed by /users/:username and /stats.
 */
export interface LevelBreakdown {
  level: number;
  xp: number;
  activeHours: number;
  totalTokens: number;
  projects: number;
  friends: number;
  commits: number;
}

export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1;
}

export async function computeLevel(userId: string): Promise<LevelBreakdown> {
  const [stats, projects, friends, commits] = await Promise.all([
    prisma.dailyStat.aggregate({
      where: { userId },
      _sum: { activeSeconds: true, tokensInput: true, tokensOutput: true },
    }),
    prisma.project.count({ where: { ownerId: userId, isPublic: true } }),
    prisma.friendship.count({ where: { OR: [{ userAId: userId }, { userBId: userId }] } }),
    prisma.githubCommitDay.aggregate({ where: { userId }, _sum: { commitCount: true } }),
  ]);

  const activeHours = (stats._sum.activeSeconds ?? 0) / 3600;
  const totalTokens = (stats._sum.tokensInput ?? 0) + (stats._sum.tokensOutput ?? 0);
  const commitCount = commits._sum.commitCount ?? 0;

  const xp =
    activeHours * 10 + totalTokens / 10_000 + projects * 20 + friends * 15 + commitCount * 2;

  return {
    level: levelFromXp(xp),
    xp: Math.round(xp),
    activeHours: Math.round(activeHours * 10) / 10,
    totalTokens,
    projects,
    friends,
    commits: commitCount,
  };
}

/** Levels for a list of users; bounded fan-out (callers cap lists at ≤50). */
export async function computeLevels(userIds: string[]): Promise<Map<string, number>> {
  const entries = await Promise.all(
    userIds.map(async (id) => [id, (await computeLevel(id)).level] as const)
  );
  return new Map(entries);
}
