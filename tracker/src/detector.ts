import { ClaudeCodeAdapter } from "./adapters/claudeCode";
import { CodexAdapter } from "./adapters/codex";
import { ProcessAdapter } from "./adapters/processes";
import type { Adapter, Observation } from "./adapters/types";

export interface Detection {
  tool: string;
  model: string | null;
  cwd: string | null;
  projectHint: string | null;
  /** True = timestamped evidence of work within the active window. */
  active: boolean;
  lastActivityAt: number;
  tokensInputDelta: number;
  tokensOutputDelta: number;
}

/**
 * Merges every adapter's observations into one answer per poll:
 *  1. Sum token deltas across *all* observations (several sessions may burn
 *     tokens at once — every one counts toward the user's totals).
 *  2. The "current activity" is the freshest `activity`-confidence observation
 *     inside `activeWindowMs`; if none, the freshest presence observation
 *     (editor open, nothing happening) reported as not active.
 */
export class Detector {
  private adapters: Adapter[];

  constructor(private activeWindowMs: number) {
    this.adapters = [
      new ClaudeCodeAdapter(activeWindowMs * 6), // scan a wider window so idle sessions still resolve
      new CodexAdapter(activeWindowMs * 6),
      new ProcessAdapter(activeWindowMs),
    ];
  }

  async detect(now = Date.now()): Promise<Detection | null> {
    const results = await Promise.all(this.adapters.map((a) => a.poll().catch(() => [] as Observation[])));
    const all = results.flat();
    if (all.length === 0) return null;

    let tokensIn = 0;
    let tokensOut = 0;
    for (const o of all) {
      tokensIn += o.tokensInputDelta;
      tokensOut += o.tokensOutputDelta;
    }

    const fresh = (o: Observation) => now - o.lastActivityAt <= this.activeWindowMs;
    const newest = (list: Observation[]) =>
      list.reduce<Observation | null>((best, o) => (!best || o.lastActivityAt > best.lastActivityAt ? o : best), null);

    const active = newest(all.filter((o) => o.confidence === "activity" && fresh(o)));
    const pick = active ?? newest(all);
    if (!pick) return null;

    return {
      tool: pick.tool,
      model: pick.model,
      cwd: pick.cwd,
      projectHint: pick.projectHint,
      active: active !== null,
      lastActivityAt: pick.lastActivityAt,
      tokensInputDelta: tokensIn,
      tokensOutputDelta: tokensOut,
    };
  }
}
