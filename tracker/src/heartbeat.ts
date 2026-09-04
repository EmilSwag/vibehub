import { heartbeatIntervalMs, idleThresholdMs } from "./config";
import { Detector } from "./detector";
import { resolveProjectAlias } from "./projectAlias";
import { enqueue, flushQueue } from "./queue";
import type { SendResult } from "./queue";
import { markAuthRejected, readStatus, writeOfflineStatus, writeStatus } from "./statusFile";
import type { HeartbeatPayload, QueuedEvent, TrackerConfig } from "./types";

interface ActiveSession {
  projectAlias: string;
  tool: string;
  /** null when the tool exposes no model (presence-only tools). */
  model: string | null;
  startedAt: string;
}

export interface LoopState {
  activeSession: ActiveSession | null;
  lastActivityAt: number | null;
  detector: Detector;
  /** Tokens seen while no session was open — attached to the next heartbeat. */
  pendingTokensIn: number;
  pendingTokensOut: number;
}

export function createLoopState(config?: TrackerConfig): LoopState {
  return {
    activeSession: null,
    lastActivityAt: null,
    detector: new Detector(config ? idleThresholdMs(config) : 5 * 60 * 1000),
    pendingTokensIn: 0,
    pendingTokensOut: 0,
  };
}

/**
 * POSTs one heartbeat event per docs/ARCHITECTURE.md §4.3. Never throws —
 * network/parse failures resolve to `{ ok: false, authRejected: false }` so
 * the caller can queue instead. A 401 is reported distinctly (`authRejected:
 * true`): that's the server saying the token itself is bad, not a transient
 * failure — see queue.ts's flushQueue for why that must not be retried.
 */
export async function postHeartbeat(
  apiUrl: string,
  deviceToken: string,
  payload: HeartbeatPayload
): Promise<SendResult> {
  try {
    const res = await fetch(
      `${apiUrl.replace(/\/+$/, "")}/api/v1/tracker/heartbeat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deviceToken}`,
        },
        body: JSON.stringify(payload),
      }
    );
    return { ok: res.ok, authRejected: res.status === 401 };
  } catch {
    return { ok: false, authRejected: false };
  }
}

async function sendOrQueue(
  config: TrackerConfig,
  payload: HeartbeatPayload
): Promise<void> {
  const result = await postHeartbeat(config.apiUrl, config.deviceToken, payload);
  if (result.authRejected) {
    markAuthRejected(true);
    return; // don't enqueue a payload that's guaranteed to fail again
  }
  if (!result.ok) {
    enqueue({ payload, apiUrl: config.apiUrl, deviceToken: config.deviceToken });
    return;
  }
  markAuthRejected(false);
}

/** Retries queued events in order; stops at the first still-failing send. */
export async function flushOfflineQueue(): Promise<{
  delivered: number;
  remaining: number;
  authRejected: boolean;
}> {
  const result = await flushQueue((event: QueuedEvent) =>
    postHeartbeat(event.apiUrl, event.deviceToken, event.payload)
  );
  if (result.authRejected) markAuthRejected(true);
  return result;
}

function endActiveSession(
  config: TrackerConfig,
  session: ActiveSession,
  occurredAt: string
): Promise<void> {
  return sendOrQueue(config, {
    eventType: "session_end",
    projectAlias: session.projectAlias,
    tool: session.tool,
    model: session.model,
    occurredAt,
  });
}

/** One poll/heartbeat cycle. Exported standalone so it is unit-testable. */
export async function tick(config: TrackerConfig, state: LoopState): Promise<void> {
  await flushOfflineQueue();

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const detection = await state.detector.detect(now);

  // Token deltas are real spend regardless of whether we consider the user "active".
  if (detection) {
    state.pendingTokensIn += detection.tokensInputDelta;
    state.pendingTokensOut += detection.tokensOutputDelta;
  }

  const alias = detection ? resolveProjectAlias(detection.cwd, config, detection.projectHint) : null;

  if (detection && detection.active && alias !== null) {
    const tool = detection.tool;
    // Carry the model when knowable, else null. A previously-known model is kept if
    // this poll saw none (log line without a model field), so a session doesn't
    // flip known → null mid-run.
    const model = detection.model ?? state.activeSession?.model ?? null;
    const changed =
      !state.activeSession ||
      state.activeSession.projectAlias !== alias ||
      state.activeSession.tool !== tool ||
      // model null → known is a refinement, not a new session
      (state.activeSession.model !== model && state.activeSession.model !== null);

    if (changed) {
      if (state.activeSession) {
        await endActiveSession(config, state.activeSession, nowIso);
      }
      state.activeSession = { projectAlias: alias, tool, model, startedAt: nowIso };
      await sendOrQueue(config, {
        eventType: "session_start",
        projectAlias: alias,
        tool,
        model,
        occurredAt: nowIso,
      });
    } else if (state.activeSession) {
      state.activeSession.model = model;
    }
    const session = state.activeSession!;

    await sendOrQueue(config, {
      eventType: "heartbeat",
      projectAlias: alias,
      tool,
      model,
      tokensInputDelta: state.pendingTokensIn,
      tokensOutputDelta: state.pendingTokensOut,
      occurredAt: nowIso,
    });
    state.pendingTokensIn = 0;
    state.pendingTokensOut = 0;

    state.lastActivityAt = now;
    // Preserve authRejected — sendOrQueue above may have just set/cleared it, and
    // this write must not clobber that back to undefined every active tick.
    writeStatus({
      status: "active",
      projectAlias: alias,
      tool,
      model,
      sessionStartedAt: session.startedAt,
      updatedAt: nowIso,
      authRejected: readStatus().authRejected,
    });
    return;
  }

  // Nothing active (tool closed, logs quiet, or project hidden) — evaluate idle.
  if (!state.activeSession) return; // nothing has ever been detected; stay offline
  const idleAfter = idleThresholdMs(config);
  if (state.lastActivityAt !== null && now - state.lastActivityAt >= idleAfter) {
    // Close the session server-side so active-time stats stop accruing; the
    // status file keeps the last project so the menu-bar app can show "idle in X".
    const ended = state.activeSession;
    await endActiveSession(config, ended, nowIso);
    state.activeSession = null;
    writeStatus({
      status: "idle",
      projectAlias: ended.projectAlias,
      tool: ended.tool,
      model: ended.model,
      sessionStartedAt: ended.startedAt,
      updatedAt: nowIso,
      authRejected: readStatus().authRejected,
    });
  }
}

/**
 * Runs the poll/heartbeat loop until `stop()` is called. Used by the detached
 * daemon process (see daemon.ts's hidden `run-loop` command).
 */
export function runLoop(config: TrackerConfig): { stop: () => Promise<void> } {
  const state = createLoopState(config);
  const safeTick = () =>
    tick(config, state).catch((err) => {
      console.error("tracker: heartbeat tick failed:", err);
    });
  // First tick immediately: primes the log tailers so the *next* tick can
  // report deltas, and gets presence up within seconds of `vibehub start`.
  void safeTick();
  const interval = setInterval(safeTick, heartbeatIntervalMs(config));

  const stop = async (): Promise<void> => {
    clearInterval(interval);
    if (state.activeSession) {
      await endActiveSession(config, state.activeSession, new Date().toISOString());
      state.activeSession = null;
    }
    writeOfflineStatus();
  };

  return { stop };
}
