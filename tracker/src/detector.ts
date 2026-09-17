import { ClaudeCodeAdapter } from "./adapters/claudeCode";
import { CodexAdapter } from "./adapters/codex";
import { MAX_LOG_FILES } from "./adapters/jsonlTail";
import type { Adapter, Observation } from "./adapters/types";
import { isCount, isSupportedTool, MAX_EVENT_AGE_MS, MAX_FUTURE_SKEW_MS, MAX_USAGE_ENTRIES, projectUsage, safeAlias, safeModel } from "./privacy";

export interface DetectionUsage { tool: string; model: string | null; tokensInputDelta: number; tokensOutputDelta: number; estimated?: boolean }
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
const hasTokens = (o: Observation): boolean => o.tokensInputDelta > 0 || o.tokensOutputDelta > 0;
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
      tokensOutputDelta: entry?.tokensOutputDelta, estimated: entry?.estimated });
    if (!u) return null;
    usage.push({ model: u.model, tokensInputDelta: u.tokensInputDelta, tokensOutputDelta: u.tokensOutputDelta });
  }
  const input = usage.reduce((n, u) => n + u.tokensInputDelta, 0);
  const output = usage.reduce((n, u) => n + u.tokensOutputDelta, 0);
  if (!isCount(input) || !isCount(output) || input !== o.tokensInputDelta || output !== o.tokensOutputDelta) return null;
  return { tool: o.tool, model: safeModel(o.model, o.tool), cwd: null, projectHint: safeAlias(o.projectHint),
    confidence: "activity", lastActivityAt: Math.min(now, o.lastActivityAt), observedAt: Math.min(now, o.lastActivityAt),
    tokensInputDelta: input, tokensOutputDelta: output, usage };
}

/** Only fresh, supported AI usage evidence. There is no editor/process fallback. */
export class Detector {
  private adapters: Adapter[];
  private cancellation: AbortController | null = null;
  private generation = 0;
  private activeWindowMs: number;

  constructor(activeWindowMs: number, private adapterTimeoutMs = ADAPTER_POLL_TIMEOUT_MS) {
    this.activeWindowMs = Math.min(Math.max(1, activeWindowMs), MAX_EVENT_AGE_MS);
    this.adapters = [new ClaudeCodeAdapter(this.activeWindowMs), new CodexAdapter(this.activeWindowMs)];
  }

  clear(): void {
    this.generation += 1;
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
    let results: Observation[][];
    try {
      results = await Promise.all(this.adapters.map((a) => pollAdapter(a, this.adapterTimeoutMs, now, controller.signal)));
    } finally { signal?.removeEventListener("abort", cancel); }
    if (controller.signal.aborted || generation !== this.generation) return null;
    // Hidden sources are removed BEFORE tokens, source lists or selection are built.
    const all = results.flat().map((o) => projectObservation(o, now, this.activeWindowMs))
      .filter((o): o is Observation => o !== null).filter(allowed);
    if (!all.length) return null;
    const usage = new Map<string, DetectionUsage>();
    let input = 0;
    let output = 0;
    for (const o of all) for (const u of o.usage) {
      if (!(u.tokensInputDelta || u.tokensOutputDelta)) continue;
      const key = usageKey(o.tool, u.model);
      if ((!usage.has(key) && usage.size >= MAX_USAGE_ENTRIES) ||
          !isCount(input + u.tokensInputDelta) || !isCount(output + u.tokensOutputDelta)) continue;
      const previous = usage.get(key);
      usage.set(key, { tool: o.tool, model: u.model,
        tokensInputDelta: (previous?.tokensInputDelta ?? 0) + u.tokensInputDelta,
        tokensOutputDelta: (previous?.tokensOutputDelta ?? 0) + u.tokensOutputDelta });
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
