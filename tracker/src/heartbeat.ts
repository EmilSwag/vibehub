import { attestedToolsFor, configFingerprint, heartbeatIntervalMs, idleThresholdMs, projectConfig, readConfig } from "./config";
import { Detector, mergeUsage } from "./detector";
import type { DetectionUsage, SeenSource } from "./detector";
import { resolveProjectAlias } from "./projectAlias";
import { eventTime, isSupportedTool, isTokenlessTool, localTzOffsetMinutes, MAX_RECORD_AGE_MS, objectRecord, projectHeartbeat, safeApiOrigin, safeDeviceToken, safeModel } from "./privacy";
import type { SendResult } from "./queue";
import { markAuthRejected, writeOfflineStatus, writeStatus } from "./statusFile";
import { clearStopRequest, isStopRequested } from "./stopRequest";
import type { HeartbeatPayload, HeartbeatTool, HeartbeatUsage, TrackerConfig } from "./types";

interface ActiveSession {
  projectAlias: string;
  tool: string;
  model: string | null;
  startedAt: string;
  cwd: string | null;
  projectHint: string | null;
}
/** Legacy exported constant; model identities are no longer inferred or carried across sources. */
export const MODEL_SWITCH_POLLS = 2;
const STOP_REQUEST_POLL_MS = 1000;
const IN_FLIGHT_GRACE_MS = 3000;

export interface LoopState {
  activeSession: ActiveSession | null;
  lastActivityAt: number | null;
  detector: Detector;
  /**
   * QA fix (R3): measured usage that has been READ but not yet delivered - a heartbeat
   * that failed, a tick the watchdog cancelled, or tokens read late with no live
   * activity to ride on. It goes out with the next heartbeat instead of being lost.
   * Bounded (MAX_USAGE_ENTRIES keys, MAX_RECORD_AGE_MS old) and bound to the config it
   * was read under: any config/account change or auth rejection drops it.
   */
  pendingUsage: Map<string, HeartbeatUsage>;
  pendingSince: number | null;
  sourcesSeen: Map<string, SeenSource>;
  modelChallenger: { model: string; polls: number } | null;
  activeWindowMs: number;
  /** Tool ids the user explicitly consented to receive; `[]` means the receiver is off. */
  attestedTools: string[];
  stopping: boolean;
  epoch: number;
  binding: string | null;
  requestAbort: AbortController | null;
  loadConfig: () => TrackerConfig | null;
}

export function createLoopState(config?: TrackerConfig): LoopState {
  const valid = projectConfig(config);
  const activeWindowMs = valid ? idleThresholdMs(valid) : 300000;
  const attestedTools = valid ? attestedToolsFor(valid) : [];
  return { activeSession: null, lastActivityAt: null,
    detector: new Detector(activeWindowMs, undefined, attestedTools),
    pendingUsage: new Map(), pendingSince: null, sourcesSeen: new Map(), modelChallenger: null,
    activeWindowMs, attestedTools, stopping: false, epoch: 0,
    binding: valid ? configFingerprint(valid) : null,
    requestAbort: null, loadConfig: readConfig };
}

/** Discard evidence on consent/config/account changes, cancellation or failed verification. */
export function clearCollectedState(state: LoopState, config?: TrackerConfig): void {
  state.epoch += 1;
  state.requestAbort?.abort();
  state.requestAbort = null;
  state.detector.clear();
  state.activeSession = null;
  state.lastActivityAt = null;
  state.pendingUsage.clear();
  state.pendingSince = null;
  state.sourcesSeen.clear();
  state.modelChallenger = null;
  state.binding = config ? configFingerprint(config) : null;
  // Withdrawing consent must take the receiver away, not merely stop using it, so a
  // detector built under the old setting is replaced rather than reused.
  const nextTools = config ? attestedToolsFor(config) : [];
  const consentChanged = nextTools.join("\u0000") !== state.attestedTools.join("\u0000");
  if (config && (idleThresholdMs(config) !== state.activeWindowMs || consentChanged)) {
    state.activeWindowMs = idleThresholdMs(config);
    state.attestedTools = nextTools;
    state.detector = new Detector(state.activeWindowMs, undefined, nextTools);
  } else if (!config && state.attestedTools.length) {
    state.attestedTools = [];
    state.detector = new Detector(state.activeWindowMs);
  }
}

/**
 * QA fix (R3): a TRANSIENT failure (network, 5xx, a stuck tick) ends the session view
 * but keeps what was read - the log cursors and the undelivered usage - so the next
 * successful tick delivers it. Before this every hiccup re-primed every log at EOF and
 * the tokens written meanwhile were never counted. Credentials, consent and config
 * changes still go through clearCollectedState, which forgets everything.
 */
export function softReset(state: LoopState): void {
  state.epoch += 1;
  state.requestAbort?.abort();
  state.requestAbort = null;
  state.activeSession = null;
  state.lastActivityAt = null;
  state.sourcesSeen.clear();
  state.modelChallenger = null;
}

/** Keeps undelivered usage for the next heartbeat, within the bounds on LoopState. */
export function stashUsage(state: LoopState, usage: readonly DetectionUsage[], now = Date.now()): void {
  if (state.pendingSince !== null && now - state.pendingSince > MAX_RECORD_AGE_MS) {
    state.pendingUsage.clear();
    state.pendingSince = null;
  }
  for (const u of usage) {
    if (mergeUsage(state.pendingUsage as Map<string, DetectionUsage>, u) && state.pendingSince === null) state.pendingSince = now;
  }
}

/** Pending usage plus this tick's, as one bounded list; what does not fit stays pending. */
function withPending(state: LoopState, usage: readonly DetectionUsage[]): { send: DetectionUsage[]; rest: DetectionUsage[] } {
  const merged = new Map<string, DetectionUsage>();
  const rest: DetectionUsage[] = [];
  for (const u of [...usage, ...state.pendingUsage.values()]) if (!mergeUsage(merged, u)) rest.push(u);
  return { send: [...merged.values()], rest };
}

function sameConfig(config: TrackerConfig, load: () => TrackerConfig | null): boolean {
  try {
    const current = projectConfig(load());
    return current !== null && configFingerprint(current) === configFingerprint(config);
  } catch { return false; }
}

/** Only the already-configured origin and existing tracker routes; no redirects. */
async function requestTracker(
  apiUrl: string, deviceToken: string, payload?: HeartbeatPayload, signal?: AbortSignal, retiring = false
): Promise<SendResult> {
  const origin = safeApiOrigin(apiUrl);
  if (!origin || !safeDeviceToken(deviceToken) || signal?.aborted) return { ok: false, authRejected: false };
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  try {
    const res = await fetch(`${origin}/api/v1/tracker/${payload ? "heartbeat" : "connection"}`, {
      method: retiring ? "DELETE" : "POST", redirect: "error",
      headers: { Authorization: `Bearer ${deviceToken}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: controller.signal,
    });
    const authRejected = res.status === 401 || res.status === 403;
    if (!payload && res.ok) {
      // Only the explicit transport receipt can mean connected; login verification,
      // arbitrary 2xx responses and unsupported servers cannot fabricate liveness.
      const receipt = objectRecord(await res.json());
      const at = typeof receipt?.lastSeenAt === "string" ? eventTime(receipt.lastSeenAt, Date.now(), 90000) : null;
      const valid = receipt?.protocol === "connection-v1" && receipt.connected === !retiring &&
        (retiring ? receipt.lastSeenAt === null || at !== null : at !== null);
      return { ok: !controller.signal.aborted && valid, authRejected: false,
        ...(valid && !retiring && at !== null ? { connectionLastSeenAt: new Date(at).toISOString() } : {}) };
    }
    try { await res.body?.cancel(); } catch {}
    const refused = res.status === 400 || res.status === 413 || res.status === 422;
    return { ok: !controller.signal.aborted && res.ok, authRejected, ...(refused ? { refused } : {}) };
  } catch { return { ok: false, authRejected: false }; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}

/** Runtime allowlist is the LAST boundary before every activity send. */
export async function postHeartbeat(
  apiUrl: string, deviceToken: string, payload: HeartbeatPayload, signal?: AbortSignal
): Promise<SendResult> {
  const safe = projectHeartbeat(payload);
  // A body our own boundary refuses is refused on every retry, same as a server 400.
  return safe ? requestTracker(apiUrl, deviceToken, safe, signal) : { ok: false, authRejected: false, refused: true };
}

/** Connection-v1 transport receipt, NOT login verification or a fake ACTIVE event. */
export function verifyConnection(config: TrackerConfig, signal?: AbortSignal): Promise<SendResult> {
  return requestTracker(config.apiUrl, config.deviceToken, undefined, signal);
}

/** Best-effort bodyless clean stop; a failed receipt expires under the server lease. */
export function retireConnection(config: TrackerConfig, signal?: AbortSignal): Promise<SendResult> {
  return requestTracker(config.apiUrl, config.deviceToken, undefined, signal, true);
}

/** Compatibility name only: failed sends are dropped, never cached or replayed. */
export async function sendOrQueue(config: TrackerConfig, payload: HeartbeatPayload): Promise<void> {
  const safe = projectConfig(config);
  if (!safe || !sameConfig(safe, readConfig)) return;
  const result = await postHeartbeat(safe.apiUrl, safe.deviceToken, payload);
  if (sameConfig(safe, readConfig) && (result.ok || result.authRejected)) markAuthRejected(result.authRejected);
}
export async function flushOfflineQueue(): Promise<{ delivered: number; remaining: number; authRejected: boolean }> {
  return { delivered: 0, remaining: 0, authRejected: false };
}

function sessionEvent(eventType: "session_start" | "session_end", session: ActiveSession, occurredAt: string): HeartbeatPayload {
  // session_start opens the server-side Session row, so the host's zone rides along from
  // the first write (honest achievements, Night Owl); session_end writes no row.
  return { eventType, projectAlias: session.projectAlias, tool: session.tool, model: session.model, occurredAt,
    ...(eventType === "session_start" ? { tzOffsetMinutes: localTzOffsetMinutes() } : {}) };
}

function buildTools(state: LoopState, config: TrackerConfig): HeartbeatTool[] {
  const session = state.activeSession;
  if (!session) return [];
  const tools = new Map<string, HeartbeatTool>([[session.tool, {
    tool: session.tool, model: session.model, projectAlias: session.projectAlias }]]);
  for (const source of state.sourcesSeen.values()) {
    if (!isSupportedTool(source.tool) || tools.has(source.tool)) continue;
    const alias = resolveProjectAlias(null, config, source.projectHint ?? null);
    if (alias === null) continue;
    tools.set(source.tool, { tool: source.tool, model: safeModel(source.model, source.tool), projectAlias: alias });
  }
  return [...tools.values()];
}

function writeSnapshot(state: LoopState, config: TrackerConfig | undefined, connected: boolean, rejected = false, receipt?: string): void {
  const now = new Date().toISOString();
  const session = connected ? state.activeSession : null;
  writeStatus({ configFingerprint: config ? configFingerprint(config) : undefined, connected,
    attestedReceiver: config ? attestedToolsFor(config).length > 0 : false,
    lastConnectionCheckAt: now, lastConnectionSeenAt: connected ? receipt : undefined,
    status: connected ? session ? "active" : "idle" : "offline",
    projectAlias: session?.projectAlias ?? null, tool: session?.tool ?? null, model: session?.model ?? null,
    sessionStartedAt: session?.startedAt ?? null, updatedAt: now, authRejected: rejected,
    sources: session ? [...state.sourcesSeen.values()].map((s) => ({
      tool: s.tool, model: s.model, lastSeenAt: new Date(s.lastSeenAt).toISOString() })) : [] });
}

/** One isolated cycle. State means supported AI activity, never PC/keyboard activity. */
export async function tick(config: TrackerConfig, state: LoopState): Promise<void> {
  if (state.stopping) return;
  const safe = projectConfig(config);
  if (!safe || !sameConfig(safe, state.loadConfig)) {
    clearCollectedState(state);
    writeSnapshot(state, undefined, false);
    return;
  }
  if (state.binding !== configFingerprint(safe)) clearCollectedState(state, safe);
  state.requestAbort?.abort();
  const controller = new AbortController();
  state.requestAbort = controller;
  const epoch = ++state.epoch;
  const allowed = (): boolean => {
    if (state.stopping || controller.signal.aborted || state.epoch !== epoch) return false;
    if (sameConfig(safe, state.loadConfig)) return true;
    clearCollectedState(state);
    writeSnapshot(state, undefined, false);
    return false;
  };
  const binding = state.binding;
  // Usage read this tick and not yet delivered. Whatever way the tick ends short of a
  // delivered heartbeat, it is stashed rather than dropped - unless the config it was
  // read under is gone (then it belongs to nobody and is forgotten).
  let unsent: DetectionUsage[] = [];
  const keepUnsent = (): void => {
    if (unsent.length && !state.stopping && state.binding === binding && binding !== null) stashUsage(state, unsent);
    unsent = [];
  };
  const failed = (result: SendResult, carriedUsage = false): void => {
    if (result.authRejected) {
      unsent = [];
      clearCollectedState(state, safe);
    } else if (result.refused && carriedUsage) {
      // A refused body is refused again on every retry: stashing its usage would jam
      // the tracker offline for good. Drop that usage; the log cursors stay put.
      unsent = [];
      state.pendingUsage.clear();
      state.pendingSince = null;
      console.warn("tracker: server refused a heartbeat; its usage was dropped");
      softReset(state);
    } else {
      keepUnsent();
      softReset(state);
    }
    writeSnapshot(state, safe, false, result.authRejected);
  };
  const send = async (payload: HeartbeatPayload): Promise<boolean> => {
    if (!allowed()) return false;
    const result = await postHeartbeat(safe.apiUrl, safe.deviceToken, payload, controller.signal);
    if (!allowed()) return false;
    if (!result.ok) { failed(result, payload.eventType === "heartbeat"); return false; }
    return true;
  };
  try {
    // No source reads with invalid/revoked credentials or unavailable verification.
    const connection = await verifyConnection(safe, controller.signal);
    if (!allowed()) return;
    if (!connection.ok) { failed(connection); return; }
    const current = state.activeSession ? { tool: state.activeSession.tool, cwd: null, projectHint: state.activeSession.projectHint } : undefined;
    const detection = await state.detector.detect(Date.now(), current,
      (o) => resolveProjectAlias(null, safe, o.projectHint) !== null, controller.signal);
    unsent = [...(detection?.usage ?? []), ...state.detector.takeLateUsage()];
    if (!allowed()) return;
    state.sourcesSeen.clear();
    state.modelChallenger = null;
    const now = new Date().toISOString();
    const alias = detection ? resolveProjectAlias(null, safe, detection.projectHint) : null;
    if (!detection || !detection.active || alias === null || !isSupportedTool(detection.tool)) {
      // No live activity to ride on: anything read (late usage) waits for the next beat.
      keepUnsent();
      if (state.activeSession && !await send(sessionEvent("session_end", state.activeSession, now))) return;
      state.activeSession = null;
      state.lastActivityAt = null;
      if (allowed()) writeSnapshot(state, safe, true, false, connection.connectionLastSeenAt);
      return;
    }
    for (const s of detection.seen) state.sourcesSeen.set(`${s.tool}\u0000${s.model ?? ""}`, {
      tool: s.tool, model: s.model, lastSeenAt: s.lastSeenAt, cwd: null, projectHint: s.projectHint ?? null });
    const model = safeModel(detection.model, detection.tool);
    const changed = !state.activeSession || state.activeSession.tool !== detection.tool ||
      state.activeSession.projectAlias !== alias || state.activeSession.model !== model;
    if (changed) {
      if (state.activeSession && !await send(sessionEvent("session_end", state.activeSession, now))) return;
      const session: ActiveSession = { tool: detection.tool, model, projectAlias: alias,
        startedAt: now, cwd: null, projectHint: detection.projectHint };
      if (!await send(sessionEvent("session_start", session, now))) return;
      state.activeSession = session;
    }
    // Pending usage rides along. Not on a tokenless primary, though: the server refuses
    // counts on its legacy sums for one, so they wait for a measured primary instead.
    let usage: DetectionUsage[] = [];
    if (isTokenlessTool(detection.tool)) keepUnsent();
    else {
      const { send: outgoing, rest } = withPending(state, unsent);
      state.pendingUsage.clear();
      state.pendingSince = null;
      if (rest.length) stashUsage(state, rest);
      // From here `unsent` is everything in flight: a failed or abandoned send stashes it.
      unsent = usage = outgoing;
    }
    if (!await send({ eventType: "heartbeat", projectAlias: alias, tool: detection.tool, model,
      tokensInputDelta: detection.tokensInputDelta, tokensOutputDelta: detection.tokensOutputDelta,
      usage, tools: buildTools(state, safe), tzOffsetMinutes: localTzOffsetMinutes(),
      occurredAt: now })) return;
    unsent = [];
    state.lastActivityAt = detection.lastActivityAt;
    if (allowed()) writeSnapshot(state, safe, true, false, connection.connectionLastSeenAt);
  } finally {
    // A tick that ended early (cancelled, config re-checked, stopped) keeps what it read.
    keepUnsent();
    if (state.requestAbort === controller) state.requestAbort = null;
  }
}

function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = (): void => { clearTimeout(timer); resolve(); };
    promise.then(done, done);
  });
}

export interface RunLoopOptions {
  onStopRequest?: () => void;
  loadConfig?: () => TrackerConfig | null;
  runTick?: (config: TrackerConfig, state: LoopState) => Promise<void>;
  watchdogMs?: number;
}
export const MIN_TICK_WATCHDOG_MS = 90_000;
export const tickWatchdogMs = (intervalMs: number): number => Math.max(3 * intervalMs, MIN_TICK_WATCHDOG_MS);
interface InFlightTick { seq: number; startedAt: number; done: Promise<void> }
export interface ConfigRefresh { config: TrackerConfig; changed: string[]; paused: boolean }
const LIVE_FIELDS = ["apiUrl", "deviceToken", "projectAliases", "idleThresholdMs", "attestedMetadata"] as const;

/** Missing/invalid config pauses collection; retaining a comparison value is NOT permission to send. */
export function refreshConfig(active: TrackerConfig, loaded: TrackerConfig | null): ConfigRefresh {
  const next = projectConfig(loaded);
  if (!next) return { config: active, changed: [], paused: true };
  const changed = LIVE_FIELDS.filter((field) => field === "projectAliases"
    ? JSON.stringify(next.projectAliases) !== JSON.stringify(active.projectAliases ?? {})
    : field === "idleThresholdMs" ? idleThresholdMs(next) !== idleThresholdMs(active)
    // Consent is compared by value, not identity, so granting or withdrawing it is
    // picked up on the next tick instead of waiting for a daemon restart.
    : field === "attestedMetadata" ? attestedToolsFor(next).join("\u0000") !== attestedToolsFor(active).join("\u0000")
    : next[field] !== active[field]);
  return { config: changed.length ? next : active, changed: [...changed], paused: false };
}

/** CLI/daemon contract unchanged. Tests MUST inject config/ticks or use an isolated HOME. */
export function runLoop(initialConfig: TrackerConfig, options: RunLoopOptions = {}): { stop: () => Promise<void> } {
  const loadConfig = options.loadConfig ?? readConfig;
  const runTick = options.runTick ?? tick;
  let config = initialConfig;
  const state = createLoopState(config);
  state.loadConfig = loadConfig;
  const intervalMs = heartbeatIntervalMs(config);
  const watchdogMs = options.watchdogMs ?? tickWatchdogMs(intervalMs);
  let inFlight: InFlightTick | null = null;
  let ticks = 0;
  let stopRequestSeen = false;
  const checkStopRequest = (): boolean => {
    if (stopRequestSeen || state.stopping) return true;
    if (!isStopRequested()) return false;
    stopRequestSeen = true;
    state.epoch += 1;
    state.requestAbort?.abort();
    state.detector.clear();
    console.log("tracker: stop requested (stop.request found)");
    options.onStopRequest?.();
    return true;
  };
  const safeTick = (): void => {
    if (state.stopping || checkStopRequest()) return;
    let loaded: TrackerConfig | null = null;
    try { loaded = loadConfig(); } catch {}
    const refreshed = refreshConfig(config, loaded);
    if (refreshed.paused) {
      clearCollectedState(state);
      inFlight = null;
      writeSnapshot(state, undefined, false);
      return;
    }
    if (refreshed.changed.length) {
      console.log(`tracker: config.json changed (${refreshed.changed.join(", ")}); applied without a restart`);
      clearCollectedState(state, refreshed.config);
      inFlight = null;
    }
    config = refreshed.config;
    if (inFlight) {
      const stuckFor = Date.now() - inFlight.startedAt;
      if (stuckFor <= watchdogMs) return;
      console.warn(`tracker: tick #${inFlight.seq} exceeded watchdog ${watchdogMs} ms; cancelling it`);
      // Transient by definition: keep the log cursors and undelivered usage (QA fix R3).
      softReset(state);
      inFlight = null;
    }
    const startedAt = Date.now();
    const mine: InFlightTick = { seq: ++ticks, startedAt, done: Promise.resolve().then(() => runTick(config, state))
      .catch(() => {
        if (inFlight !== mine) return;
        console.error("tracker: heartbeat tick failed; collection paused");
        clearCollectedState(state);
        writeSnapshot(state, undefined, false);
      }).finally(() => {
        if (inFlight === mine) inFlight = null;
        else console.warn(`tracker: cancelled tick #${mine.seq} finished late`);
      }) };
    inFlight = mine;
  };
  safeTick();
  const interval = setInterval(safeTick, intervalMs);
  const stopWatch = setInterval(checkStopRequest, STOP_REQUEST_POLL_MS);
  const stop = async (): Promise<void> => {
    clearInterval(interval); clearInterval(stopWatch);
    state.stopping = true;
    state.epoch += 1;
    state.requestAbort?.abort();
    state.detector.clear();
    if (inFlight) await settleWithin(inFlight.done, IN_FLIGHT_GRACE_MS);
    if (state.activeSession && sameConfig(config, loadConfig)) {
      await postHeartbeat(config.apiUrl, config.deviceToken, sessionEvent("session_end", state.activeSession, new Date().toISOString()), AbortSignal.timeout(2000));
    }
    if (sameConfig(config, loadConfig)) await retireConnection(config, AbortSignal.timeout(2000));
    clearCollectedState(state);
    writeOfflineStatus();
    clearStopRequest();
  };
  return { stop };
}
