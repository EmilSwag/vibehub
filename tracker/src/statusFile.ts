import { readJson, STATUS_PATH, writeJsonAtomic } from "./paths";
import type { StatusFile } from "./types";

export const OFFLINE_STATUS: StatusFile = {
  status: "offline",
  projectAlias: null,
  tool: null,
  model: null,
  sessionStartedAt: null,
  updatedAt: new Date(0).toISOString(),
};

/** Reads status.json, or a fresh "offline" snapshot if it has never been written. */
export function readStatus(): StatusFile {
  const status = readJson<StatusFile>(STATUS_PATH);
  return status ?? { ...OFFLINE_STATUS, updatedAt: new Date().toISOString() };
}

export function writeStatus(status: StatusFile): void {
  writeJsonAtomic(STATUS_PATH, status);
}

export function writeOfflineStatus(): void {
  writeStatus({ ...OFFLINE_STATUS, updatedAt: new Date().toISOString() });
}

/**
 * Flips the `authRejected` flag without touching the rest of the status —
 * called on every send attempt (live or queued-retry) so `status` reflects
 * the current token's health, not just whatever the last heartbeat reported.
 */
export function markAuthRejected(rejected: boolean): void {
  const current = readStatus();
  // Strict equality on purpose: `undefined` ("never attempted yet") must NOT be
  // treated as equal to `false` ("confirmed good") — collapsing them here (an
  // earlier version of this used `?? false`) meant the very first successful
  // send after login never actually got persisted, since undefined already
  // looked like a match for `false` and the write was skipped as a no-op.
  // `status` then stayed stuck reporting "not yet" forever, even once the
  // tracker was genuinely connected.
  if (current.authRejected === rejected) return;
  writeStatus({ ...current, authRejected: rejected });
}
