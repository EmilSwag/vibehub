import { heartbeatIntervalMs, idleThresholdMs } from "./config";
import { DEFAULT_TOOL_PROCESS_NAMES, detectActiveTool } from "./processDetector";
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
}

export function createLoopState(): LoopState {
  return { activeSession: null, lastActivityAt: null };
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
  const detection = detectActiveTool(
    config.toolProcessNames ?? DEFAULT_TOOL_PROCESS_NAMES
  );
  const alias = detection ? resolveProjectAlias(detection.cwd, config) : null;

  if (detection && alias !== null) {
    const tool = detection.tool;
    const model = UNKNOWN_MODEL; // no tool-log adapters wired in this scaffold — see README
    const changed =
      !state.activeSession ||
      state.activeSession.projectAlias !== alias ||
      state.activeSession.tool !== tool ||
      state.activeSession.model !== model;

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
    }
    const session: ActiveSession = state.activeSession ?? {
      projectAlias: alias,
      tool,
      model,
      startedAt: nowIso,
    };

    await sendOrQueue(config, {
      eventType: "heartbeat",
      projectAlias: alias,
      tool,
      model,
      tokensInputDelta: 0,
      tokensOutputDelta: 0,
      occurredAt: nowIso,
    });

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

  // No configured tool running (or the active project is hidden) — evaluate idle.
  if (!state.activeSession) return; // nothing has ever been detected; stay offline
  const idleAfter = idleThresholdMs(config);
  if (state.lastActivityAt !== null && now - state.lastActivityAt >= idleAfter) {
    writeStatus({
      status: "idle",
      projectAlias: state.activeSession.projectAlias,
      tool: state.activeSession.tool,
      model: state.activeSession.model,
      sessionStartedAt: state.activeSession.startedAt,
      updatedAt: nowIso,
    });
  }
}

/**
 * Runs the poll/heartbeat loop until `stop()` is called. Used by the detached
 * daemon process (see daemon.ts's hidden `run-loop` command).
 */
export function runLoop(config: TrackerConfig): { stop: () => Promise<void> } {
  const state = createLoopState();
  const interval = setInterval(() => {
    tick(config, state).catch((err) => {
      console.error("tracker: heartbeat tick failed:", err);
    });
  }, heartbeatIntervalMs(config));

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
