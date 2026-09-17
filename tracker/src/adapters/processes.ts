import type { Adapter, Observation } from "./types";

/**
 * Retired under ai-session-metadata-v1. Kept as an inert compatibility export for
 * older callers, but never imported by Detector or the served bundle. No host
 * inventory, window/title, keyboard-idle, shell-cwd or IDE activity fallback.
 */
export class ProcessAdapter implements Adapter {
  readonly name = "processes";
  constructor(_idleAfterMs: number) {}
  async poll(): Promise<Observation[]> { return []; }
}

/** Deprecated title helpers deliberately cannot supply collection evidence. */
export function isRealWindowTitle(_title: string | null | undefined): boolean { return false; }
export function projectFromTitle(_title: string, _suffixes: string[]): null { return null; }
