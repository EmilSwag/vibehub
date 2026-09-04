import type { UsageDelta } from "./types";

/**
 * Model ids that must never be reported as "the model": Claude Code writes
 * `"<synthetic>"` for locally generated assistant lines (aborts, tool-result
 * stubs), and older logs / other tools sometimes write "" or "unknown". Tokens
 * on such lines are still real spend, so they are bucketed under `null` rather
 * than dropped. Matches the server's own normalisation (see the heartbeat v2
 * contract in ../../README.md).
 */
export function normalizeModel(model: string | null | undefined): string | null {
  if (typeof model !== "string") return null;
  const m = model.trim();
  if (!m || m === "<synthetic>" || m.toLowerCase() === "unknown") return null;
  return m;
}

/** Accumulates per-model token deltas; `toList()` returns only nonzero buckets. */
export class UsageAccumulator {
  private buckets = new Map<string, UsageDelta>();

  add(model: string | null, tokensInputDelta: number, tokensOutputDelta: number): void {
    const key = model ?? "";
    const b = this.buckets.get(key) ?? { model, tokensInputDelta: 0, tokensOutputDelta: 0 };
    b.tokensInputDelta += tokensInputDelta;
    b.tokensOutputDelta += tokensOutputDelta;
    this.buckets.set(key, b);
  }

  toList(): UsageDelta[] {
    return [...this.buckets.values()].filter((u) => u.tokensInputDelta > 0 || u.tokensOutputDelta > 0);
  }

  get totalInput(): number {
    let n = 0;
    for (const u of this.buckets.values()) n += u.tokensInputDelta;
    return n;
  }

  get totalOutput(): number {
    let n = 0;
    for (const u of this.buckets.values()) n += u.tokensOutputDelta;
    return n;
  }
}

/** Non-negative integer, or 0 for anything malformed (server rejects negatives/floats). */
export function asCount(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
