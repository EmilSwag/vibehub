import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { runLoop } from "./heartbeat";
import { ensureConfigDir, LOG_PATH, PID_PATH, readJson, removeFile, writeJsonAtomic } from "./paths";
import { writeOfflineStatus } from "./statusFile";
import type { TrackerConfig } from "./types";

interface PidFile {
  pid: number;
  startedAt: string;
}

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

export function stopDaemon(): void {
  const { running, pid } = daemonStatus();
  if (!running || pid === null) {
    console.log("Tracker is not running.");
    removeFile(PID_PATH);
    writeOfflineStatus();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stop signal sent (pid ${pid}).`);
  } catch (err) {
    console.error("Failed to stop tracker:", err);
  }
  removeFile(PID_PATH);
}

/**
 * Entry point for the hidden `run-loop` command: runs the heartbeat loop in
 * the foreground until a termination signal arrives, then ends any open
 * session, marks status offline, and exits. This is what `startDaemon` spawns
 * detached — it is never meant to be invoked directly by a user.
 */
export function runForeground(config: TrackerConfig): void {
  const { stop } = runLoop(config);
  let shuttingDown = false;

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    stop()
      .catch((err) => console.error("tracker: error during shutdown:", err))
      .finally(() => {
        removeFile(PID_PATH);
        process.exit(0);
      });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
