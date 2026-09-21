// Lane B (mac app): the hidden `serve` command - the foreground daemon a supervisor
// (the VibeHub app's com.vibehub.tracker LaunchAgent) runs instead of `start`.
//
// Contract (tracker/README.md "Daemon model", ARCHITECTURE.md §4.6):
//   - `serve` runs the loop in the foreground and owns tracker.pid itself (mode "serve");
//   - if a healthy supervised tracker already runs it exits 0 and does nothing, so a
//     KeepAlive supervisor relaunching it every ThrottleInterval is a cheap no-op;
//   - a daemon started by hand (`start`, no mode in tracker.pid) or a stale one is
//     stopped cooperatively and replaced - the supervisor owns the tracker from then on.
//
// SAFETY: same sandbox rule as the other daemon tests - HOME/USERPROFILE are redirected
// to a throwaway directory BEFORE any tracker module is required, the redirect is
// asserted, and every child below is spawned with that same HOME. A real ~/.vibehub -
// and the daemon that may be running against it on this machine - is never read or
// written. The sandbox config points at 127.0.0.1:1, so the loop's only network
// activity is a refused localhost connection.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import type { ServeInputs } from "../src/staleDaemon";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "serve-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);

// require(), not import: this package is CommonJS and these modules must load AFTER the
// redirect above, which a hoisted static import would defeat.
const { CONFIG_DIR, LOG_PATH, PID_PATH, STOP_REQUEST_PATH } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(
    `refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox} - a real ~/.vibehub must never be touched by tests`,
  );
}
const { writeConfig } = require("../src/config") as typeof import("../src/config");
const { serveTakeoverReason, SERVE_TAKEOVER_EXPLANATION, STALE_DAEMON_EXPLANATION } =
  require("../src/staleDaemon") as typeof import("../src/staleDaemon");

const ENTRY = resolve(__dirname, "../src/index.ts");
const TRACKER_ROOT = resolve(__dirname, "..");
const childEnv = { ...process.env, HOME: sandbox, USERPROFILE: sandbox, HOMEDRIVE: sandbox.slice(0, 2), HOMEPATH: sandbox.slice(2) };

interface Spawned { child: ChildProcess; out: () => string; exited: Promise<number | null> }
const spawned: Spawned[] = [];

function run(args: string[], label: string): Spawned {
  const child = spawn(process.execPath, args, { cwd: TRACKER_ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => { buffer += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { buffer += chunk.toString("utf8"); });
  const exited = new Promise<number | null>((resolveExit) => {
    child.on("exit", (code) => resolveExit(code));
    child.on("error", () => resolveExit(null));
  });
  const entry: Spawned = { child, out: () => `${label}:\n${buffer}`, exited };
  spawned.push(entry);
  return entry;
}

const serve = (label: string): Spawned => run(["--import", "tsx", ENTRY, "serve"], label);

const waitUntil = async (done: () => boolean, what: () => string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what()}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
};

const withTimeout = <T,>(promise: Promise<T>, ms: number, what: () => string): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${what()}`)), ms))]);

interface PidFile { pid?: number; startedAt?: string; mode?: string }
function readPidFile(): PidFile | null {
  try { return JSON.parse(readFileSync(PID_PATH, "utf8")) as PidFile; } catch { return null; }
}
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
/**
 * `serve` redirects console to daemon.log the moment it starts the loop, so a failure
 * after that point shows an empty stdout and says nothing about why. Every timeout
 * message below carries the loop log for that reason.
 */
const loopLog = (): string => {
  const log = ((): string => {
    try { return readFileSync(LOG_PATH, "utf8"); } catch { return "(absent)"; }
  })();
  return `\nstop.request present: ${existsSync(STOP_REQUEST_PATH)}` +
    `\ntracker.pid: ${JSON.stringify(readPidFile())}` +
    `\nCONFIG_DIR: ${CONFIG_DIR}\ndaemon.log:\n${log}`;
};
/** What `vibehub-tracker stop` writes - the daemon honours it within a second. */
const requestStop = (): void => writeFileSync(STOP_REQUEST_PATH, JSON.stringify({ requestedAt: new Date().toISOString(), byPid: process.pid }));

after(async () => {
  for (const { child } of spawned) { try { child.kill(); } catch {} }
  await Promise.all(spawned.map(({ exited }) => withTimeout(exited, 5000, () => "child exit").catch(() => null)));
  try { rmSync(sandbox, { recursive: true, force: true }); } catch {}
});

// The tracker refuses to run without a config; every child reads this sandboxed file.
writeConfig({ apiUrl: "http://127.0.0.1:1", deviceToken: "serve-test-token-do-not-use", projectAliases: {}, heartbeatIntervalMs: 1000 });

describe("serveTakeoverReason", () => {
  const STARTED = Date.parse("2026-09-19T09:00:00.000Z");
  const MINUTE = 60_000;
  const daemon = (overrides: Partial<ServeInputs> = {}): ServeInputs => ({
    binMtimeMs: STARTED - 60 * MINUTE,
    startedAtMs: STARTED,
    configMtimeMs: STARTED - 30 * MINUTE,
    authRejected: false,
    mode: "serve",
    ...overrides,
  });

  it("defers to a healthy supervised tracker", () => {
    assert.equal(serveTakeoverReason(daemon()), null);
  });

  it("takes over a healthy daemon started by hand", () => {
    // A pid file without `mode` was written by `start` (or by a build that predates
    // `serve`): a detached daemon nobody restarts after a crash or a reboot.
    assert.equal(serveTakeoverReason(daemon({ mode: undefined })), "manual");
    assert.equal(serveTakeoverReason(daemon({ mode: "detached" })), "manual");
  });

  it("takes over a stale supervised tracker for the same reasons start would", () => {
    assert.equal(serveTakeoverReason(daemon({ binMtimeMs: STARTED + 5 * MINUTE })), "older-build");
    assert.equal(serveTakeoverReason(daemon({ authRejected: true, configMtimeMs: STARTED + 5 * MINUTE })), "revoked-token");
  });

  it("does not call a supervised tracker manual just because its start time is unknown", () => {
    assert.equal(serveTakeoverReason(daemon({ startedAtMs: null })), null);
    assert.equal(serveTakeoverReason(daemon({ startedAtMs: null, mode: undefined })), "manual");
  });

  it("has a sentence for every reason, in the form start already prints", () => {
    for (const reason of ["older-build", "revoked-token", "manual"] as const) {
      const sentence = SERVE_TAKEOVER_EXPLANATION[reason];
      assert.ok(sentence && sentence.length > 0, `no explanation for ${reason}`);
      assert.ok(!/^[A-Z]/.test(sentence), `${reason}: reads as a sentence start`);
      assert.ok(!sentence.endsWith("."), `${reason}: carries its own full stop`);
      assert.ok(/^[\x20-\x7e]+$/.test(sentence), `${reason}: must be ASCII (Windows consoles)`);
    }
    assert.equal(SERVE_TAKEOVER_EXPLANATION["older-build"], STALE_DAEMON_EXPLANATION["older-build"]);
    assert.equal(SERVE_TAKEOVER_EXPLANATION["revoked-token"], STALE_DAEMON_EXPLANATION["revoked-token"]);
  });
});

describe("serve (sandboxed daemon)", () => {
  it("owns tracker.pid, a second serve defers with exit 0, and stop.request ends it cleanly", { timeout: 90_000 }, async () => {
    const first = serve("serve #1");
    await waitUntil(() => readPidFile()?.pid === first.child.pid && readPidFile()?.mode === "serve", () => `serve #1 to claim tracker.pid\n${first.out()}`, 30_000);
    assert.ok(first.child.pid && alive(first.child.pid), "serve #1 should be running");

    const second = serve("serve #2");
    const code = await withTimeout(second.exited, 30_000, () => `serve #2 to exit\n${second.out()}`);
    assert.equal(code, 0, `a second serve must exit 0 when a healthy one runs\n${second.out()}`);
    assert.match(second.out(), /already running under a supervisor/);
    assert.equal(readPidFile()?.pid, first.child.pid, "the deferring serve must not touch tracker.pid");
    assert.ok(alive(first.child.pid!), "the deferring serve must not stop the running one");

    requestStop();
    const firstCode = await withTimeout(first.exited, 20_000, () => `serve #1 to honour stop.request\n${first.out()}${loopLog()}`);
    assert.equal(firstCode, 0, first.out());
    await waitUntil(() => !existsSync(PID_PATH), () => "tracker.pid to be removed on shutdown", 5_000);
    assert.ok(!existsSync(STOP_REQUEST_PATH), "stop.request must be consumed");
    assert.match(first.out(), /serving in the foreground/);
  });

  it("takes over a daemon that was started by hand", { timeout: 90_000 }, async () => {
    // A stand-in for a detached `run-loop`: alive, and cooperative about stop.request
    // the way the real daemon is, but writing nothing itself.
    const script = "const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},100)";
    const manual = run(["-e", script, STOP_REQUEST_PATH], "manual daemon");
    await waitUntil(() => Boolean(manual.child.pid) && alive(manual.child.pid!), () => "the manual daemon to start", 10_000);
    writeFileSync(PID_PATH, JSON.stringify({ pid: manual.child.pid, startedAt: new Date().toISOString() }));

    const taker = serve("serve #3");
    await waitUntil(() => readPidFile()?.pid === taker.child.pid && readPidFile()?.mode === "serve", () => `serve #3 to take over\n${taker.out()}`, 40_000);
    const manualCode = await withTimeout(manual.exited, 10_000, () => "the manual daemon to have been stopped");
    assert.equal(manualCode, 0, "the manual daemon must have been asked to stop, not killed");
    assert.match(taker.out(), /started by hand/);
    assert.match(taker.out(), /Taking it over/);

    requestStop();
    assert.equal(await withTimeout(taker.exited, 20_000, () => `serve #3 to stop\n${taker.out()}${loopLog()}`), 0, taker.out());
    await waitUntil(() => !existsSync(PID_PATH), () => "tracker.pid to be removed", 5_000);
  });
});
