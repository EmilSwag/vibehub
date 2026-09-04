import type { User } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler, HttpError } from "../lib/http-error";
import { LEGACY_UNKNOWN_MODEL, normalizeModel, utcDay } from "../lib/sessions";

// Per-user stats rollup + friend compare — ARCHITECTURE.md §5.6. Closed sessions live
// in DailyStat (§2.10); sessions still open are added on top so the numbers move while
// someone is coding instead of jumping when the session finally closes.

const router = Router();

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;

interface ModelBucket {
  model: string;
  tool: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
}

export function parseRangeDays(raw: unknown): number {
  if (typeof raw !== "string") return DEFAULT_RANGE_DAYS;
  const match = /^(\d{1,3})d$/.exec(raw.trim());
  if (!match) return DEFAULT_RANGE_DAYS;
  return Math.min(Math.max(1, Number(match[1])), MAX_RANGE_DAYS);
}

export async function computeStats(user: User, rangeDays: number) {
  const now = new Date();
  const since = utcDay(new Date(now.getTime() - (rangeDays - 1) * 86_400_000));

  const [dailyStats, openSessions, streak, commitDays] = await Promise.all([
    prisma.dailyStat.findMany({ where: { userId: user.id, date: { gte: since } } }),
    prisma.session.findMany({ where: { userId: user.id, status: { not: "ENDED" }, startedAt: { gte: since } } }),
    prisma.userStreak.findUnique({ where: { userId: user.id } }),
    prisma.githubCommitDay.findMany({ where: { userId: user.id, date: { gte: since } }, orderBy: { date: "asc" } }),
  ]);

  const buckets = new Map<string, ModelBucket>();
  const add = (model: string, tool: string, tokensInput: number, tokensOutput: number, activeSeconds: number) => {
    const key = `${model}\u0000${tool}`;
    const bucket = buckets.get(key) ?? { model, tool, tokensInput: 0, tokensOutput: 0, activeSeconds: 0 };
    bucket.tokensInput += tokensInput;
    bucket.tokensOutput += tokensOutput;
    bucket.activeSeconds += activeSeconds;
    buckets.set(key, bucket);
  };

  // Both loops route the model through normalizeModel() ?? "unknown": DailyStat rows
  // written before ingestion-time normalization may still hold a sentinel such as
  // "<synthetic>", and those must aggregate into the per-tool "unknown" bucket rather
  // than surface as a model of their own. Shape is unchanged — byModel keeps the
  // "unknown" literal, which the web maps to "no model".
  for (const row of dailyStats) {
    add(normalizeModel(row.model) ?? LEGACY_UNKNOWN_MODEL, row.tool, row.tokensInput, row.tokensOutput, row.activeSeconds);
  }
  for (const session of openSessions) {
    const elapsed = Math.max(0, Math.round((session.lastHeartbeatAt.getTime() - session.startedAt.getTime()) / 1000));
    // Match the DailyStat "unknown" bucket (foldIntoDailyStat) so an open no-model
    // session and its later-folded self aggregate into the same row.
    add(normalizeModel(session.model) ?? LEGACY_UNKNOWN_MODEL, session.tool, session.tokensInput, session.tokensOutput, elapsed);
  }

  const byModel = [...buckets.values()].sort(
    (a, b) => b.tokensInput + b.tokensOutput - (a.tokensInput + a.tokensOutput) || b.activeSeconds - a.activeSeconds
  );

  return {
    byModel,
    topModel: byModel[0]?.model ?? null,
    totalTokens: byModel.reduce((sum, b) => sum + b.tokensInput + b.tokensOutput, 0),
    totalActiveSeconds: byModel.reduce((sum, b) => sum + b.activeSeconds, 0),
    streak: {
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      lastActiveDate: streak?.lastActiveDate ?? null,
    },
    githubCommits: commitDays.map((d) => ({ date: d.date, commitCount: d.commitCount })),
    rangeDays,
  };
}

router.get(
  "/users/:username/stats",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { username: req.params.username } });
    if (!user) throw new HttpError(404, "User not found");
    res.json(await computeStats(user, parseRangeDays(req.query.range)));
  })
);

router.get(
  "/users/:username/stats/compare",
  asyncHandler(async (req, res) => {
    const withUsername = typeof req.query.with === "string" ? req.query.with : "";
    if (!withUsername) throw new HttpError(400, "Missing `with` query parameter");

    const [a, b] = await Promise.all([
      prisma.user.findUnique({ where: { username: req.params.username } }),
      prisma.user.findUnique({ where: { username: withUsername } }),
    ]);
    if (!a || !b) throw new HttpError(404, "User not found");

    const rangeDays = parseRangeDays(req.query.range);
    const [statsA, statsB] = await Promise.all([computeStats(a, rangeDays), computeStats(b, rangeDays)]);
    res.json({ a: statsA, b: statsB });
  })
);

export default router;
