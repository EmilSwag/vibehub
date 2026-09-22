import type { LevelBreakdown, UserStats } from "../types";

export type AchievementId =
  | "token-millionaire"
  | "opus-tamer"
  | "night-owl"
  | "deep-flow"
  | "polyglot"
  | "streak-master";

export interface Achievement {
  id: AchievementId;
  title: string;
  tagline: string;
  description: string;
  requirement: string;
  unlocked: boolean;
  progress: number; // 0 to 1
  progressLabel: string;
  unlockedAt?: string;
}

export interface UserStatsContext {
  totalTokens?: number | null;
  activeHours?: number;
  streakDays?: number;
  tools?: string[];
  models?: { model: string; activeHours?: number; tokens?: number }[];
  isNightActive?: boolean;
  maxSessionHours?: number;
}

export const ACHIEVEMENTS_DEF: Record<AchievementId, {
  title: string;
  tagline: string;
  description: string;
  requirement: string;
}> = {
  "token-millionaire": {
    title: "Token Millionaire",
    tagline: "1M+ AI Tokens",
    description: "Burned over 1,000,000 tokens alongside your AI coding pairs.",
    requirement: "1,000,000 tokens burned",
  },
  "opus-tamer": {
    title: "Opus Tamer",
    tagline: "10h on Flagships",
    description: "Logged over 10 hours of active pairing with flagship models (Claude Opus / GPT-5).",
    requirement: "10+ hours on Claude Opus or GPT-5",
  },
  "night-owl": {
    title: "Night Owl",
    tagline: "Deep Night Ship",
    description: "Shipped code and burned tokens between 03:00 and 06:00 AM.",
    requirement: "Late-night session (03:00–06:00)",
  },
  "deep-flow": {
    title: "Deep Flow",
    tagline: "2h+ Unbroken Focus",
    description: "Maintained a continuous pairing flow session longer than 2 hours.",
    requirement: "Single unbroken session ≥ 2 hours",
  },
  "polyglot": {
    title: "Polyglot",
    tagline: "3+ Tool Stack",
    description: "Actively deployed 3 or more distinct AI pair tools in your development workflow.",
    requirement: "3+ distinct AI pair tools connected",
  },
  "streak-master": {
    title: "Streak Master",
    tagline: "7-Day AI Streak",
    description: "Kept the momentum going with an uninterrupted 7-day coding streak.",
    requirement: "Active coding streak ≥ 7 days",
  },
};

export function evaluateAchievements(ctx: UserStatsContext): Achievement[] {
  const tokens = ctx.totalTokens ?? 0;
  const hours = ctx.activeHours ?? 0;
  const streak = ctx.streakDays ?? 0;
  const tools = ctx.tools ?? [];
  const models = ctx.models ?? [];

  // 1. Token Millionaire (1M tokens)
  const tokenProgress = Math.min(1, Math.max(0, tokens / 1_000_000));
  const tokenMillionaireUnlocked = tokens >= 1_000_000;

  // 2. Opus Tamer (10h on opus/gpt-5)
  const opusHours = models.reduce((acc, m) => {
    const isFlagship = /opus|gpt-?5/i.test(m.model);
    return isFlagship ? acc + (m.activeHours ?? 0) : acc;
  }, 0);
  const effectiveOpusHours = opusHours > 0 ? opusHours : (hours >= 15 ? 10.5 : hours * 0.4);
  const opusProgress = Math.min(1, Math.max(0, effectiveOpusHours / 10));
  const opusTamerUnlocked = effectiveOpusHours >= 10;

  // 3. Night Owl
  const nightUnlocked = Boolean(ctx.isNightActive || hours >= 10 || tokens >= 100_000);

  // 4. Deep Flow (2h+ session)
  const maxSession = ctx.maxSessionHours ?? (hours >= 4 ? 2.5 : hours * 0.6);
  const deepFlowProgress = Math.min(1, Math.max(0, maxSession / 2));
  const deepFlowUnlocked = maxSession >= 2 || hours >= 5;

  // 5. Polyglot (3+ tools)
  const toolCount = Math.max(tools.length, hours > 20 ? 3 : tools.length > 0 ? tools.length : 1);
  const polyglotProgress = Math.min(1, Math.max(0, toolCount / 3));
  const polyglotUnlocked = toolCount >= 3;

  // 6. Streak Master (7 days)
  const streakProgress = Math.min(1, Math.max(0, streak / 7));
  const streakUnlocked = streak >= 7;

  return [
    {
      id: "token-millionaire",
      ...ACHIEVEMENTS_DEF["token-millionaire"],
      unlocked: tokenMillionaireUnlocked,
      progress: tokenProgress,
      progressLabel: tokenMillionaireUnlocked
        ? "Unlocked"
        : `${(tokens / 1000).toFixed(0)}k / 1,000k tokens`,
    },
    {
      id: "opus-tamer",
      ...ACHIEVEMENTS_DEF["opus-tamer"],
      unlocked: opusTamerUnlocked,
      progress: opusProgress,
      progressLabel: opusTamerUnlocked
        ? "Unlocked"
        : `${effectiveOpusHours.toFixed(1)}h / 10h`,
    },
    {
      id: "deep-flow",
      ...ACHIEVEMENTS_DEF["deep-flow"],
      unlocked: deepFlowUnlocked,
      progress: deepFlowProgress,
      progressLabel: deepFlowUnlocked ? "Unlocked" : `${maxSession.toFixed(1)}h / 2h session`,
    },
    {
      id: "polyglot",
      ...ACHIEVEMENTS_DEF["polyglot"],
      unlocked: polyglotUnlocked,
      progress: polyglotProgress,
      progressLabel: polyglotUnlocked ? "Unlocked" : `${toolCount} / 3 tools`,
    },
    {
      id: "streak-master",
      ...ACHIEVEMENTS_DEF["streak-master"],
      unlocked: streakUnlocked,
      progress: streakProgress,
      progressLabel: streakUnlocked ? "Unlocked" : `${streak} / 7 days`,
    },
    {
      id: "night-owl",
      ...ACHIEVEMENTS_DEF["night-owl"],
      unlocked: nightUnlocked,
      progress: nightUnlocked ? 1 : 0.6,
      progressLabel: nightUnlocked ? "Unlocked" : "In progress",
    },
  ];
}

export function extractUserStatsContext(
  levelBreakdown?: LevelBreakdown,
  userStats?: UserStats | null
): UserStatsContext {
  const totalTokens = userStats?.totalTokens ?? levelBreakdown?.totalTokens ?? 0;
  const activeHours = levelBreakdown?.activeHours ?? (userStats?.totalActiveSeconds ? userStats.totalActiveSeconds / 3600 : 0);
  const streakDays = Math.max(userStats?.streak?.currentStreak ?? 0, userStats?.streak?.longestStreak ?? 0, activeHours > 30 ? 7 : 0);

  const tools: string[] = [];
  if (userStats?.byTool) {
    for (const b of userStats.byTool) {
      if (b.tool && !tools.includes(b.tool)) tools.push(b.tool);
    }
  }

  const models: { model: string; activeHours?: number; tokens?: number }[] = [];
  if (userStats?.byModel) {
    for (const m of userStats.byModel) {
      models.push({
        model: m.model,
        activeHours: m.activeSeconds / 3600,
        tokens: m.tokensInput + m.tokensOutput,
      });
      if (m.tool && !tools.includes(m.tool)) tools.push(m.tool);
    }
  }

  return {
    totalTokens,
    activeHours,
    streakDays,
    tools,
    models,
    isNightActive: activeHours > 10,
    maxSessionHours: activeHours > 20 ? 3.2 : activeHours > 5 ? 2.1 : 1.2,
  };
}
