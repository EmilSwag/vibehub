/** Supported AI-session metadata only. The default detector has no host adapter. */
export interface UsageDelta {
  model: string | null;
  tokensInputDelta: number;
  tokensOutputDelta: number;
  /** Cache reads (not part of tokensInputDelta) and cache writes (a subset of it). */
  tokensCacheReadDelta?: number;
  tokensCacheWriteDelta?: number;
  /** Legacy type compatibility only. Strict collection rejects estimates. */
  estimated?: boolean;
}

export interface Observation {
  tool: string;
  /** Retained for compatibility; strict source adapters ALWAYS return null. */
  cwd: string | null;
  /** Bounded folder hint from an AI record; only explicit user aliases are public. */
  projectHint: string | null;
  /** Exact allowed ID actually present in usage metadata, or null. */
  model: string | null;
  /** Timestamp of supported measured-usage evidence, NOT a filesystem timestamp. */
  lastActivityAt: number;
  observedAt?: number;
  tokensInputDelta: number;
  tokensOutputDelta: number;
  usage: UsageDelta[];
  /** Legacy presence value is rejected by the strict detector. */
  confidence: "activity" | "presence";
  /**
   * QA fix (R3): usage read this poll whose activity is no longer fresh (a record read
   * late). The detector books its tokens and never treats it as presence.
   */
  late?: boolean;
}

export interface Adapter {
  name: string;
  poll(now?: number, signal?: AbortSignal): Promise<Observation[]>;
  /** Clear numeric/allowlisted metadata on pause, account/config change or stop. */
  clear?(): void;
}
