// Shared types for the tracker. Mirrors docs/ARCHITECTURE.md §2.13, §4.1, §4.3, §4.4.

export interface TrackerConfig {
  apiUrl: string;
  deviceToken: string;
  /** folder basename -> user alias, or the literal "hidden" */
  projectAliases: Record<string, string>;
  heartbeatIntervalMs?: number;
  idleThresholdMs?: number;
  /** Process names to watch for, e.g. ["claude", "cursor", "code"]. */
  toolProcessNames?: string[];
}

export type PresenceStatus = "active" | "idle" | "offline";

/** One (tool, model) pair the daemon has seen recently — see `StatusFile.sources`. */
export interface StatusSource {
  tool: string;
  model: string | null;
  lastSeenAt: string;
}

export interface StatusFile {
  status: PresenceStatus;
  projectAlias: string | null;
  tool: string | null;
  model: string | null;
  sessionStartedAt: string | null;
  updatedAt: string;
  /**
   * Round 5: set when the server has rejected the configured device token with a
   * 401 (bad/revoked) — as opposed to a transient network/5xx failure, which
   * doesn't set this. `vibehub-tracker status` surfaces it directly instead of
   * the daemon queuing rejected heartbeats forever with no visible symptom.
   */
  authRejected?: boolean;
  /**
   * Every tool/model the daemon has seen in the last 10 minutes (open editors,
   * log files with recent lines), most recent first — the "Seeing:" line of
   * `vibehub-tracker status`, so a wrong model in the profile can be traced to
   * what the tracker actually observed. Additive; older readers ignore it.
   */
  sources?: StatusSource[];
}

export type HeartbeatEventType =
  | "heartbeat"
  | "session_start"
  | "session_end"
  | "git_commit";

/** Per-source token attribution carried by heartbeat v2 (see tracker/README.md). */
export interface HeartbeatUsage {
  tool: string;
  /** null = tokens whose model is unknowable ("<synthetic>" lines, presence-only tools). */
  model: string | null;
  tokensInputDelta: number;
  tokensOutputDelta: number;
}

export interface HeartbeatPayload {
  eventType: HeartbeatEventType;
  projectAlias: string;
  tool: string;
  /**
   * The AI model in use when it's knowable (log-backed tools: Claude Code, Codex),
   * `null` otherwise (presence-only tools: Cursor, Quadcode, Grok, ChatGPT app). The
   * tool is always sent; only the model degrades to null.
   */
  model: string | null;
  /** Legacy sums over `usage` — still sent so servers without v2 keep counting. */
  tokensInputDelta?: number;
  tokensOutputDelta?: number;
  /**
   * Heartbeat v2: precise per-(tool, model) deltas since the previous heartbeat,
   * nonzero entries only. When present the server books stats from this and
   * ignores the top-level sums (no double count). Only on `"heartbeat"` events.
   */
  usage?: HeartbeatUsage[];
  occurredAt: string;
}

/** One entry in the offline queue — a heartbeat payload plus its auth context. */
export interface QueuedEvent {
  payload: HeartbeatPayload;
  apiUrl: string;
  deviceToken: string;
}
