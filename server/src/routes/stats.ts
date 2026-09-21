import type { User } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler, HttpError } from "../lib/http-error";
import { LEGACY_UNKNOWN_MODEL, normalizeModel, utcDay } from "../lib/sessions";
import { isTokenlessTool } from "../lib/schemas";
import { foldByTool, topToolOf } from "../lib/stats-tools";
import { estimateUsd, foldEstimatedUsd } from "../lib/token-pricing";

// Per-user stats rollup + friend compare — ARCHITECTURE.md §5.6. Closed sessions live
// in DailyStat (§2.10); sessions still open are added on top so the numbers move while
// someone is coding instead of jumping when the session finally closes.
//
// Round 7 adds two things for the Steam-style "Recent Activity" models block: the range
// `all` (lifetime "hrs on record") and `lastActiveAt` on every byModel bucket ("last
// used 4 Sep", and the sort order of the list). Both are additive — an older web client
// keeps asking for `30d` and simply ignores the new field.

const router = Router();

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;

interface ModelBucket {
  model: string;
  tool: string;
  tokensInput: number;
  tokensOutput: number;
  activeSeconds: number;
  /**
   * Round 7: newest moment this (tool, model) pair was seen inside the range — the max
   * of every contributing `DailyStat.date` (UTC midnight; day granularity is all a
   * rollup row carries) and every open `Session.lastHeartbeatAt` (to the second). ISO,
   * or null for the impossible case of a bucket with no contributing row. Lets the web
   * sort models "most recently used" and print "last used 4 Sep" with no extra request.
   */
  lastActiveAt: string | null;
  /**
   * Lane B (mac app): this bucket's tokens at standard API prices (lib/token-pricing.ts
   * — the same table the web keeps in tokenPricing.ts, pinned equal by a web check), or
   * null when the model has no verified price (including the `"unknown"` bucket). An
   * approximation of API-price equivalent, never money paid. Additive — an older web
   * client keeps pricing `byModel` itself and ignores this.
   */
  estimatedUsd: number | null;
}

/**
 * `?range=` → number of days, or `null` for "all time" (round 7: the Steam-style
 * "hrs on record" column needs a lifetime total, so `range=all` has no lower bound).
 * Anything unparseable still falls back to the 30-day default.
 */
export function parseRangeDays(raw: unknown): number | null {
  if (typeof raw !== "string") return DEFAULT_RANGE_DAYS;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "all") return null;
  const match = /^(\d{1,3})d$/.exec(trimmed);
  if (!match) return DEFAULT_RANGE_DAYS;
  return Math.min(Math.max(1, Number(match[1])), MAX_RANGE_DAYS);
}

export async function computeStats(user: User, rangeDays: number | null) {
  const now = new Date();
  // null (range=all) → no lower bound at all: each filter drops its date clause rather
  // than reaching back to the epoch, so "all" is one query shape, not a 100-year range.
  const since = rangeDays === null ? null : utcDay(new Date(now.getTime() - (rangeDays - 1) * 86_400_000));
  const sinceDate = since ? { date: { gte: since } } : {};

  const [dailyStats, openSessions, streak, commitDays] = await Promise.all([
    prisma.dailyStat.findMany({ where: { userId: user.id, ...sinceDate } }),
    prisma.session.findMany({
      where: { userId: user.id, status: { not: "ENDED" }, ...(since ? { startedAt: { gte: since } } : {}) },
    }),
    prisma.userStreak.findUnique({ where: { userId: user.id } }),
    prisma.githubCommitDay.findMany({ where: { userId: user.id, ...sinceDate }, orderBy: { date: "asc" } }),
  ]);

  const buckets = new Map<string, ModelBucket>();
  const add = (
    model: string,
    tool: string,
    tokensInput: number,
    tokensOutput: number,
    activeSeconds: number,
    seenAt: Date
  ) => {
    const key = `${model}\u0000${tool}`;
    const bucket = buckets.get(key) ?? {
      model,
      tool,
      tokensInput: 0,
      tokensOutput: 0,
      activeSeconds: 0,
      lastActiveAt: null,
      estimatedUsd: null,
    };
    bucket.tokensInput += tokensInput;
    bucket.tokensOutput += tokensOutput;
    bucket.activeSeconds += activeSeconds;
    // ISO strings from the same (UTC, millisecond) format compare correctly as strings.
    const seen = seenAt.toISOString();
    if (bucket.lastActiveAt === null || seen > bucket.lastActiveAt) bucket.lastActiveAt = seen;
    buckets.set(key, bucket);
  };

  // Both loops route the model through normalizeModel() ?? "unknown": DailyStat rows
  // written before ingestion-time normalization may still hold a sentinel such as
  // "<synthetic>", and those must aggregate into the per-tool "unknown" bucket rather
  // than surface as a model of their own. Shape is unchanged — byModel keeps the
  // "unknown" literal, which the web maps to "no model".
  for (const row of dailyStats) {
    // `row.date` is that day's UTC midnight — the finest "when" a rollup row has.
    add(
      normalizeModel(row.model) ?? LEGACY_UNKNOWN_MODEL,
      row.tool,
      row.tokensInput,
      row.tokensOutput,
      row.activeSeconds,
      row.date
    );
  }
  for (const session of openSessions) {
    const elapsed = Math.max(0, Math.round((session.lastHeartbeatAt.getTime() - session.startedAt.getTime()) / 1000));
    // Match the DailyStat "unknown" bucket (foldIntoDailyStat) so an open no-model
    // session and its later-folded self aggregate into the same row.
    add(
      normalizeModel(session.model) ?? LEGACY_UNKNOWN_MODEL,
      session.tool,
      session.tokensInput,
      session.tokensOutput,
      elapsed,
      session.lastHeartbeatAt
    );
  }

  const byModel = [...buckets.values()].sort(
    (a, b) => b.tokensInput + b.tokensOutput - (a.tokensInput + a.tokensOutput) || b.activeSeconds - a.activeSeconds
  );
  // Priced once the bucket is final (every row folded in), never per contributing row:
  // the fold prices ORIGINAL per-model counts, so summing bucket USDs equals pricing
  // the rows - and a bucket whose model is unpriced is simply null.
  // A tokenless tool has no counts to price, so its bucket is unknown rather than free -
  // otherwise Windsurf, whose model IS in the price table, would come back at $0.00 and
  // read as "this cost nothing" instead of "nobody knows" (Round 6, fix F-A).
  for (const bucket of byModel) {
    bucket.estimatedUsd = isTokenlessTool(bucket.tool)
      ? null
      : estimateUsd(bucket.model, bucket.tokensInput, bucket.tokensOutput);
  }

  // Measured buckets are the only ones that can state a number. A range whose only work
  // was on tokenless tools reports `null` - unknown - while a range with any measuring
  // tool keeps its real total, including a genuine zero, and an empty range stays 0
  // because there is nothing to be unknown about.
  const measured = byModel.filter((bucket) => !isTokenlessTool(bucket.tool));
  const hasTokenless = measured.length < byModel.length;
  const measuredTokens = measured.reduce((sum, b) => sum + b.tokensInput + b.tokensOutput, 0);

  // Round 20: the same buckets folded by tool alone — "which tool/IDE does this person
  // use the most". Ranked by active time (hours are the measure), tokens break ties.
  const byTool = foldByTool(byModel);

  return {
    byModel,
    topModel: byModel[0]?.model ?? null,
    byTool,
    topTool: topToolOf(byTool),
    // `null` = unknown (tokenless tools only), never a fabricated 0. Active time is
    // always real, so it keeps summing every bucket.
    totalTokens: measured.length === 0 && hasTokenless ? null : measuredTokens,
    totalActiveSeconds: byModel.reduce((sum, b) => sum + b.activeSeconds, 0),
    // Lane B (mac app): the range's tokens at standard API prices — priced buckets only,
    // null when tokens exist but no bucket has a verified price (same rule as the web's
    // estimateTokenCost, so the two never disagree on the same stats). Tokenless buckets
    // are excluded from the fold: they are unpriceable, not free, and a range made only
    // of them is unknown rather than $0.00.
    totalEstimatedUsd: measured.length === 0 && hasTokenless ? null : foldEstimatedUsd(measured).estimatedUsd,
    streak: {
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      lastActiveDate: streak?.lastActiveDate ?? null,
    },
    githubCommits: commitDays.map((d) => ({ date: d.date, commitCount: d.commitCount })),
    // number of days, or null when the caller asked for `range=all`.
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
