import { ClaudeCodeAdapter } from "./adapters/claudeCode";
import { CodexAdapter } from "./adapters/codex";
import { ProcessAdapter } from "./adapters/processes";
import { QuadcodeAdapter } from "./adapters/quadcode";
import type { Adapter, Observation } from "./adapters/types";

/** Token deltas for one (tool, model) pair, merged across every observation this poll. */
export interface DetectionUsage {
  tool: string;
  model: string | null;
  tokensInputDelta: number;
  tokensOutputDelta: number;
  /** True when any contribution to this bucket was estimated rather than measured. */
  estimated?: boolean;
}

/** A (tool, model) pair that exists right now or produced evidence recently. */
export interface SeenSource {
  tool: string;
  model: string | null;
  lastSeenAt: number;
  /**
   * Where that source was seen, so the heartbeat can resolve a project alias per
   * tool for the round 6 `tools[]` list (same inputs `resolveProjectAlias` takes
   * for the primary). Kept in memory only — a cwd is a full path and never leaves
   * the machine (privacy invariant, index.ts header).
   */
  cwd?: string | null;
  projectHint?: string | null;
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

/**
 * Tools whose `activity`-confidence observations can only come from a log adapter.
 * Safe to list a tool the process adapter also reports: presence-only observations
 * are filtered out before `isLogBacked` is ever consulted. Quadcode is here so a
 * chat append still outranks a bare window-title candidate when the log has not
 * named a model yet (a brand-new chat).
 */
const LOG_BACKED_TOOLS = new Set(["claude-code", "codex", "quadcode"]);

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
      // Quadcode appends only at turn boundaries and a single turn can run for hours,
      // so its logs are scanned over a much wider window than the others. Stale files
      // never become presence candidates (that still needs activity inside
      // activeWindowMs) — they exist so the tool keeps its model and project while its
      // own log is silent mid-turn. See identityFor below.
      new QuadcodeAdapter(activeWindowMs * 72),
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
        if (u.estimated) bucket.estimated = true;
        usage.set(key, bucket);
      }
    }

    // --- sources seen (for `vibehub-tracker status`) -----------------------
    const seen = new Map<string, SeenSource>();
    const note = (
      tool: string,
      model: string | null,
      at: number,
      where?: { cwd: string | null; projectHint: string | null }
    ) => {
      const key = usageKey(tool, model);
      const prev = seen.get(key);
      if (!prev || at > prev.lastSeenAt) {
        seen.set(key, { tool, model, lastSeenAt: at, cwd: where?.cwd ?? prev?.cwd, projectHint: where?.projectHint ?? prev?.projectHint });
      }
    };
    const sightingOf = (o: Observation) => Math.max(o.lastActivityAt, o.observedAt ?? 0, hasTokens(o) ? now : 0);
    for (const o of all) {
      const where = { cwd: o.cwd, projectHint: o.projectHint };
      note(o.tool, o.model, sightingOf(o), where);
      for (const u of o.usage) if (u.model !== o.model) note(o.tool, u.model, now, where);
    }

    // A tool can be plainly open while its own log is silent — Quadcode appends only
    // at turn boundaries, so a multi-hour turn writes nothing and the only *fresh*
    // sighting is the process one, which knows no model and no project. Left alone,
    // the tool's model and project age out of `sources` (and therefore out of the
    // heartbeat's tools[] and the `status` "Seeing:" line) while the user is still
    // sitting in it.
    //
    // So for each tool whose freshest sighting lacks a model, re-note its best-known
    // identity at *that sighting's* time. The timestamp is when the tool was last seen,
    // not when the model line was written — which is exactly what "this tool is open,
    // and this is what it is" should mean.
    const freshestByTool = new Map<string, Observation>();
    for (const o of all) {
      const prev = freshestByTool.get(o.tool);
      if (!prev || sightingOf(o) > sightingOf(prev)) freshestByTool.set(o.tool, o);
    }
    for (const [tool, freshest] of freshestByTool) {
      if (freshest.model !== null) continue;
      const identity = identityFor(freshest, all);
      if (identity.model === null) continue;
      note(tool, identity.model, sightingOf(freshest), { cwd: identity.cwd, projectHint: identity.projectHint });
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

    // A tool's *process* is visible continuously, but its *log* only speaks in bursts:
    // Quadcode appends a record at turn boundaries, so a long turn writes nothing for
    // minutes while the window stays open. When the process observation wins in that
    // gap it knows the tool is open but neither the model nor the project, and presence
    // would drop to "Quadcode AI, unknown project, no model" mid-turn.
    //
    // So fill only what the pick is missing from the freshest other observation of the
    // SAME tool. This never overrides an established value and never crosses tools —
    // it just stops a tool's identity flickering away between its own log writes.
    const identity = identityFor(pick, all);

    return {
      tool: pick.tool,
      model: identity.model,
      cwd: identity.cwd,
      projectHint: identity.projectHint,
      active,
      lastActivityAt: pick.lastActivityAt,
      tokensInputDelta: tokensIn,
      tokensOutputDelta: tokensOut,
      usage: [...usage.values()],
      seen: [...seen.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    };
  }
}

/**
 * The best-known identity for the picked observation's tool: its own values, with any
 * null filled from the freshest *other* observation of the same tool that does know
 * it. Fills only nulls, so a log adapter that named a model and project keeps them
 * even when a process observation happens to be the freshest evidence this poll.
 */
function identityFor(
  pick: Observation,
  all: Observation[]
): { model: string | null; cwd: string | null; projectHint: string | null } {
  const identity = { model: pick.model, cwd: pick.cwd, projectHint: pick.projectHint };
  if (identity.model !== null && identity.cwd !== null) return identity;

  const sameTool = all
    .filter((o) => o !== pick && o.tool === pick.tool)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  for (const o of sameTool) {
    if (identity.model === null && o.model !== null) identity.model = o.model;
    if (identity.cwd === null && o.cwd !== null) {
      identity.cwd = o.cwd;
      // cwd wins over a window-title hint, so drop a hint that would now be ignored.
      identity.projectHint = null;
    }
    if (identity.model !== null && identity.cwd !== null) break;
  }
  if (identity.projectHint === null && identity.cwd === null) {
    const hinted = sameTool.find((o) => o.projectHint !== null);
    if (hinted) identity.projectHint = hinted.projectHint;
  }
  return identity;
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
