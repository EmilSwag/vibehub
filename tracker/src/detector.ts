import { AttestedMetadataAdapter } from "./adapters/attested";
import { ClaudeCodeAdapter } from "./adapters/claudeCode";
import { CodexAdapter } from "./adapters/codex";
import { MAX_LOG_FILES } from "./adapters/jsonlTail";
import { QuadcodeAdapter } from "./adapters/quadcode";
import type { Adapter, Observation } from "./adapters/types";
import { hasUsage, isAttestedTool, isCount, isSupportedTool, MAX_EVENT_AGE_MS, MAX_RECORD_AGE_MS, MAX_FUTURE_SKEW_MS, MAX_USAGE_ENTRIES, projectUsage, safeAlias, safeModel } from "./privacy";

export interface DetectionUsage {
  tool: string; model: string | null; tokensInputDelta: number; tokensOutputDelta: number;
  /** Cache reads (never part of tokensInputDelta) and cache writes (a subset of it). */
  tokensCacheReadDelta?: number; tokensCacheWriteDelta?: number; estimated?: boolean;
}
export interface SeenSource { tool: string; model: string | null; lastSeenAt: number; cwd?: string | null; projectHint?: string | null }
export interface CurrentSession { tool: string; cwd: string | null; projectHint: string | null }
export interface Detection {
  tool: string;
  model: string | null;
  cwd: string | null;
  projectHint: string | null;
  active: boolean;
  lastActivityAt: number;
  tokensInputDelta: number;
  tokensOutputDelta: number;
  usage: DetectionUsage[];
  seen: SeenSource[];
}

export const ADAPTER_POLL_TIMEOUT_MS = 45_000;
const busyAdapters = new WeakSet<Adapter>();
const newest = (list: Observation[]): Observation | null => list.reduce<Observation | null>(
  (best, observation) => !best || observation.lastActivityAt > best.lastActivityAt ? observation : best, null);
const hasTokens = (o: Observation): boolean => o.tokensInputDelta > 0 || o.tokensOutputDelta > 0 || o.usage.some(hasUsage);
const usageKey = (tool: string, model: string | null): string => `${tool}\u0000${model ?? ""}`;

/** Bounded, cancellable and non-overlapping. A late source cannot feed a later tick. */
export async function pollAdapter(
  adapter: Adapter, timeoutMs = ADAPTER_POLL_TIMEOUT_MS, now = Date.now(), signal?: AbortSignal
): Promise<Observation[]> {
  if (signal?.aborted || busyAdapters.has(adapter)) return [];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishCancelled: (() => void) | undefined;
  const cancel = (): void => { controller.abort(); finishCancelled?.(); };
  signal?.addEventListener("abort", cancel, { once: true });
  busyAdapters.add(adapter);
  try {
    const cancelled = new Promise<Observation[]>((resolve) => {
      finishCancelled = () => resolve([]);
      timer = setTimeout(() => {
        console.warn("tracker: AI source poll timed out; unavailable this tick");
        cancel();
      }, timeoutMs);
    });
    const poll = Promise.resolve().then(() => adapter.poll(now, controller.signal))
      .finally(() => busyAdapters.delete(adapter));
    const result = await Promise.race([poll, cancelled]);
    return controller.signal.aborted || !Array.isArray(result) ? [] : result.slice(0, MAX_LOG_FILES);
  } catch {
    console.warn("tracker: AI source poll failed; unavailable this tick");
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Runtime projection as well as types: no raw fields survive an adapter boundary. */
function projectObservation(o: Observation, now: number, windowMs: number): Observation | null {
  if (!o || !isSupportedTool(o.tool) || o.confidence !== "activity" || o.cwd !== null ||
      !Number.isSafeInteger(o.lastActivityAt) || o.lastActivityAt < now - windowMs ||
      o.lastActivityAt > now + MAX_FUTURE_SKEW_MS || !Array.isArray(o.usage) || o.usage.length > MAX_USAGE_ENTRIES) return null;
  const usage = [];
  for (const entry of o.usage) {
    const u = projectUsage({ tool: o.tool, model: entry?.model, tokensInputDelta: entry?.tokensInputDelta,
      tokensOutputDelta: entry?.tokensOutputDelta, tokensCacheReadDelta: entry?.tokensCacheReadDelta,
      tokensCacheWriteDelta: entry?.tokensCacheWriteDelta, estimated: entry?.estimated });
    if (!u) return null;
    const { tool: _tool, ...delta } = u;
    usage.push(delta);
  }
  const input = usage.reduce((n, u) => n + u.tokensInputDelta, 0);
  const output = usage.reduce((n, u) => n + u.tokensOutputDelta, 0);
  if (!isCount(input) || !isCount(output) || input !== o.tokensInputDelta || output !== o.tokensOutputDelta) return null;
  return { tool: o.tool, model: safeModel(o.model, o.tool), cwd: null, projectHint: safeAlias(o.projectHint),
    confidence: "activity", lastActivityAt: Math.min(now, o.lastActivityAt), observedAt: Math.min(now, o.lastActivityAt),
    tokensInputDelta: input, tokensOutputDelta: output, usage };
}

/**
 * QA fix (R3): the usage of a `late` observation - tokens read this poll from records
 * whose activity is no longer fresh. Same per-entry projection as a live one; nothing
 * about it (tool, model, project) ever reaches presence or selection.
 */
function projectLateUsage(o: Observation, now: number): DetectionUsage[] | null {
  if (!o || o.late !== true || !isSupportedTool(o.tool) || o.confidence !== "activity" || o.cwd !== null ||
      !Number.isSafeInteger(o.lastActivityAt) || o.lastActivityAt < now - MAX_RECORD_AGE_MS ||
      o.lastActivityAt > now + MAX_FUTURE_SKEW_MS || !Array.isArray(o.usage) || o.usage.length > MAX_USAGE_ENTRIES) return null;
  const usage: DetectionUsage[] = [];
  for (const entry of o.usage) {
    const u = projectUsage({ tool: o.tool, model: entry?.model, tokensInputDelta: entry?.tokensInputDelta,
      tokensOutputDelta: entry?.tokensOutputDelta, tokensCacheReadDelta: entry?.tokensCacheReadDelta,
      tokensCacheWriteDelta: entry?.tokensCacheWriteDelta, estimated: entry?.estimated });
    if (!u) return null;
    if (hasUsage(u)) usage.push(u);
  }
  return usage;
}

/** Adds `u` into `into` keyed by (tool, model); false when a bound would be exceeded. */
export function mergeUsage(into: Map<string, DetectionUsage>, u: DetectionUsage): boolean {
  const key = usageKey(u.tool, u.model);
  const previous = into.get(key);
  if (!previous && into.size >= MAX_USAGE_ENTRIES) return false;
  const merged: DetectionUsage = { tool: u.tool, model: u.model,
    tokensInputDelta: (previous?.tokensInputDelta ?? 0) + u.tokensInputDelta,
    tokensOutputDelta: (previous?.tokensOutputDelta ?? 0) + u.tokensOutputDelta };
  const cacheRead = (previous?.tokensCacheReadDelta ?? 0) + (u.tokensCacheReadDelta ?? 0);
  const cacheWrite = (previous?.tokensCacheWriteDelta ?? 0) + (u.tokensCacheWriteDelta ?? 0);
  if (!isCount(merged.tokensInputDelta) || !isCount(merged.tokensOutputDelta) || !isCount(cacheRead) || !isCount(cacheWrite)) return false;
  if (cacheRead) merged.tokensCacheReadDelta = cacheRead;
  if (cacheWrite) merged.tokensCacheWriteDelta = cacheWrite;
  into.set(key, merged);
  return true;
}

/** Only fresh, supported AI usage evidence. There is no editor/process fallback. */
export class Detector {
  private adapters: Adapter[];
  /**
   * Which tool ids each adapter is permitted to speak for.
   *
   * Round 4 tightened this from a category rule to an exact one. `quadcode` is now
   * both natively collected and receiver-eligible, so "is it a native tool" no longer
   * distinguishes anything: a category check would have let the Claude adapter speak
   * for Quadcode. Each log adapter may therefore emit ONLY its own `name`, and the
   * receiver only `ATTESTED_TOOLS`. The default for an adapter injected later
   * (fixtures, tests) is the same exact-name rule, which is strictly narrower than
   * the category default it replaces.
   */
  private readonly origin = new WeakMap<Adapter, (tool: unknown) => boolean>();
  private cancellation: AbortController | null = null;
  private generation = 0;
  /** Usage from `late` observations, drained by the loop (takeLateUsage). */
  private late = new Map<string, DetectionUsage>();
  private activeWindowMs: number;

  constructor(activeWindowMs: number, private adapterTimeoutMs = ADAPTER_POLL_TIMEOUT_MS, attestedTools: readonly string[] = []) {
    this.activeWindowMs = Math.min(Math.max(1, activeWindowMs), MAX_EVENT_AGE_MS);
    this.adapters = [new ClaudeCodeAdapter(this.activeWindowMs), new CodexAdapter(this.activeWindowMs),
      new QuadcodeAdapter(this.activeWindowMs)];
    for (const adapter of this.adapters) this.origin.set(adapter, (tool) => tool === adapter.name);
    // Built ONLY when the user opted in. With the switch off the receiver does not
    // exist, so its inbox is never opened and the v1 guarantee is unchanged. It stays
    // separate from the native Quadcode adapter above: that one reports activity and
    // model, this one is the only path by which a measured claim could ever arrive.
    const accepted = attestedTools.filter(isAttestedTool);
    if (accepted.length) {
      const receiver = new AttestedMetadataAdapter(this.activeWindowMs, accepted);
      this.origin.set(receiver, isAttestedTool);
      this.adapters.push(receiver);
    }
  }

  /** Hands over (and forgets) the usage booked from late observations. */
  takeLateUsage(): DetectionUsage[] {
    const out = [...this.late.values()];
    this.late.clear();
    return out;
  }

  clear(): void {
    this.generation += 1;
    this.late.clear();
    this.cancellation?.abort();
    for (const adapter of this.adapters) adapter.clear?.();
  }

  async detect(
    now = Date.now(), current?: CurrentSession, allowed: (observation: Observation) => boolean = () => true, signal?: AbortSignal
  ): Promise<Detection | null> {
    const generation = this.generation;
    const controller = new AbortController();
    this.cancellation?.abort();
    this.cancellation = controller;
    const cancel = (): void => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const adapters = [...this.adapters];
    let results: Observation[][];
    try {
      results = await Promise.all(adapters.map((a) => pollAdapter(a, this.adapterTimeoutMs, now, controller.signal)));
    } finally { signal?.removeEventListener("abort", cancel); }
    if (controller.signal.aborted || generation !== this.generation) return null;
    // An adapter may only speak for the tool ids it owns. This runs BEFORE projection
    // so an out-of-origin id cannot reach tokens, the source list or selection even
    // if it would otherwise have been well-formed.
    const owned = results.flatMap((list, index) => {
      const adapter = adapters[index];
      const mayEmit = this.origin.get(adapter) ?? ((tool: unknown) => tool === adapter.name);
      return list.filter((o) => mayEmit(o?.tool));
    });
    // Late observations carry tokens only. Hidden projects are filtered the same way.
    for (const o of owned) {
      if (o?.late !== true || !allowed(o)) continue;
      for (const u of projectLateUsage(o, now) ?? []) mergeUsage(this.late, u);
    }
    // Hidden sources are removed BEFORE tokens, source lists or selection are built.
    const all = owned.filter((o) => o?.late !== true).map((o) => projectObservation(o, now, this.activeWindowMs))
      .filter((o): o is Observation => o !== null).filter(allowed);
    if (!all.length) return null;
    const usage = new Map<string, DetectionUsage>();
    let input = 0;
    let output = 0;
    for (const o of all) for (const u of o.usage) {
      if (!hasUsage(u) || !isCount(input + u.tokensInputDelta) || !isCount(output + u.tokensOutputDelta) ||
          !mergeUsage(usage, { ...u, tool: o.tool })) continue;
      input += u.tokensInputDelta; output += u.tokensOutputDelta;
    }
    const seen = new Map<string, SeenSource>();
    for (const o of all) {
      for (const model of new Set([o.model, ...o.usage.map((u) => u.model)])) {
        const key = usageKey(o.tool, model);
        if (!seen.has(key) || seen.get(key)!.lastSeenAt < o.lastActivityAt) {
          seen.set(key, { tool: o.tool, model, lastSeenAt: o.lastActivityAt, cwd: null, projectHint: o.projectHint });
        }
      }
    }
    let pick: Observation | null = null;
    if (current && !all.some((o) => o.tool !== current.tool && hasTokens(o))) {
      const same = all.filter((o) => o.tool === current.tool);
      const inProject = same.filter((o) => o.projectHint === current.projectHint);
      pick = newest(inProject.filter(hasTokens)) ?? newest(same.filter(hasTokens)) ?? newest(inProject) ?? newest(same);
    }
    pick ??= newest(all.filter(hasTokens)) ?? newest(all);
    if (!pick) return null;
    return { tool: pick.tool, model: pick.model, cwd: null, projectHint: pick.projectHint, active: true,
      lastActivityAt: pick.lastActivityAt, tokensInputDelta: input, tokensOutputDelta: output,
      usage: [...usage.values()], seen: [...seen.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, MAX_USAGE_ENTRIES) };
  }
}
