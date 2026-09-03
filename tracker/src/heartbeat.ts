import { heartbeatIntervalMs, idleThresholdMs } from "./config";
import { Detector } from "./detector";
import { resolveProjectAlias } from "./projectAlias";
import { enqueue, flushQueue } from "./queue";
import { writeOfflineStatus, writeStatus } from "./statusFile";
import type { HeartbeatPayload, QueuedEvent, TrackerConfig } from "./types";

const UNKNOWN_MODEL = "unknown";

interface ActiveSession {
  projectAlias: string;
  tool: string;
  model: string;
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
 * network/parse failures resolve to `false` so the caller can queue instead.
 */
export async function postHeartbeat(
  apiUrl: string,
  deviceToken: string,
  payload: HeartbeatPayload
): Promise<boolean> {
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
    return res.ok;
  } catch {
    return false;
  }
}

async function sendOrQueue(
  config: TrackerConfig,
  payload: HeartbeatPayload
): Promise<void> {
  const ok = await postHeartbeat(config.apiUrl, config.deviceToken, payload);
  if (!ok) {
    enqueue({ payload, apiUrl: config.apiUrl, deviceToken: config.deviceToken });
  }
}

/** Retries queued events in order; stops at the first still-failing send. */
export async function flushOfflineQueue(): Promise<{
  delivered: number;
  remaining: number;
}> {
  return flushQueue((event: QueuedEvent) =>
    postHeartbeat(event.apiUrl, event.deviceToken, event.payload)
  );
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
    const model = detection.model ?? state.activeSession?.model ?? UNKNOWN_MODEL;
    const changed =
      !state.activeSession ||
      state.activeSession.projectAlias !== alias ||
      state.activeSession.tool !== tool ||
      // model unknown → known is a refinement, not a new session
      (state.activeSession.model !== model && state.activeSession.model !== UNKNOWN_MODEL);

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
    writeStatus({
      status: "active",
      projectAlias: alias,
      tool,
      model,
      sessionStartedAt: session.startedAt,
      updatedAt: nowIso,
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
