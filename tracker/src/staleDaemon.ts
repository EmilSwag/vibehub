/**
 * Round 10, T3: when `start` finds a daemon already running, decide whether that
 * daemon is *stale* — still alive, but no longer doing the job the user just asked
 * for — and should therefore be replaced.
 *
 * The trap this exists for (measured on the PO's machine, 2026-09-14): a daemon
 * captures its config once at spawn and the installer is setup-only by contract, so
 * a machine could sit for days with a daemon from an older build heartbeating a token
 * the server revoked hours ago. Every heartbeat was a 401, the site said "Offline",
 * `login` wrote a good token nothing ever read, and `start` only ever answered
 * "already running". Nothing in the product replaced that process.
 *
 * Two signals, both derived from file timestamps rather than from anything the
 * daemon reports about itself (a daemon that is misbehaving is not a witness):
 *
 *   older-build    the tracker file on disk is newer than the moment the running
 *                  daemon started, so the running process loaded an earlier build
 *                  (this is exactly what a re-install leaves behind).
 *   revoked-token  the server is rejecting its token AND config.json has been
 *                  rewritten since it started — i.e. there is a newer token on disk
 *                  that this daemon has never read.
 *
 * Deliberately conservative: replacing a daemon interrupts a live session, so an
 * input we cannot read (missing pidfile, unparseable timestamp) is never treated as
 * evidence of staleness, and equal timestamps are not either. Being wrong in this
 * direction costs the user a `stop` they type themselves; being wrong in the other
 * direction kills a healthy daemon behind their back.
 *
 * Pure by design — no fs, no clock, no process state — so every branch is unit
 * tested (test/staleDaemon.test.ts) instead of being reachable only from a real
 * machine in a bad state.
 */

export type StaleDaemonReason = "older-build" | "revoked-token";

export interface StaleDaemonInputs {
  /** mtime of the tracker file `start` would run, or null when it can't be read. */
  binMtimeMs: number | null;
  /** `startedAt` from ~/.vibehub/tracker.pid, or null when missing/unparseable. */
  startedAtMs: number | null;
  /** mtime of ~/.vibehub/config.json, or null when it can't be read. */
  configMtimeMs: number | null;
  /** status.json's `authRejected`: true only when the server actually answered 401. */
  authRejected: boolean;
}

const known = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The reason the running daemon should be replaced, or null to leave it alone.
 * Truthy = stale, so callers can branch on it directly and still report *why*.
 */
export function isStaleDaemon(inputs: StaleDaemonInputs): StaleDaemonReason | null {
  const { binMtimeMs, startedAtMs, configMtimeMs, authRejected } = inputs;

  // Without a start time nothing can be compared against it.
  if (!known(startedAtMs)) return null;

  // Checked first: a daemon running an older build is stale whatever its token is
  // doing, and the newer build is the one that can fix the rest.
  if (known(binMtimeMs) && binMtimeMs > startedAtMs) return "older-build";

  if (authRejected && known(configMtimeMs) && configMtimeMs > startedAtMs) return "revoked-token";

  return null;
}

/** How `start` explains itself before replacing a daemon. Complete a sentence with it. */
export const STALE_DAEMON_EXPLANATION: Record<StaleDaemonReason, string> = {
  // mtime says "installed after the daemon started", not "different build": re-running
  // the one-liner with a byte-identical bundle trips this too (round 12), so the sentence
  // must be true in both cases.
  "older-build": "it was started before the tracker was last installed on this machine",
  "revoked-token": "the server is rejecting its token and it has never read the newer one in config.json",
};

/**
 * Lane B (mac app): the same judgement for the hidden `serve` command, which runs the
 * loop in the foreground for a supervisor (the VibeHub app's launchd LaunchAgent).
 *
 * `serve` finds a daemon already running and must decide between deferring to it
 * (exit 0 - the supervisor's KeepAlive relaunch then costs nothing) and replacing it.
 * A stale daemon is replaced for exactly the reasons `start` replaces one. A *healthy*
 * daemon is replaced only when it was started by hand (`start`'s detached run-loop,
 * recognisable by a tracker.pid with no `mode`): once a supervisor exists it should own
 * the tracker, because a detached daemon has nobody to restart it after a crash or a
 * reboot. A healthy daemon that is itself a `serve` is left strictly alone.
 */
export type ServeTakeoverReason = StaleDaemonReason | "manual";

export interface ServeInputs extends StaleDaemonInputs {
  /** `mode` from ~/.vibehub/tracker.pid: "serve" for a supervised daemon; undefined for one `start` spawned (or a build before `serve` existed). */
  mode: string | undefined;
}

export function serveTakeoverReason(inputs: ServeInputs): ServeTakeoverReason | null {
  const stale = isStaleDaemon(inputs);
  if (stale) return stale;
  return inputs.mode === "serve" ? null : "manual";
}

/** Same sentence shape as STALE_DAEMON_EXPLANATION: completes "Tracker is running (pid N), but ...". */
export const SERVE_TAKEOVER_EXPLANATION: Record<ServeTakeoverReason, string> = {
  ...STALE_DAEMON_EXPLANATION,
  manual: "it was started by hand and nothing would restart it after a crash or a reboot",
};
