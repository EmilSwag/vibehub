import { prisma } from "../db";
import { utcDay } from "../lib/sessions";

// Archetype recompute — ARCHITECTURE.md §6. Runs once at boot (so a fresh deploy has
// badges immediately) and then at every UTC midnight. Fixed absolute thresholds, no
// cross-user normalization. ARTIST is never assigned here (needs a design-tool signal
// the tracker does not ingest yet); GENERALIST is the fallback for thin data.

export type Archetype = "CODER" | "ARTIST" | "DIRECTOR" | "GENERALIST";

const WINDOW_DAYS = 30;
const MIN_ACTIVE_DAYS = 3;

export interface ArchetypeSignals {
  activeDays: number;
  commitDensity: number; // commits per active hour
  autonomyRatio: number; // session-length-weighted avg(tokensOutput / max(tokensInput, 1))
  avgSessionMinutes: number;
}

export function classify(signals: ArchetypeSignals): Archetype {
  if (signals.activeDays < MIN_ACTIVE_DAYS) return "GENERALIST";
  if (signals.commitDensity >= 0.5 && signals.autonomyRatio < 3.0) return "CODER";
  if (signals.avgSessionMinutes >= 45 && signals.autonomyRatio >= 3.0) return "DIRECTOR";
  return "GENERALIST";
}

export async function computeSignals(userId: string, now: Date = new Date()): Promise<ArchetypeSignals> {
  const since = utcDay(new Date(now.getTime() - (WINDOW_DAYS - 1) * 86_400_000));

  const [dailyStats, commitDays, sessions] = await Promise.all([
    prisma.dailyStat.findMany({ where: { userId, date: { gte: since } } }),
    prisma.githubCommitDay.findMany({ where: { userId, date: { gte: since } } }),
    prisma.session.findMany({ where: { userId, status: "ENDED", startedAt: { gte: since } } }),
  ]);

  const activeDays = new Set(dailyStats.map((d) => d.date.toISOString().slice(0, 10))).size;
  const activeSeconds = dailyStats.reduce((sum, d) => sum + d.activeSeconds, 0);
  const activeHours = activeSeconds / 3600;
  const commits = commitDays.reduce((sum, d) => sum + d.commitCount, 0);

  let weightedRatio = 0;
  let totalWeight = 0;
  let totalMinutes = 0;
  for (const s of sessions) {
    const end = s.endedAt ?? s.lastHeartbeatAt;
    const minutes = Math.max(0, (end.getTime() - s.startedAt.getTime()) / 60_000);
    const ratio = s.tokensOutput / Math.max(s.tokensInput, 1);
    const weight = Math.max(minutes, 1);
    weightedRatio += ratio * weight;
    totalWeight += weight;
    totalMinutes += minutes;
  }

  return {
    activeDays,
    commitDensity: activeHours > 0 ? commits / activeHours : 0,
    autonomyRatio: totalWeight > 0 ? weightedRatio / totalWeight : 0,
    avgSessionMinutes: sessions.length > 0 ? totalMinutes / sessions.length : 0,
  };
}

export async function recomputeArchetypes(now: Date = new Date()): Promise<number> {
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) {
    const archetype = classify(await computeSignals(user.id, now));
    await prisma.user.update({
      where: { id: user.id },
      data: { archetype: archetype as never, archetypeComputedAt: now },
    });
  }
  return users.length;
}

function msUntilNextUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1_000, next - now.getTime());
}

export function startArchetypeJob(): void {
  const run = () =>
    recomputeArchetypes()
      .then((n) => console.log(`[jobs/archetype] recomputed ${n} user(s)`))
      .catch((err) => console.error("[jobs/archetype] recompute failed", err));

  run();
  const schedule = () => {
    const timer = setTimeout(() => {
      run();
      schedule();
    }, msUntilNextUtcMidnight(new Date()));
    timer.unref();
  };
  schedule();
}
