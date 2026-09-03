/**
 * Every activity source (log tailers, process scanners) reports the same shape.
 * The detector merges them: log adapters win because they know *what* happened
 * (model, tokens, cwd); process adapters only know something is *open*.
 */
export interface Observation {
  tool: string;
  /** Absolute project path if known (log adapters), else null. */
  cwd: string | null;
  /** Human project label when cwd is unknown (window title parsing). */
  projectHint: string | null;
  model: string | null;
  /** Epoch ms of the most recent evidence of activity. */
  lastActivityAt: number;
  /** Tokens observed since the previous poll (already de-duplicated). */
  tokensInputDelta: number;
  tokensOutputDelta: number;
  /** `activity` = precise timestamped evidence; `presence` = the app is merely running. */
  confidence: "activity" | "presence";
}

export interface Adapter {
  name: string;
  /** Return every observation since the last poll. Must never throw. */
  poll(): Promise<Observation[]>;
}
