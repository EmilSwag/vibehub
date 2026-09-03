import type { Session } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";

// Round 5: presence must decay from `lastHeartbeatAt` at *read* time, not trust
// the stored `Session.status` column. That column is only advanced by the ~30s
// sweep (jobs/session-rollup.ts), and if the tracker vanishes mid-session
// (laptop closed, process killed, network drop) with no final session_end, it
// never gets a chance to run again for that row — the session sits at
// `status: "ACTIVE"` forever and every read of it reported "active" with no
// upper bound. `ONLINE_AFTER_MS` is the single source of truth for the
// active→idle edge, shared with the sweep so both agree; the idle→offline edge
// reuses the existing, already-configurable `SESSION_IDLE_TIMEOUT_MS`.
export const ONLINE_AFTER_MS = 2 * 60_000;

// Session lifecycle helpers shared by the heartbeat route (routes/tracker.ts) and the
// rollup job (jobs/session-rollup.ts). Contract: ARCHITECTURE.md §2.8, §2.10, §2.11, §4.3.

export type PresenceStatus = "active" | "idle" | "offline";

export interface PresenceActivity {
  projectAlias: string;
  tool: string;
  model: string;
  startedAt: string;
}

export interface PresenceSnapshot {
  username: string;
  status: PresenceStatus;
  activity: PresenceActivity | null;
}

export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Incremental streak update per §2.11 — called whenever a DailyStat row is written. */
export async function touchStreak(userId: string, day: Date): Promise<void> {
  const existing = await prisma.userStreak.findUnique({ where: { userId } });
  if (!existing) {
    await prisma.userStreak.create({
      data: { userId, currentStreak: 1, longestStreak: 1, lastActiveDate: day },
    });
    return;
  }

  const last = existing.lastActiveDate ? utcDay(existing.lastActiveDate).getTime() : null;
  const current = day.getTime();
  if (last !== null && current <= last) return; // same day or late fold — nothing to do

  const consecutive = last !== null && current - last === 86_400_000;
  const currentStreak = consecutive ? existing.currentStreak + 1 : 1;
  await prisma.userStreak.update({
    where: { userId },
    data: {
      currentStreak,
      longestStreak: Math.max(existing.longestStreak, currentStreak),
      lastActiveDate: day,
    },
  });
}

/** Folds a finished session into its DailyStat bucket (§2.10) and bumps the streak. */
async function foldIntoDailyStat(session: Session, endedAt: Date): Promise<void> {
  const day = utcDay(session.startedAt);
  const activeSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
  );

  await prisma.dailyStat.upsert({
    where: {
      userId_date_model_tool: {
        userId: session.userId,
        date: day,
        model: session.model,
        tool: session.tool,
      },
    },
    create: {
      userId: session.userId,
      date: day,
      model: session.model,
      tool: session.tool,
      tokensInput: session.tokensInput,
      tokensOutput: session.tokensOutput,
      activeSeconds,
    },
    update: {
      tokensInput: { increment: session.tokensInput },
      tokensOutput: { increment: session.tokensOutput },
      activeSeconds: { increment: activeSeconds },
    },
  });

  await touchStreak(session.userId, day);
}

/** Closes an open session (idle timeout or explicit session_end) and folds its totals. */
export async function closeSession(session: Session, endedAt: Date): Promise<Session> {
  if (session.status === "ENDED") return session;
  const safeEnd = endedAt.getTime() < session.startedAt.getTime() ? session.startedAt : endedAt;
  const closed = await prisma.session.update({
    where: { id: session.id },
    data: { status: "ENDED", endedAt: safeEnd },
  });
  await foldIntoDailyStat(closed, safeEnd);
  return closed;
}

export function sessionToActivity(session: Session): PresenceActivity {
  return {
    projectAlias: session.projectAlias,
    tool: session.tool,
    model: session.model,
    startedAt: session.startedAt.toISOString(),
  };
}

/**
 * Current presence for a user, derived from the freshest non-ended Session row —
 * decayed from `lastHeartbeatAt` on every call, never trusting the stored
 * `status` column alone (see ONLINE_AFTER_MS above for why).
 */
export async function presenceFor(userId: string, username: string): Promise<PresenceSnapshot> {
  const session = await prisma.session.findFirst({
    where: { userId, status: { not: "ENDED" } },
    orderBy: { lastHeartbeatAt: "desc" },
  });
  if (!session) return { username, status: "offline", activity: null };

  const silentForMs = Date.now() - session.lastHeartbeatAt.getTime();
  const status: PresenceStatus =
    silentForMs > env.sessionIdleTimeoutMs ? "offline" : silentForMs > ONLINE_AFTER_MS ? "idle" : "active";

  if (status === "offline") return { username, status: "offline", activity: null };
  return { username, status, activity: sessionToActivity(session) };
}
