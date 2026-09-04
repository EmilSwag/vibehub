import * as fs from "node:fs";
import { STOP_REQUEST_PATH, removeFile, writeJsonAtomic } from "./paths";

/**
 * Cooperative shutdown handshake between `vibehub-tracker stop` and the daemon.
 *
 * Signals are not a portable way to ask the daemon to finish cleanly: on Windows
 * `process.kill(pid, "SIGTERM")` is TerminateProcess — the daemon's handler never
 * runs, no `session_end` goes out, `status.json` stays "active" and the server
 * session lingers until the rollup job. So `stop` writes `~/.vibehub/stop.request`
 * instead; the daemon checks for it on every tick and on a 1 s timer, runs its
 * normal shutdown (session_end → offline status → pid cleanup) and exits 0. Both
 * sides remove the file, so a leftover from an interrupted `stop` can't end the
 * next daemon (runForeground also clears it on startup, belt and braces).
 */
export function requestStop(): void {
  writeJsonAtomic(STOP_REQUEST_PATH, { requestedAt: new Date().toISOString(), byPid: process.pid });
}

export function isStopRequested(): boolean {
  return fs.existsSync(STOP_REQUEST_PATH);
}

export function clearStopRequest(): void {
  removeFile(STOP_REQUEST_PATH);
}
