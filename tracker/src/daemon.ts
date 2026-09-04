import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { readConfig } from "./config";
import { runLoop, sendOrQueue } from "./heartbeat";
import { ensureConfigDir, LOG_PATH, PID_PATH, readJson, removeFile, writeJsonAtomic } from "./paths";
import { readStatus, writeOfflineStatus } from "./statusFile";
import { clearStopRequest, requestStop } from "./stopRequest";
import type { TrackerConfig } from "./types";

interface PidFile {
  pid: number;
  startedAt: string;
}

/** How long `stop` gives the daemon to shut down cooperatively before killing it. */
const STOP_WAIT_MS = 8000;
const STOP_POLL_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readPid(): number | null {
  return readJson<PidFile>(PID_PATH)?.pid ?? null;
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 does not kill the process, only checks that it exists and
    // that this user has permission to signal it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function daemonStatus(): { running: boolean; pid: number | null } {
  const pid = readPid();
  if (pid === null) return { running: false, pid: null };
  return { running: isProcessAlive(pid), pid };
}

/**
 * Spawns a detached copy of the CLI running the hidden `run-loop` command,
 * which stays resident and performs the actual polling/heartbeat work. This
 * process (the `start` command) writes the pid file and returns immediately.
 */
export function startDaemon(entryPath: string): void {
  const existing = daemonStatus();
  if (existing.running) {
    console.log(`Tracker is already running (pid ${existing.pid}).`);
    return;
  }

  ensureConfigDir();
  clearStopRequest(); // a leftover request must not stop the daemon we're about to start
  const logFd = fs.openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [entryPath, "run-loop"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  if (!child.pid) {
    console.error("Failed to start tracker daemon.");
    return;
  }

  writeJsonAtomic(PID_PATH, { pid: child.pid, startedAt: new Date().toISOString() });
  console.log(`Tracker started (pid ${child.pid}). Logs: ${LOG_PATH}`);
}

/**
 * If the daemon died without its shutdown path (killed, crashed, machine reset),
 * `status.json` still says "active" and the server session lingers until the rollup
 * job. Close it from here: presence fields come from status.json, credentials from
 * config.json — nothing the daemon wouldn't have sent itself. Best-effort: queued if
 * the network is down, delivered by the next daemon's first tick.
 */
async function endLingeringSession(): Promise<void> {
  const status = readStatus();
  if (status.status === "offline") return;
  if (status.status === "active" && status.projectAlias && status.tool) {
    const config = readConfig();
    if (config) {
      await sendOrQueue(config, {
        eventType: "session_end",
        projectAlias: status.projectAlias,
        tool: status.tool,
        model: status.model,
        occurredAt: new Date().toISOString(),
      });
      console.log(`Sent session_end for the interrupted session (${status.projectAlias} · ${status.tool}).`);
    }
  }
  writeOfflineStatus();
}

/**
 * Cooperative stop: writes `stop.request`, which the daemon checks every tick and
 * on a 1 s timer, and waits up to STOP_WAIT_MS for it to send its own session_end,
 * write "offline" and exit. Signals are deliberately not the primary mechanism —
 * on Windows `process.kill(pid, "SIGTERM")` is TerminateProcess, so the daemon's
 * handler never ran and the session was left open (see stopRequest.ts). Only if
 * the daemon ignores the request is it killed, and then this command closes the
 * session on its behalf.
 */
export async function stopDaemon(): Promise<void> {
  const { running, pid } = daemonStatus();
  if (!running || pid === null) {
    console.log("Tracker is not running.");
    removeFile(PID_PATH);
    clearStopRequest();
    await endLingeringSession();
    return;
  }

  requestStop();
  const deadline = Date.now() + STOP_WAIT_MS;
  while (isProcessAlive(pid) && Date.now() < deadline) await sleep(STOP_POLL_MS);

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid);
      console.log(`Tracker did not stop within ${STOP_WAIT_MS / 1000}s; killed it (pid ${pid}).`);
    } catch (err) {
      console.error("Failed to stop tracker:", err);
    }
  } else {
    console.log(`Tracker stopped (pid ${pid}).`);
  }
  removeFile(PID_PATH);
  clearStopRequest();
  // After a cooperative exit status.json is already "offline" and this is a no-op;
  // after a kill it closes the session the daemon didn't get to.
  await endLingeringSession();
}

/**
 * Entry point for the hidden `run-loop` command: runs the heartbeat loop in
 * the foreground until `stop.request` appears or a termination signal arrives,
 * then ends any open session, marks status offline, and exits 0. This is what
 * `startDaemon` spawns detached — it is never meant to be invoked directly by a
 * user.
 */
export function runForeground(config: TrackerConfig): void {
  // A request left behind by an interrupted `stop` must not end this daemon on
  // its very first check.
  clearStopRequest();

  let shuttingDown = false;
  let stopLoop: (() => Promise<void>) | null = null;

  const shutdown = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`tracker: shutting down (${reason})`);
    (stopLoop ? stopLoop() : Promise.resolve())
      .catch((err) => console.error("tracker: error during shutdown:", err))
      .finally(() => {
        removeFile(PID_PATH);
        clearStopRequest();
        process.exit(0);
      });
  };

  const loop = runLoop(config, { onStopRequest: () => shutdown("stop.request") });
  stopLoop = loop.stop;

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
