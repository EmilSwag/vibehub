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
  /**
   * Explicit opt-in for the metadata receiver (`adapters/attested.ts`). Absent or
   * `enabled: false` means the receiver is never constructed and its file is never
   * opened. `tools` is the exact set of tool ids the user is accepting records for;
   * an empty list accepts nothing. This never enables a producer — the tracker still
   * reads no source for these tools, it only accepts what a separate, user-installed
   * producer wrote. See docs/ARCHITECTURE.md §4.6.
   */
  attestedMetadata?: AttestedMetadataConfig;
}

export interface AttestedMetadataConfig {
  enabled: boolean;
  tools: string[];
}

export type PresenceStatus = "active" | "idle" | "offline";

/** One (tool, model) pair the daemon has seen recently — see `StatusFile.sources`. */
export interface StatusSource {
  tool: string;
  model: string | null;
  lastSeenAt: string;
}

export interface StatusFile {
  /** Local provenance marker; legacy snapshots cannot be reused for outgoing events. */
  collectionPolicy?: string;
  /** Digest of the local config; prevents reusing status after account/alias changes. */
  configFingerprint?: string;
  /**
   * True only while the explicitly opt-in metadata receiver is switched on in
   * `config.json`. `collectionPolicy` stays `ai-session-metadata-v1` either way —
   * this is the field that says whether the extra evidence class is live, so a
   * reader never has to infer it from the tool ids it happens to see.
   */
  attestedReceiver?: boolean;
  /** Result of the daemon's accepted connection-v1 receipt, not proof of AI activity. */
  connected?: boolean;
  lastConnectionCheckAt?: string;
  /** Server time from a validated connection-v1 receipt; separate from AI activity. */
  lastConnectionSeenAt?: string;
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
  /**
   * Legacy wire field. It once marked counts derived from chat-body character
   * lengths; that estimator is gone and `projectUsage` now REJECTS any entry
   * carrying `estimated: true` outright, so nothing this tracker sends can set it.
   * The field stays in the type only because the server still accepts it from
   * older trackers. Unknown usage is reported as unknown, never as an estimate.
   */
  estimated?: boolean;
}

/**
 * Round 6: one tool the tracker can see open right now. People sit in several
 * terminals and IDEs at once, so presence reports the whole stack while time and
 * tokens still accrue only to the primary (the top-level `tool`/`model`) — Steam
 * semantics: show everything open, credit the one being driven.
 */
export interface HeartbeatTool {
  tool: string;
  model: string | null;
  /** null when unknown, or when the project is hidden by a user alias override. */
  projectAlias: string | null;
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
  /**
   * Round 6: every tool seen open at this moment, primary first, deduped by tool,
   * at most 10. Presence only — it never affects time or token accounting. Omitted
   * on session_start/session_end, and absent entirely from older trackers, which
   * is why the server falls back to `[activity]`.
   */
  tools?: HeartbeatTool[];
  occurredAt: string;
}

/** One entry in the offline queue — a heartbeat payload plus its auth context. */
export interface QueuedEvent {
  payload: HeartbeatPayload;
  apiUrl: string;
  deviceToken: string;
}
