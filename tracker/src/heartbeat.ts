import { heartbeatIntervalMs, idleThresholdMs } from "./config";
import { Detector } from "./detector";
import type { Detection, DetectionUsage, SeenSource } from "./detector";
import { resolveProjectAlias } from "./projectAlias";
import { enqueue, flushQueue } from "./queue";
import type { SendResult } from "./queue";
import { markAuthRejected, readStatus, writeOfflineStatus, writeStatus } from "./statusFile";
import { clearStopRequest, isStopRequested } from "./stopRequest";
import type { HeartbeatPayload, HeartbeatTool, HeartbeatUsage, QueuedEvent, StatusSource, TrackerConfig } from "./types";

interface ActiveSession {
  projectAlias: string;
  tool: string;
  /** null when the tool exposes no model (presence-only tools). */
  model: string | null;
  startedAt: string;
  /**
   * Where the session was detected — kept in memory ONLY for the detector's
   * hysteresis (same tool + same project). Never written to status.json or a
   * payload: `cwd` is a full path (privacy invariant, index.ts header).
   */
  cwd: string | null;
  projectHint: string | null;
}

/** How long a tool/model stays in `status.json`'s `sources` after it was last seen. */
const SOURCES_WINDOW_MS = 10 * 60 * 1000;

/** Consecutive polls a challenger model must burn tokens alone before presence follows it. */
export const MODEL_SWITCH_POLLS = 2;

/** How often the loop looks for `stop.request` between ticks. */
const STOP_REQUEST_POLL_MS = 1000;

/** How long `stop()` waits for a mid-flight tick before sending session_end regardless. */
const IN_FLIGHT_GRACE_MS = 3000;

/** A model other than the session's that has been burning tokens while the session's model was silent. */
interface ModelChallenger {
  model: string;
  /** Consecutive polls (so far) in which it burned and the current model did not. */
  polls: number;
}

export interface LoopState {
  activeSession: ActiveSession | null;
  lastActivityAt: number | null;
  detector: Detector;
  /**
   * Token deltas not yet delivered, keyed by tool+model. Accumulates while no
   * session is open (or while a project is hidden) and rides on the next
   * heartbeat, so spend is never lost — and never re-attributed.
   */
  pendingUsage: Map<string, HeartbeatUsage>;
  /** (tool, model) pairs seen within SOURCES_WINDOW_MS, keyed like pendingUsage. */
  sourcesSeen: Map<string, SeenSource>;
  /** Presence-model hysteresis bookkeeping — see resolvePresenceModel. */
  modelChallenger: ModelChallenger | null;
  /** Same window the detector uses: a source not seen inside it is stale. */
  activeWindowMs: number;
  /** Set by runLoop's stop(): a tick still in flight must not send anything more. */
  stopping: boolean;
}

export function createLoopState(config?: TrackerConfig): LoopState {
  const activeWindowMs = config ? idleThresholdMs(config) : 5 * 60 * 1000;
  return {
    activeSession: null,
    lastActivityAt: null,
    detector: new Detector(activeWindowMs),
    pendingUsage: new Map(),
    sourcesSeen: new Map(),
    modelChallenger: null,
    activeWindowMs,
    stopping: false,
  };
}

const usageKey = (tool: string, model: string | null): string => `${tool}\u0000${model ?? ""}`;

function addPendingUsage(state: LoopState, u: DetectionUsage): void {
  if (u.tokensInputDelta <= 0 && u.tokensOutputDelta <= 0) return;
  const key = usageKey(u.tool, u.model);
  const bucket = state.pendingUsage.get(key) ?? { tool: u.tool, model: u.model, tokensInputDelta: 0, tokensOutputDelta: 0 };
  bucket.tokensInputDelta += u.tokensInputDelta;
  bucket.tokensOutputDelta += u.tokensOutputDelta;
  if (u.estimated) bucket.estimated = true;
  state.pendingUsage.set(key, bucket);
}

/** Round 6 `tools[]` cap — the server's schema rejects more than this. */
const MAX_TOOLS = 10;

/**
 * Every tool seen open right now, primary first, one entry per tool.
 *
 * Built from the same `sources` map `status` prints, narrowed to the active window
 * so a tool closed ten minutes ago doesn't linger in presence. Within a tool the
 * freshest entry wins, so a tool that switched models reports the current one.
 * Each entry's project is resolved through `resolveProjectAlias`, exactly like the
 * primary's, so user aliases apply; a project the user marked `hidden` yields a
 * null alias — the tool still shows, its project name does not.
 */
function buildTools(
  state: LoopState,
  config: TrackerConfig,
  primary: { tool: string; model: string | null; projectAlias: string },
  now: number
): HeartbeatTool[] {
  const byTool = new Map<string, HeartbeatTool>();
  byTool.set(primary.tool, { tool: primary.tool, model: primary.model, projectAlias: primary.projectAlias });

  const fresh = [...state.sourcesSeen.values()]
    .filter((s) => now - s.lastSeenAt <= state.activeWindowMs)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  for (const s of fresh) {
    if (byTool.has(s.tool)) continue;
    byTool.set(s.tool, {
      tool: s.tool,
      model: s.model,
      projectAlias: resolveProjectAlias(s.cwd ?? null, config, s.projectHint ?? null),
    });
    if (byTool.size >= MAX_TOOLS) break;
  }
  return [...byTool.values()];
}

/** Drains the pending map into a payload-ready list plus the legacy sums. */
function takePendingUsage(state: LoopState): { usage: HeartbeatUsage[]; tokensInputDelta: number; tokensOutputDelta: number } {
  const usage: HeartbeatUsage[] = [];
  let tokensInputDelta = 0;
  let tokensOutputDelta = 0;
  for (const u of state.pendingUsage.values()) {
    if (u.tokensInputDelta <= 0 && u.tokensOutputDelta <= 0) continue;
    usage.push({ ...u });
    tokensInputDelta += u.tokensInputDelta;
    tokensOutputDelta += u.tokensOutputDelta;
  }
  state.pendingUsage.clear();
  return { usage, tokensInputDelta, tokensOutputDelta };
}

function noteSources(state: LoopState, seen: SeenSource[], now: number): StatusSource[] {
  for (const s of seen) {
    const key = usageKey(s.tool, s.model);
    const prev = state.sourcesSeen.get(key);
    if (!prev || s.lastSeenAt > prev.lastSeenAt) state.sourcesSeen.set(key, { ...s });
  }
  for (const [key, s] of state.sourcesSeen) {
    if (now - s.lastSeenAt > SOURCES_WINDOW_MS) state.sourcesSeen.delete(key);
  }
  return [...state.sourcesSeen.values()]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((s) => ({ tool: s.tool, model: s.model, lastSeenAt: new Date(s.lastSeenAt).toISOString() }));
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

/** Direct POST, else queued for the next tick (a 401 is neither: see postHeartbeat). */
export async function sendOrQueue(
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

/** session_start / session_end carry presence only — never token deltas or usage. */
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

/**
 * Presence-model hysteresis. Token attribution is exact and untouched by this; it
 * only decides which single model the *session* reports. Within one tool+project
 * several session files burn tokens in turn — the main model, a cheaper side-call
 * model (title generation), sub-agents on other models — and the detector's pick
 * follows whichever file burned most recently. Reporting that verbatim produced a
 * session_end/session_start pair every poll (opus-5 → sonnet-5 → fable in 90 s).
 *
 * So the current model is kept unless one of:
 *  - the same challenger burned tokens in MODEL_SWITCH_POLLS consecutive polls while
 *    the current model burned none in those polls;
 *  - the current model's source has gone stale — nothing seen for (tool, model)
 *    inside activeWindowMs, per the same `sources` map `status` prints.
 * A previously-unknown model (null) is adopted at once: that is a refinement, not a
 * switch. Any other tool/project change resets the challenger; those switches are
 * governed by the detector's tool hysteresis, not by this.
 */
function resolvePresenceModel(state: LoopState, detection: Detection, tool: string, alias: string, now: number): string | null {
  const session = state.activeSession;
  // A previously-known model is kept if this poll saw none (log line without a
  // model field), so a session doesn't flip known → null mid-run.
  const candidate = detection.model ?? session?.model ?? null;
  if (
    !session ||
    session.projectAlias !== alias ||
    session.tool !== tool ||
    session.model === null ||
    candidate === null ||
    candidate === session.model
  ) {
    state.modelChallenger = null;
    return candidate;
  }

  const current = session.model;
  const burned = (model: string): boolean =>
    detection.usage.some((u) => u.tool === tool && u.model === model && (u.tokensInputDelta > 0 || u.tokensOutputDelta > 0));
  const currentLastSeen = state.sourcesSeen.get(usageKey(tool, current))?.lastSeenAt ?? 0;
  if (now - currentLastSeen > state.activeWindowMs) {
    state.modelChallenger = null;
    return candidate; // the model we were reporting has gone quiet for the whole window
  }

  if (burned(candidate) && !burned(current)) {
    const polls = state.modelChallenger?.model === candidate ? state.modelChallenger.polls + 1 : 1;
    if (polls >= MODEL_SWITCH_POLLS) {
      state.modelChallenger = null;
      return candidate;
    }
    state.modelChallenger = { model: candidate, polls };
  } else {
    // A one-off side call, both models busy, or a different challenger: start over.
    state.modelChallenger = null;
  }
  return current;
}

/** One poll/heartbeat cycle. Exported standalone so it is unit-testable. */
export async function tick(config: TrackerConfig, state: LoopState): Promise<void> {
  await flushOfflineQueue();

  const current = state.activeSession
    ? { tool: state.activeSession.tool, cwd: state.activeSession.cwd, projectHint: state.activeSession.projectHint }
    : undefined;
  const detection = await state.detector.detect(Date.now(), current);

  // `occurredAt` is stamped AFTER detection so a slow poll (a process listing that
  // takes tens of seconds) doesn't date every payload at the start of the tick and
  // leave Session.endedAt before lastHeartbeatAt.
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Token deltas are real spend regardless of whether we consider the user "active",
  // and each stays booked under the (tool, model) that produced it.
  if (detection) {
    for (const u of detection.usage) addPendingUsage(state, u);
  }
  // A stop landed while we were polling: the shutdown path owns session_end now,
  // and a heartbeat sent after it would reopen the session server-side.
  if (state.stopping) return;
  const sources = noteSources(state, detection?.seen ?? [], now);

  const alias = detection ? resolveProjectAlias(detection.cwd, config, detection.projectHint) : null;

  if (detection && detection.active && alias !== null) {
    const tool = detection.tool;
    const model = resolvePresenceModel(state, detection, tool, alias, now);
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
      state.activeSession = {
        projectAlias: alias,
        tool,
        model,
        startedAt: nowIso,
        cwd: detection.cwd,
        projectHint: detection.projectHint,
      };
      await sendOrQueue(config, {
        eventType: "session_start",
        projectAlias: alias,
        tool,
        model,
        occurredAt: nowIso,
      });
    } else if (state.activeSession) {
      state.activeSession.model = model;
      state.activeSession.cwd = detection.cwd;
      state.activeSession.projectHint = detection.projectHint;
    }
    const session = state.activeSession!;

    // Heartbeat v2: `usage` is the precise per-(tool, model) attribution; the
    // top-level deltas are its sums so servers without v2 still count spend.
    const pending = takePendingUsage(state);
    await sendOrQueue(config, {
      eventType: "heartbeat",
      projectAlias: alias,
      tool,
      model,
      tokensInputDelta: pending.tokensInputDelta,
      tokensOutputDelta: pending.tokensOutputDelta,
      usage: pending.usage,
      tools: buildTools(state, config, { tool, model, projectAlias: alias }, now),
      occurredAt: nowIso,
    });

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
      sources,
    });
    return;
  }

  // Nothing active (tool closed, logs quiet, or project hidden) — evaluate idle.
  state.modelChallenger = null;
  if (!state.activeSession) {
    // Nothing has ever been detected; stay offline, but keep "Seeing:" honest so
    // `status` can explain why (e.g. Cursor open, no Claude log activity yet).
    writeSourcesIfChanged(sources, nowIso);
    return;
  }
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
      sources,
    });
    return;
  }
  writeSourcesIfChanged(sources, nowIso);
}

/** Refreshes only `sources` in status.json, and only when the list actually changed. */
function writeSourcesIfChanged(sources: StatusSource[], nowIso: string): void {
  const current = readStatus();
  const same =
    (current.sources ?? []).length === sources.length &&
    (current.sources ?? []).every((s, i) => s.tool === sources[i].tool && s.model === sources[i].model);
  if (same) return;
  writeStatus({ ...current, updatedAt: nowIso, sources });
}

/** Resolves when `p` settles or after `ms`, whichever is first; never rejects. */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });
}

export interface RunLoopOptions {
  /**
   * Called once when `~/.vibehub/stop.request` appears (written by `vibehub-tracker
   * stop`). The loop stops scheduling ticks; the callback is expected to call
   * `stop()` and exit — see daemon.ts's runForeground.
   */
  onStopRequest?: () => void;
}

/**
 * Runs the poll/heartbeat loop until `stop()` is called. Used by the detached
 * daemon process (see daemon.ts's hidden `run-loop` command).
 *
 * Ticks never overlap: if the previous one is still in flight when the interval
 * fires (a slow process listing), the new tick is skipped rather than stacked —
 * otherwise a 54 s poll on a 30 s interval piles up concurrent ticks that all send
 * stale-dated payloads.
 */
export function runLoop(config: TrackerConfig, options: RunLoopOptions = {}): { stop: () => Promise<void> } {
  const state = createLoopState(config);
  const intervalMs = heartbeatIntervalMs(config);
  let inFlight: Promise<void> | null = null;
  let stopRequestSeen = false;

  const checkStopRequest = (): boolean => {
    if (stopRequestSeen) return true;
    if (!isStopRequested()) return false;
    stopRequestSeen = true;
    console.log("tracker: stop requested (stop.request found)");
    options.onStopRequest?.();
    return true;
  };

  const safeTick = (): void => {
    if (state.stopping || checkStopRequest()) return;
    if (inFlight) {
      console.debug(`tracker: previous tick still in flight after ${intervalMs} ms; skipping this tick`);
      return;
    }
    const startedAt = Date.now();
    inFlight = tick(config, state)
      .catch((err) => {
        console.error("tracker: heartbeat tick failed:", err);
      })
      .finally(() => {
        inFlight = null;
        const took = Date.now() - startedAt;
        if (took > intervalMs) console.warn(`tracker: tick took ${took} ms (interval ${intervalMs} ms)`);
      });
  };

  // First tick immediately: primes the log tailers so the *next* tick can
  // report deltas, and gets presence up within seconds of `vibehub start`.
  safeTick();
  const interval = setInterval(safeTick, intervalMs);
  const stopWatch = setInterval(checkStopRequest, STOP_REQUEST_POLL_MS);

  const stop = async (): Promise<void> => {
    clearInterval(interval);
    clearInterval(stopWatch);
    state.stopping = true;
    // Let a tick that is mid-send finish so session_end lands after its heartbeat;
    // a tick stuck in a slow poll is abandoned (it checks `stopping` on return).
    if (inFlight) await settleWithin(inFlight, IN_FLIGHT_GRACE_MS);
    if (state.activeSession) {
      await endActiveSession(config, state.activeSession, new Date().toISOString());
      state.activeSession = null;
    }
    writeOfflineStatus();
    clearStopRequest();
  };

  return { stop };
}
