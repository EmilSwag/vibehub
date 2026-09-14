import { spawn, spawnSync } from "node:child_process";
import { Console } from "node:console";
import * as fs from "node:fs";
import { readConfig } from "./config";
import { runLoop, sendOrQueue } from "./heartbeat";
import { CONFIG_PATH, ensureConfigDir, LOG_PATH, PID_PATH, readJson, removeFile, writeJsonAtomic } from "./paths";
import { isStaleDaemon, STALE_DAEMON_EXPLANATION } from "./staleDaemon";
import type { StaleDaemonInputs } from "./staleDaemon";
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

function fileMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/** Everything `isStaleDaemon` judges a running daemon by, read off this machine. */
function staleDaemonInputs(entryPath: string): StaleDaemonInputs {
  const startedAt = readJson<PidFile>(PID_PATH)?.startedAt;
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  return {
    binMtimeMs: fileMtimeMs(entryPath),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
    configMtimeMs: fileMtimeMs(CONFIG_PATH),
    authRejected: readStatus().authRejected === true,
  };
}

/**
 * Round 10, T2: what `start` says about a healthy daemon it is leaving alone.
 *
 * "Already running" on its own was the end of the road for a user whose token had
 * been revoked: the daemon was running, so `start` had nothing to add, and the
 * failure lived only in `status`. If the server is rejecting the token the daemon
 * is using, say so here — this is where the user is looking.
 */
function reportAlreadyRunning(pid: number | null): void {
  console.log(`Tracker is already running (pid ${pid}).`);
  if (readStatus().authRejected !== true) return;
  // ASCII only: this lands in cp866/1252 consoles where an em dash or arrow prints as "?".
  console.log("Connected: no - the server rejects its token.");
  console.log("  Fix: run the install command from VibeHub (Settings > Tracker) again, then `start`.");
}

/**
 * Spawns a detached copy of the CLI running the hidden `run-loop` command,
 * which stays resident and performs the actual polling/heartbeat work. This
 * process (the `start` command) writes the pid file and returns immediately.
 *
 * Round 10, T3: a daemon that is already running is normally left strictly alone —
 * except when it is demonstrably stale (older build, or rejecting a token config.json
 * has already replaced; see staleDaemon.ts). Then it is stopped cooperatively and a
 * fresh one takes its place, because the user typed `start` and a process that cannot
 * do the job is not a reason to refuse. The installer gets no such power: it is
 * setup-only by contract and never calls this.
 */
export async function startDaemon(entryPath: string): Promise<void> {
  const existing = daemonStatus();
  if (existing.running) {
    const stale = isStaleDaemon(staleDaemonInputs(entryPath));
    if (!stale) {
      reportAlreadyRunning(existing.pid);
      return;
    }
    console.log(`Tracker is running (pid ${existing.pid}), but ${STALE_DAEMON_EXPLANATION[stale]}.`);
    console.log("Replacing it.");
    await stopDaemon();
    const after = daemonStatus();
    if (after.running) {
      console.error(`Could not stop the old tracker (pid ${after.pid}); it is still running. Nothing was changed.`);
      return;
    }
  }

  ensureConfigDir();
  clearStopRequest(); // a leftover request must not stop the daemon we're about to start

  let pid: number | null = process.platform === "win32" ? spawnDetachedWindows(entryPath) : null;
  if (pid === null) pid = spawnDetachedDirect(entryPath);

  if (pid === null) {
    console.error("Failed to start tracker daemon.");
    return;
  }

  writeJsonAtomic(PID_PATH, { pid, startedAt: new Date().toISOString() });
  console.log(`Tracker started (pid ${pid}). Logs: ${LOG_PATH}`);
}

/** Plain detached spawn. Correct on macOS/Linux (libuv marks fds close-on-exec). */
function spawnDetachedDirect(entryPath: string): number | null {
  const logFd = fs.openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [entryPath, "run-loop"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  return child.pid ?? null;
}

/**
 * Windows: a detached child inherits every inheritable handle of this process,
 * including the stdout/stderr PIPE an AI agent (Claude Code, Cursor) or CI runner
 * gave us. The agent then waits for EOF until the daemon exits, so `start` looks
 * frozen forever with no output. PowerShell's Start-Process goes through
 * ShellExecute, which creates the daemon with a clean handle table (measured:
 * the caller's pipe closes in ~1 s instead of the daemon's lifetime). The daemon
 * writes its own log (see runForeground), so no redirection is needed here.
 */
function spawnDetachedWindows(entryPath: string): number | null {
  const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  // Start-Process joins -ArgumentList with spaces and does not quote, so the
  // script path is wrapped in double quotes itself (paths with spaces).
  const script =
    `$p = Start-Process -FilePath ${psQuote(process.execPath)} ` +
    `-ArgumentList @(${psQuote(`"${entryPath}"`)}, 'run-loop') -WindowStyle Hidden -PassThru; $p.Id`;
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000,
    });
    const pid = Number.parseInt((result.stdout ?? "").trim(), 10);
    if (result.status !== 0 || !Number.isInteger(pid) || pid <= 0) return null;
    return isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * The daemon owns its log file: on Windows it is started without any stdio
 * redirection (see spawnDetachedWindows), and on other platforms this simply
 * writes to the same file the parent opened for it.
 */
function redirectConsoleToLog(): void {
  ensureConfigDir();
  const out = fs.createWriteStream(LOG_PATH, { flags: "a" });
  globalThis.console = new Console({ stdout: out, stderr: out });
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
  redirectConsoleToLog();
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
