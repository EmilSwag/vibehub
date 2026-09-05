/**
 * Every activity source (log tailers, process scanners) reports the same shape.
 * The detector merges them: log adapters win because they know *what* happened
 * (model, tokens, cwd); process adapters only know something is *open*.
 */

/** Token deltas for one model inside one observation (a Claude file can hold several). */
export interface UsageDelta {
  /** Normalised model id, or null when the tokens can't be attributed ("<synthetic>", empty). */
  model: string | null;
  tokensInputDelta: number;
  tokensOutputDelta: number;
  /**
   * True when the counts are derived rather than reported by the tool. Quadcode
   * logs carry no token numbers at all, so its adapter estimates from character
   * counts. Never present an estimate as measured: the UI and `tracker status`
   * must say "est." wherever these land (round 6 contract).
   */
  estimated?: boolean;
}

export interface Observation {
  tool: string;
  /** Absolute project path if known (log adapters), else null. */
  cwd: string | null;
  /** Human project label when cwd is unknown (window title parsing). */
  projectHint: string | null;
  /** Model of the most recent *real* assistant message (never "<synthetic>"/empty). */
  model: string | null;
  /** Epoch ms of the most recent evidence of activity. */
  lastActivityAt: number;
  /**
   * Epoch ms when this source was last confirmed to exist at all (process still
   * running, log file still present). Defaults to `lastActivityAt` when absent;
   * the process adapter sets it to "now" so an open-but-idle editor still shows
   * up in `status.json`'s `sources` list.
   */
  observedAt?: number;
  /** Tokens observed since the previous poll (already de-duplicated), summed over all models. */
  tokensInputDelta: number;
  tokensOutputDelta: number;
  /** Same tokens, split per model — this is what the server uses for stats. */
  usage: UsageDelta[];
  /** `activity` = precise timestamped evidence; `presence` = the app is merely running. */
  confidence: "activity" | "presence";
}

export interface Adapter {
  name: string;
  /** Return every observation since the last poll. Must never throw. */
  poll(): Promise<Observation[]>;
}
