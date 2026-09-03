import { prisma } from "../db";
import { env } from "../env";
import { closeSession, presenceFor } from "../lib/sessions";
import { emitPresenceUpdate } from "../ws/hub";

// Session sweeper — ARCHITECTURE.md §2.8 / §4.4. The tracker heartbeats every ~60s while
// the developer is typing; when heartbeats stop we degrade the session in two steps:
//   ACTIVE --(no heartbeat > IDLE_AFTER_MS)--> IDLE --(no heartbeat > sessionIdleTimeoutMs)--> ENDED
// Ending a session folds it into DailyStat (lib/sessions.ts). Presence updates are
// pushed to friends on every transition so the friends list never shows a ghost.

export const IDLE_AFTER_MS = 2 * 60_000;
export const SWEEP_INTERVAL_MS = 30_000;

export async function sweepSessions(now: Date = new Date()): Promise<{ idled: number; ended: number }> {
  const open = await prisma.session.findMany({
    where: { status: { not: "ENDED" } },
    include: { user: { select: { username: true } } },
  });

  let idled = 0;
  let ended = 0;
  const touchedUsers = new Map<string, string>();

  for (const session of open) {
    const silentFor = now.getTime() - session.lastHeartbeatAt.getTime();

    if (silentFor > env.sessionIdleTimeoutMs) {
      await closeSession(session, session.lastHeartbeatAt);
      ended += 1;
      touchedUsers.set(session.userId, session.user.username);
    } else if (silentFor > IDLE_AFTER_MS && session.status === "ACTIVE") {
      await prisma.session.update({ where: { id: session.id }, data: { status: "IDLE" } });
      idled += 1;
      touchedUsers.set(session.userId, session.user.username);
    }
  }

  for (const [userId, username] of touchedUsers) {
    await emitPresenceUpdate(userId, await presenceFor(userId, username));
  }

  return { idled, ended };
}

export function startSessionRollupJob(): NodeJS.Timeout {
  const timer = setInterval(() => {
    sweepSessions().catch((err) => console.error("[jobs/session-rollup] sweep failed", err));
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
