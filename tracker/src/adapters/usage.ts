import { countOrZero, hasUsage, isCount, MAX_USAGE_ENTRIES, safeModel } from "../privacy";
import type { UsageDelta } from "./types";

/** Unknown and synthetic model IDs stay unknown; no trimming or family inference. */
export function normalizeModel(model: unknown): string | null { return safeModel(model); }

/**
 * One measured delta. `input` is FRESH input (it includes cache writes, which are billed
 * input); `cacheRead` is re-used context and is NOT part of `input`; `cacheWrite` is the
 * part of `input` that was written to the cache, carried only for pricing.
 */
export interface MeasuredDelta { input: number; output: number; cacheRead?: number; cacheWrite?: number }

/** Measured, bounded counts only. No content-derived estimates or malformed values. */
export class UsageAccumulator {
  private buckets = new Map<string, Required<Omit<UsageDelta, "estimated">>>();

  add(model: string | null, input: number, output: number, estimated = false, cache: { cacheRead?: number; cacheWrite?: number } = {}): boolean {
    const cacheRead = cache.cacheRead ?? 0;
    const cacheWrite = cache.cacheWrite ?? 0;
    if (estimated || !isCount(input) || !isCount(output) || !isCount(cacheRead) || !isCount(cacheWrite) ||
        cacheWrite > input || !isCount(this.totalInput + input) || !isCount(this.totalOutput + output) ||
        !isCount(this.totalCacheRead + cacheRead)) return false;
    const knownModel = safeModel(model);
    const key = knownModel ?? "";
    if (!this.buckets.has(key) && this.buckets.size >= MAX_USAGE_ENTRIES) return false;
    const previous = this.buckets.get(key);
    this.buckets.set(key, {
      model: knownModel,
      tokensInputDelta: (previous?.tokensInputDelta ?? 0) + input,
      tokensOutputDelta: (previous?.tokensOutputDelta ?? 0) + output,
      tokensCacheReadDelta: (previous?.tokensCacheReadDelta ?? 0) + cacheRead,
      tokensCacheWriteDelta: (previous?.tokensCacheWriteDelta ?? 0) + cacheWrite,
    });
    return true;
  }

  toList(): UsageDelta[] {
    return [...this.buckets.values()].filter(hasUsage).map((u) => ({
      model: u.model, tokensInputDelta: u.tokensInputDelta, tokensOutputDelta: u.tokensOutputDelta,
      ...(u.tokensCacheReadDelta ? { tokensCacheReadDelta: u.tokensCacheReadDelta } : {}),
      ...(u.tokensCacheWriteDelta ? { tokensCacheWriteDelta: u.tokensCacheWriteDelta } : {}),
    }));
  }
  get totalInput(): number { return [...this.buckets.values()].reduce((n, u) => n + u.tokensInputDelta, 0); }
  get totalOutput(): number { return [...this.buckets.values()].reduce((n, u) => n + u.tokensOutputDelta, 0); }
  get totalCacheRead(): number { return [...this.buckets.values()].reduce((n, u) => n + u.tokensCacheReadDelta, 0); }
}

export function asCount(value: unknown): number { return countOrZero(value); }
