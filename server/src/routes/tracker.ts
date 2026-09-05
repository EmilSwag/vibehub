import type { Session } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db";
import { env } from "../env";
import { asyncHandler } from "../lib/http-error";
import { toJsonArrayValue, toPayloadValue } from "../lib/json-field";
import { heartbeatSchema } from "../lib/schemas";
import { closeSession, foldUsageIntoDailyStat, normalizeModel, presenceFor, utcDay, type UsageEntry } from "../lib/sessions";
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
    // surfaced as null. The tool is never dropped; only the model degrades. Sentinels
    // ("unknown", "<synthetic>", "") are normalized to null HERE so Session.model
    // never stores one and every downstream reader sees a single "no model" case.
    const model = normalizeModel(body.model);
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
    //
    // Token accounting has two paths (§4.3):
    //  - v2 body with `usage[]`: every per-source delta is credited to DailyStat
    //    directly (foldUsageIntoDailyStat) and the Session is extended with 0 tokens.
    //    The top-level deltas are a legacy sum of the same numbers, so counting them
    //    too would double every token the moment the session folds.
    //  - legacy body without `usage`: the deltas accrue on the Session and reach
    //    DailyStat when it closes — unchanged.
    const usage: UsageEntry[] | null = body.usage
      ? body.usage.map((entry) => ({
          tool: entry.tool.trim() || UNKNOWN,
          model: normalizeModel(entry.model),
          tokensInputDelta: entry.tokensInputDelta,
          tokensOutputDelta: entry.tokensOutputDelta,
        }))
      : null;
    const tokensInputDelta = usage ? 0 : body.tokensInputDelta ?? 0;
    const tokensOutputDelta = usage ? 0 : body.tokensOutputDelta ?? 0;

    // Round 6 multi-tool presence (§4.3): every tool the tracker can see open right
    // now rides along on the live session so presence can show the whole stack. This
    // is presence data only — it never touches time or token accounting. Absent (an
    // older tracker) leaves whatever the session already had, and presence readers
    // fall back to just the primary activity.
    const coTools = body.tools
      ? body.tools.map((entry) => ({
          tool: entry.tool.trim() || UNKNOWN,
          model: normalizeModel(entry.model),
          projectAlias: entry.projectAlias ?? null,
        }))
      : null;

    const isStale = (candidate: Session) =>
      now.getTime() - candidate.lastHeartbeatAt.getTime() > env.sessionIdleTimeoutMs;

    let session: Session | null = await findOpenSession(userId, body.projectAlias, tool, model);
    if (session && isStale(session)) {
      await closeSession(session, session.lastHeartbeatAt);
      session = null;
    }

    // null → known model refinement (§4.3). A log-backed tool (Claude Code, Codex)
    // is often detected by its process before its session log has a model line, so
    // the first heartbeats carry model: null and open a null-model Session; the
    // moment the log catches up the same (projectAlias, tool) arrives with a real
    // model. That is the same session with better information, not a new one — so
    // set the model on the open row in place and extend it below, instead of
    // opening a second Session (session_end/session_start churn, a split in stats
    // and a presence flicker). Only live sessions qualify: a stale null-model row is
    // left for closeOtherOpenSessions to fold under the "unknown" bucket it earned.
    if (!session && model !== null) {
      const untyped = await findOpenSession(userId, body.projectAlias, tool, null);
      if (untyped && !isStale(untyped)) {
        session = await prisma.session.update({ where: { id: untyped.id }, data: { model } });
        console.log(`[tracker] model refined null→${model} session=${session.id}`);
      }
    }

    if (session) {
      session = await prisma.session.update({
        where: { id: session.id },
        data: {
          status: "ACTIVE",
          lastHeartbeatAt: now,
          tokensInput: { increment: tokensInputDelta },
          tokensOutput: { increment: tokensOutputDelta },
          ...(coTools ? { coTools: toJsonArrayValue(coTools) as never } : {}),
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
          ...(coTools ? { coTools: toJsonArrayValue(coTools) as never } : {}),
        },
      });
    }

    if (usage) await foldUsageIntoDailyStat(userId, utcDay(occurredAt), usage);

    // The event log mirrors what was credited, not what was claimed: the top-level
    // deltas here are what went onto the Session (0 for v2 bodies) and `usage` is what
    // went straight to DailyStat — so summing a day's payloads never double counts.
    await logEvent(session.id, {
      projectAlias: body.projectAlias,
      tool,
      model,
      tokensInputDelta,
      tokensOutputDelta,
      ...(usage ? { usage } : {}),
      ...(coTools ? { tools: coTools } : {}),
    });

    await emitPresenceUpdate(userId, await presenceFor(userId, user.username));
    res.json({ sessionId: session.id, status: session.status });
  })
);

export default router;
