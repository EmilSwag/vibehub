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
}

export type HeartbeatEventType =
  | "heartbeat"
  | "session_start"
  | "session_end"
  | "git_commit";

export interface HeartbeatPayload {
  eventType: HeartbeatEventType;
  projectAlias: string;
  tool: string;
  model: string;
  tokensInputDelta?: number;
  tokensOutputDelta?: number;
  occurredAt: string;
}

/** One entry in the offline queue — a heartbeat payload plus its auth context. */
export interface QueuedEvent {
  payload: HeartbeatPayload;
  apiUrl: string;
  deviceToken: string;
}

export interface DetectedActivity {
  tool: string;
  pid: number;
  cwd: string | null;
}
