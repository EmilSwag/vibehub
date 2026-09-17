import type { Adapter, Observation } from "./types";

/**
 * Unavailable under ai-session-metadata-v1. The documented mixed chat format has
 * no measured usage counters and its timestamp is a turn start, not completion.
 * Do not substitute body-length estimates, app presence, file changes or project
 * probing. A dedicated verified metadata feed is required before re-enabling it.
 * This compatibility adapter performs no filesystem or process operations.
 */
export class QuadcodeAdapter implements Adapter {
  readonly name = "quadcode";
  constructor(_recentWindowMs: number) {}
  async poll(): Promise<Observation[]> { return []; }
}

/** Retired compatibility helpers: raw content is not a source of token counts. */
export function estimateTokens(_text: string): number { return 0; }
export function stripToolResults(_text: string): string { return ""; }
