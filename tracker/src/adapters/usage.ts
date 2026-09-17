import { countOrZero, isCount, MAX_USAGE_ENTRIES, safeModel } from "../privacy";
import type { UsageDelta } from "./types";

/** Unknown and synthetic model IDs stay unknown; no trimming or family inference. */
export function normalizeModel(model: unknown): string | null { return safeModel(model); }

/** Measured, bounded counts only. No content-derived estimates or malformed values. */
export class UsageAccumulator {
  private buckets = new Map<string, UsageDelta>();

  add(model: string | null, input: number, output: number, estimated = false): boolean {
    if (estimated || !isCount(input) || !isCount(output) ||
        !isCount(this.totalInput + input) || !isCount(this.totalOutput + output)) return false;
    const knownModel = safeModel(model);
    const key = knownModel ?? "";
    if (!this.buckets.has(key) && this.buckets.size >= MAX_USAGE_ENTRIES) return false;
    const previous = this.buckets.get(key);
    this.buckets.set(key, {
      model: knownModel,
      tokensInputDelta: (previous?.tokensInputDelta ?? 0) + input,
      tokensOutputDelta: (previous?.tokensOutputDelta ?? 0) + output,
    });
    return true;
  }

  toList(): UsageDelta[] {
    return [...this.buckets.values()].filter((u) => u.tokensInputDelta > 0 || u.tokensOutputDelta > 0)
      .map((u) => ({ model: u.model, tokensInputDelta: u.tokensInputDelta, tokensOutputDelta: u.tokensOutputDelta }));
  }
  get totalInput(): number { return [...this.buckets.values()].reduce((n, u) => n + u.tokensInputDelta, 0); }
  get totalOutput(): number { return [...this.buckets.values()].reduce((n, u) => n + u.tokensOutputDelta, 0); }
}

export function asCount(value: unknown): number { return countOrZero(value); }
