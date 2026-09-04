import { ClaudeCodeAdapter } from "./adapters/claudeCode";
import { CodexAdapter } from "./adapters/codex";
import { ProcessAdapter } from "./adapters/processes";
import type { Adapter, Observation } from "./adapters/types";

/** Token deltas for one (tool, model) pair, merged across every observation this poll. */
export interface DetectionUsage {
  tool: string;
  model: string | null;
  tokensInputDelta: number;
  tokensOutputDelta: number;
}

/** A (tool, model) pair that exists right now or produced evidence recently. */
export interface SeenSource {
  tool: string;
  model: string | null;
  lastSeenAt: number;
}

/** What the heartbeat loop is currently reporting — input to the hysteresis rule. */
export interface CurrentSession {
  tool: string;
  cwd: string | null;
  projectHint: string | null;
}

export interface Detection {
  tool: string;
  model: string | null;
  cwd: string | null;
  projectHint: string | null;
  /** True = timestamped evidence of work within the active window. */
  active: boolean;
  lastActivityAt: number;
  /** Legacy: sums across *all* observations (old servers only read these). */
  tokensInputDelta: number;
  tokensOutputDelta: number;
  /** Precise attribution: same tokens split per (tool, model). Nonzero entries only. */
  usage: DetectionUsage[];
  /** Every (tool, model) pair observed this poll, for `status.json`'s `sources`. */
  seen: SeenSource[];
}

/** Tools whose `activity`-confidence observations can only come from a log adapter. */
const LOG_BACKED_TOOLS = new Set(["claude-code", "codex"]);

const hasTokens = (o: Observation): boolean => o.tokensInputDelta > 0 || o.tokensOutputDelta > 0;

/**
 * Log-backed = the observation proves *work*, not just an open window: it names
 * a model, it carried tokens, or it comes from a tool only a log adapter reports
 * as active (the process adapter marks `claude`/`codex` presence-only).
 */
const isLogBacked = (o: Observation): boolean => o.model !== null || hasTokens(o) || LOG_BACKED_TOOLS.has(o.tool);

const newest = (list: Observation[]): Observation | null =>
  list.reduce<Observation | null>((best, o) => (!best || o.lastActivityAt > best.lastActivityAt ? o : best), null);

const usageKey = (tool: string, model: string | null): string => `${tool}\u0000${model ?? ""}`;

/**
 * Merges every adapter's observations into one answer per poll.
 *
 * Tokens: every observation's per-model deltas are merged by (tool, model) into
 * `usage` — several sessions may burn tokens at once and every one counts, but
 * each is booked under the tool/model that actually produced it, never under
 * whichever window happened to be "current". `tokensInputDelta`/`OutputDelta`
 * are the plain sums, kept for servers that predate `usage`.
 *
 * Presence (which single activity the user is "in"), in order:
 *  1. Candidates are observations with `activity` confidence whose
 *     `lastActivityAt` is inside `activeWindowMs`. Presence-only observations
 *     (editor open, static title; `claude`/`codex` processes) never qualify.
 *  2. Hysteresis: if the caller's current session tool is still among the
 *     candidates, keep that tool unless a candidate of *another* tool burned
 *     tokens this poll. Within the same tool, prefer the observation for the
 *     current project (cwd / projectHint), then one with tokens, then newest.
 *     This stops Claude Code inside Cursor's terminal from flipping
 *     claude-code ↔ cursor every poll: a window-title change only proves the
 *     window changed, a log line proves work.
 *  3. Otherwise prefer log-backed candidates over process-only ones — those
 *     with tokens this poll first, then newest — and fall back to the newest
 *     process-only candidate.
 *  4. No candidate at all: the newest observation of any kind, reported as
 *     `active: false` (editor open, nothing happening) so the loop can go idle.
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

  async detect(now = Date.now(), current?: CurrentSession): Promise<Detection | null> {
    const results = await Promise.all(this.adapters.map((a) => a.poll().catch(() => [] as Observation[])));
    const all = results.flat();
    if (all.length === 0) return null;

    // --- token attribution -------------------------------------------------
    const usage = new Map<string, DetectionUsage>();
    let tokensIn = 0;
    let tokensOut = 0;
    for (const o of all) {
      tokensIn += o.tokensInputDelta;
      tokensOut += o.tokensOutputDelta;
      for (const u of o.usage) {
        if (u.tokensInputDelta <= 0 && u.tokensOutputDelta <= 0) continue;
        const key = usageKey(o.tool, u.model);
        const bucket = usage.get(key) ?? { tool: o.tool, model: u.model, tokensInputDelta: 0, tokensOutputDelta: 0 };
        bucket.tokensInputDelta += u.tokensInputDelta;
        bucket.tokensOutputDelta += u.tokensOutputDelta;
        usage.set(key, bucket);
      }
    }

    // --- sources seen (for `vibehub-tracker status`) -----------------------
    const seen = new Map<string, SeenSource>();
    const note = (tool: string, model: string | null, at: number) => {
      const key = usageKey(tool, model);
      const prev = seen.get(key);
      if (!prev || at > prev.lastSeenAt) seen.set(key, { tool, model, lastSeenAt: at });
    };
    for (const o of all) {
      note(o.tool, o.model, Math.max(o.lastActivityAt, o.observedAt ?? 0, hasTokens(o) ? now : 0));
      for (const u of o.usage) if (u.model !== o.model) note(o.tool, u.model, now);
    }

    // --- presence selection ------------------------------------------------
    const fresh = (o: Observation) => now - o.lastActivityAt <= this.activeWindowMs;
    const candidates = all.filter((o) => o.confidence === "activity" && fresh(o));

    let pick: Observation | null = null;

    if (current) {
      const same = candidates.filter((c) => c.tool === current.tool);
      const anotherToolBurned = candidates.some((c) => c.tool !== current.tool && hasTokens(c));
      if (same.length > 0 && !anotherToolBurned) pick = bestForCurrent(same, current);
    }

    if (!pick) {
      const logBacked = candidates.filter(isLogBacked);
      pick = newest(logBacked.filter(hasTokens)) ?? newest(logBacked) ?? newest(candidates);
    }

    const active = pick !== null;
    if (!pick) pick = newest(all);
    if (!pick) return null;

    return {
      tool: pick.tool,
      model: pick.model,
      cwd: pick.cwd,
      projectHint: pick.projectHint,
      active,
      lastActivityAt: pick.lastActivityAt,
      tokensInputDelta: tokensIn,
      tokensOutputDelta: tokensOut,
      usage: [...usage.values()],
      seen: [...seen.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    };
  }
}

/** Same tool as the current session: current project > tokens this poll > newest. */
function bestForCurrent(same: Observation[], current: CurrentSession): Observation | null {
  const sameProject = (o: Observation): boolean =>
    current.cwd !== null
      ? o.cwd === current.cwd
      : o.cwd === null && current.projectHint !== null && o.projectHint === current.projectHint;

  const inProject = same.filter(sameProject);
  return (
    newest(inProject.filter(hasTokens)) ??
    newest(same.filter(hasTokens)) ??
    newest(inProject) ??
    newest(same)
  );
}
