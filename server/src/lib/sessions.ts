import type { Session } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { fromJsonArrayValue } from "./json-field";

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

// Legacy sentinel: the pre-Phase-9 tracker sent the literal "unknown" for a missing
// model. Newer trackers send null. Both surface as null in presence so the UI has one
// "no model" case to handle, not two. It is ALSO the DailyStat bucket for "no model"
// (DailyStat.model is part of a composite unique key and can't be null — see
// foldIntoDailyStat) — exported so every reader maps it back to null the same way.
export const LEGACY_UNKNOWN_MODEL = "unknown";

// Every model string a tracker has ever sent for "I don't know": the legacy literal,
// the empty string, and Claude Code's "<synthetic>" (its own placeholder for locally
// generated assistant turns — the live root cause of "my models are shown wrong" on a
// profile: it leaked through as if it were a real model). Compared case-insensitively
// after trimming.
const MODEL_SENTINELS = new Set(["", LEGACY_UNKNOWN_MODEL, "<synthetic>"]);

/**
 * Canonical model id or null. Applied at the ingestion edge (routes/tracker.ts, for
 * both the top-level presence model and every `usage[]` entry) so Session.model never
 * stores a sentinel, and again on read for rows written before this existed.
 */
export function normalizeModel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return MODEL_SENTINELS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/** One per-source token delta from a v2 heartbeat (§4.3 `usage[]`), already normalized. */
export interface UsageEntry {
  tool: string;
  model: string | null;
  tokensInputDelta: number;
  tokensOutputDelta: number;
}

export interface PresenceActivity {
  projectAlias: string;
  tool: string;
  /** null when the tool exposes no model (presence-only tools) — never an empty string. */
  model: string | null;
  startedAt: string;
}

/**
 * Round 6: one tool the tracker could see open when it last reported. People sit in
 * several terminals and IDEs at once, so presence lists the whole stack while hours
 * and tokens still accrue only to the primary — `activity` — which is always the
 * first entry.
 */
export interface PresenceTool {
  tool: string;
  model: string | null;
  /** null when unknown, or when the user hid that project: the tool still shows. */
  projectAlias: string | null;
}

export interface PresenceSnapshot {
  username: string;
  status: PresenceStatus;
  activity: PresenceActivity | null;
  /**
   * Every tool seen open, primary first and deduped by tool. Falls back to just the
   * primary (`[activity]`) for sessions written by a tracker that predates `tools[]`,
   * and is `[]` when offline — so a reader can always use it without a null check.
   */
  tools: PresenceTool[];
}

/** Largest `tools[]` we will echo back, mirroring the heartbeat schema's cap. */
const MAX_PRESENCE_TOOLS = 10;

/**
 * Reads `Session.coTools` defensively — it is a Json column that several tracker
 * versions write, so shape is asserted rather than assumed. Entries are normalised
 * (models through `normalizeModel`), deduped by tool keeping the first occurrence,
 * and the primary is forced to the front so `tools[0]` always matches `activity`.
 */
function presenceTools(raw: unknown, primary: PresenceActivity | null): PresenceTool[] {
  const out: PresenceTool[] = [];
  const seen = new Set<string>();
  const push = (tool: string, model: string | null, projectAlias: string | null) => {
    if (!tool || seen.has(tool) || out.length >= MAX_PRESENCE_TOOLS) return;
    seen.add(tool);
    out.push({ tool, model, projectAlias });
  };

  if (primary) push(primary.tool, primary.model, primary.projectAlias);

  {
    // `Json?` on Postgres, JSON-encoded `String?` on the SQLite mirror — see lib/json-field.ts.
    for (const entry of fromJsonArrayValue(raw)) {
      if (!entry || typeof entry !== "object") continue;
      const { tool, model, projectAlias } = entry as Record<string, unknown>;
      if (typeof tool !== "string" || !tool) continue;
      push(
        tool,
        normalizeModel(typeof model === "string" ? model : null),
        typeof projectAlias === "string" && projectAlias ? projectAlias : null
      );
    }
  }
  return out;
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
  // DailyStat.model is part of a composite unique key, which can't be null (Postgres
  // treats NULLs as distinct, breaking the upsert), so the aggregate uses an
  // "unknown" bucket for sessions with no model. Presence still reports null.
  // normalizeModel() here too: rows opened by a pre-normalization server may still
  // carry a sentinel, and those must land in the same bucket as null.
  const statModel = normalizeModel(session.model) ?? LEGACY_UNKNOWN_MODEL;

  await prisma.dailyStat.upsert({
    where: {
      userId_date_model_tool: {
        userId: session.userId,
        date: day,
        model: statModel,
        tool: session.tool,
      },
    },
    create: {
      userId: session.userId,
      date: day,
      model: statModel,
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

/**
 * Heartbeat v2 token accounting (§4.3 `usage[]`): credits each per-source delta to
 * the DailyStat row for `(userId, day, model ?? "unknown", tool)` directly — never
 * via the Session, which is why routes/tracker.ts extends the Session with 0 tokens
 * for such heartbeats (no double count when it later folds). Only tokens move here;
 * `activeSeconds` stays the Session's job, since a source that merely emitted tokens
 * in the background (a Codex log growing while the user is in Claude Code) is not
 * where the developer *is*. Entries with no tokens are skipped; duplicates for the
 * same pair are merged into one upsert; the streak is bumped once, and only if a row
 * was actually written.
 */
export async function foldUsageIntoDailyStat(
  userId: string,
  day: Date,
  usage: readonly UsageEntry[]
): Promise<void> {
  const merged = new Map<string, { model: string; tool: string; tokensInput: number; tokensOutput: number }>();
  for (const entry of usage) {
    if (entry.tokensInputDelta <= 0 && entry.tokensOutputDelta <= 0) continue;
    const tool = entry.tool.trim() || "unknown"; // same fallback as routes/tracker.ts's presence tool
    const model = normalizeModel(entry.model) ?? LEGACY_UNKNOWN_MODEL;
    const key = `${model}\0${tool}`;
    const bucket = merged.get(key) ?? { model, tool, tokensInput: 0, tokensOutput: 0 };
    bucket.tokensInput += entry.tokensInputDelta;
    bucket.tokensOutput += entry.tokensOutputDelta;
    merged.set(key, bucket);
  }
  if (merged.size === 0) return;

  for (const bucket of merged.values()) {
    await prisma.dailyStat.upsert({
      where: { userId_date_model_tool: { userId, date: day, model: bucket.model, tool: bucket.tool } },
      create: {
        userId,
        date: day,
        model: bucket.model,
        tool: bucket.tool,
        tokensInput: bucket.tokensInput,
        tokensOutput: bucket.tokensOutput,
        activeSeconds: 0,
      },
      update: {
        tokensInput: { increment: bucket.tokensInput },
        tokensOutput: { increment: bucket.tokensOutput },
      },
    });
  }

  await touchStreak(userId, day);
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
    // Normalize the new null and every legacy sentinel ("unknown", "<synthetic>", "")
    // to null — rows written before ingestion-time normalization may still carry one.
    model: normalizeModel(session.model),
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
  if (!session) return { username, status: "offline", activity: null, tools: [] };

  const silentForMs = Date.now() - session.lastHeartbeatAt.getTime();
  const status: PresenceStatus =
    silentForMs > env.sessionIdleTimeoutMs ? "offline" : silentForMs > ONLINE_AFTER_MS ? "idle" : "active";

  if (status === "offline") return { username, status: "offline", activity: null, tools: [] };
  const activity = sessionToActivity(session);
  return {
    username,
    status,
    activity,
    tools: presenceTools((session as { coTools?: unknown }).coTools, activity),
  };
}
