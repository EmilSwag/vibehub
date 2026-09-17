import { prisma } from "../db";
import { LEGACY_UNKNOWN_MODEL, normalizeModel } from "./sessions";

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
/** Lifetime folded tokens of one (model, tool) pair — the same rows `totalTokens` sums. */
export interface LevelModelTokens {
  model: string;
  tool: string;
  tokensInput: number;
  tokensOutput: number;
}

export interface LevelBreakdown {
  level: number;
  xp: number;
  activeHours: number;
  totalTokens: number;
  projects: number;
  friends: number;
  commits: number;
  /**
   * Per-model split of `totalTokens`, so the profile can print an approximate USD
   * equivalent next to the lifetime count. Only computed for the profile route
   * (`withModels`); list fan-outs (≤50 users) stay at four queries per user.
   */
  byModel?: LevelModelTokens[];
}

export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1;
}

export async function computeLevel(userId: string, options: { withModels?: boolean } = {}): Promise<LevelBreakdown> {
  const [stats, projects, friends, commits, modelRows] = await Promise.all([
    prisma.dailyStat.aggregate({
      where: { userId },
      _sum: { activeSeconds: true, tokensInput: true, tokensOutput: true },
    }),
    prisma.project.count({ where: { ownerId: userId, isPublic: true } }),
    prisma.friendship.count({ where: { OR: [{ userAId: userId }, { userBId: userId }] } }),
    prisma.githubCommitDay.aggregate({ where: { userId }, _sum: { commitCount: true } }),
    options.withModels
      ? prisma.dailyStat.groupBy({ by: ["model", "tool"], where: { userId }, _sum: { tokensInput: true, tokensOutput: true } })
      : Promise.resolve(null),
  ]);

  // Same normalization as routes/stats.ts: legacy sentinels fold into the per-tool
  // "unknown" bucket instead of surfacing as models of their own.
  let byModel: LevelModelTokens[] | undefined;
  if (modelRows) {
    const folded = new Map<string, LevelModelTokens>();
    for (const row of modelRows) {
      const model = normalizeModel(row.model) ?? LEGACY_UNKNOWN_MODEL;
      const key = `${model}\u0000${row.tool}`;
      const bucket = folded.get(key) ?? { model, tool: row.tool, tokensInput: 0, tokensOutput: 0 };
      bucket.tokensInput += row._sum.tokensInput ?? 0;
      bucket.tokensOutput += row._sum.tokensOutput ?? 0;
      folded.set(key, bucket);
    }
    byModel = [...folded.values()].sort(
      (a, b) => b.tokensInput + b.tokensOutput - (a.tokensInput + a.tokensOutput)
    );
  }

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
    ...(byModel ? { byModel } : {}),
  };
}

/** Levels for a list of users; bounded fan-out (callers cap lists at ≤50). */
export async function computeLevels(userIds: string[]): Promise<Map<string, number>> {
  const entries = await Promise.all(
    userIds.map(async (id) => [id, (await computeLevel(id)).level] as const)
  );
  return new Map(entries);
}
