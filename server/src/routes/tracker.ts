import type { Session } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db";
import { env } from "../env";
import { asyncHandler } from "../lib/http-error";
import { toPayloadValue } from "../lib/json-field";
import { heartbeatSchema } from "../lib/schemas";
import { closeSession, presenceFor, utcDay } from "../lib/sessions";
import { requireTrackerToken } from "../middleware/auth";
import { emitPresenceUpdate } from "../ws/hub";

// Heartbeat ingestion — ARCHITECTURE.md §4.3 / §5.8. Auth is a Bearer device token
// (TrackerToken, §2.13), never the browser cookie. The body only ever carries
// projectAlias/tool/model/counts/timestamps (§3) — nothing else is stored.

const router = Router();

// Round 5: `vibehub-tracker login <token>` calls this to validate the token before
// ever writing it to ~/.vibehub/config.json, so a bad paste fails loudly at login
// time instead of silently queuing rejected heartbeats forever. GET + no body so it
// never creates a Session/ActivityEvent row the way a real heartbeat would — this is
// purely "is this token good," same 401 shape as heartbeat via the same middleware.
router.get(
  "/tracker/verify",
  requireTrackerToken,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.trackerUserId! },
      select: { username: true },
    });
    res.json({ username: user.username });
  })
);

const UNKNOWN = "unknown";
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const EVENT_TYPE_MAP = {
  heartbeat: "HEARTBEAT",
  session_start: "SESSION_START",
  session_end: "SESSION_END",
  git_commit: "GIT_COMMIT",
} as const;

async function findOpenSession(userId: string, projectAlias: string, tool: string, model: string | null) {
  return prisma.session.findFirst({
    // `model: null` correctly filters to IS NULL rows (presence-only tools).
    where: { userId, projectAlias, tool, model, status: { not: "ENDED" } },
    orderBy: { lastHeartbeatAt: "desc" },
  });
}

/** A developer is in one place at a time: any other open session is stale once a new one starts. */
async function closeOtherOpenSessions(userId: string, keepId: string | null, at: Date) {
  const others = await prisma.session.findMany({
    where: { userId, status: { not: "ENDED" }, ...(keepId ? { id: { not: keepId } } : {}) },
  });
  for (const stale of others) await closeSession(stale, stale.lastHeartbeatAt < at ? stale.lastHeartbeatAt : at);
}

router.post(
  "/tracker/heartbeat",
  requireTrackerToken,
  asyncHandler(async (req, res) => {
    const userId = req.trackerUserId!;
    const body = heartbeatSchema.parse(req.body);
    const now = new Date();
    const occurredAtRaw = new Date(body.occurredAt);
    const occurredAt =
      Math.abs(occurredAtRaw.getTime() - now.getTime()) <= MAX_CLOCK_SKEW_MS ? occurredAtRaw : now;

    const tool = body.tool ?? UNKNOWN;
    // Model is null when the tool exposes none (presence-only tools) — stored and
    // surfaced as null. The tool is never dropped; only the model degrades.
    const model = body.model ?? null;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });

    const logEvent = (sessionId: string | null, payload: Record<string, unknown>) =>
      prisma.activityEvent.create({
        data: {
          userId,
          sessionId,
          type: EVENT_TYPE_MAP[body.eventType],
          occurredAt,
          payload: toPayloadValue(payload) as never,
        },
      });

    if (body.eventType === "git_commit") {
      const repoAlias = body.repoAlias ?? body.projectAlias;
      await logEvent(null, { repoAlias });
      // Local commits count toward the per-day commit stat right away; a future GitHub
      // sync job should overwrite (not increment) these rows for the days it covers.
      const day = utcDay(occurredAt);
      await prisma.githubCommitDay.upsert({
        where: { userId_date: { userId, date: day } },
        create: { userId, date: day, commitCount: 1 },
        update: { commitCount: { increment: 1 } },
      });
      res.json({ sessionId: null, status: "OK" });
      return;
    }

    if (body.eventType === "session_end") {
      const open = await findOpenSession(userId, body.projectAlias, tool, model);
      if (open) await closeSession(open, occurredAt);
      await logEvent(open?.id ?? null, { projectAlias: body.projectAlias, tool, model });
      await emitPresenceUpdate(userId, await presenceFor(userId, user.username));
      res.json({ sessionId: open?.id ?? null, status: "ENDED" });
      return;
    }

    // heartbeat | session_start — upsert-extend the open session or open a new one.
    const tokensInputDelta = body.tokensInputDelta ?? 0;
    const tokensOutputDelta = body.tokensOutputDelta ?? 0;

    let session: Session | null = await findOpenSession(userId, body.projectAlias, tool, model);
    if (session && now.getTime() - session.lastHeartbeatAt.getTime() > env.sessionIdleTimeoutMs) {
      await closeSession(session, session.lastHeartbeatAt);
      session = null;
    }

    if (session) {
      session = await prisma.session.update({
        where: { id: session.id },
        data: {
          status: "ACTIVE",
          lastHeartbeatAt: now,
          tokensInput: { increment: tokensInputDelta },
          tokensOutput: { increment: tokensOutputDelta },
        },
      });
    } else {
      await closeOtherOpenSessions(userId, null, occurredAt);
      session = await prisma.session.create({
        data: {
          userId,
          projectAlias: body.projectAlias,
          tool,
          model,
          status: "ACTIVE",
          startedAt: occurredAt,
          lastHeartbeatAt: now,
          tokensInput: tokensInputDelta,
          tokensOutput: tokensOutputDelta,
        },
      });
    }

    await logEvent(session.id, {
      projectAlias: body.projectAlias,
      tool,
      model,
      tokensInputDelta,
      tokensOutputDelta,
    });

    await emitPresenceUpdate(userId, await presenceFor(userId, user.username));
    res.json({ sessionId: session.id, status: session.status });
  })
);

export default router;
