// T3 (round 10): every branch of the rule that lets `start` replace a running daemon.
//
// isStaleDaemon is pure, so the states that matter here — a daemon from an older
// build, a daemon heartbeating a token the server revoked — are reachable as plain
// numbers instead of only on a machine that has been broken for a week.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isStaleDaemon, STALE_DAEMON_EXPLANATION } from "../src/staleDaemon";
import type { StaleDaemonInputs } from "../src/staleDaemon";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** When the daemon under test started. Everything else is expressed relative to it. */
const STARTED = Date.parse("2026-09-14T09:19:18.000Z");

/** A daemon started from the build that is on disk now, with a token the server likes. */
const daemon = (overrides: Partial<StaleDaemonInputs> = {}): StaleDaemonInputs => ({
  binMtimeMs: STARTED - 60 * MINUTE,
  startedAtMs: STARTED,
  configMtimeMs: STARTED - 30 * MINUTE,
  authRejected: false,
  ...overrides,
});

describe("isStaleDaemon", () => {
  it("leaves a healthy daemon alone", () => {
    assert.equal(isStaleDaemon(daemon()), null);
  });

  it("calls a daemon older than the installed build stale", () => {
    assert.equal(isStaleDaemon(daemon({ binMtimeMs: STARTED + 5 * MINUTE })), "older-build");
  });

  it("needs the build to be strictly newer, not merely as new", () => {
    // A daemon started in the same millisecond the file was written is the daemon
    // that build was started for. Replacing it would be a pointless restart.
    assert.equal(isStaleDaemon(daemon({ binMtimeMs: STARTED })), null);
    assert.equal(isStaleDaemon(daemon({ binMtimeMs: STARTED + 1 })), "older-build");
  });

  it("calls a rejected daemon stale once config.json holds something it never read", () => {
    assert.equal(
      isStaleDaemon(daemon({ authRejected: true, configMtimeMs: STARTED + 5 * MINUTE })),
      "revoked-token",
    );
  });

  it("does not call a rejected daemon stale while config.json is the same file it read", () => {
    // This is the PO's machine on 2026-09-14: daemon up since 09:19 with a token
    // revoked at 09:00, config.json untouched since 2026-09-05. Replacing it would
    // start a second daemon on the same dead token. `start` reports the rejection
    // instead (T2) and the fix is a new token — after which the case above fires.
    assert.equal(isStaleDaemon(daemon({ authRejected: true, configMtimeMs: STARTED - 9 * DAY })), null);
    assert.equal(isStaleDaemon(daemon({ authRejected: true, configMtimeMs: STARTED })), null);
  });

  it("does not treat a newer config.json alone as staleness", () => {
    // `vibehub-tracker set <folder> <alias>` rewrites config.json on a perfectly
    // healthy daemon, and T1 means it picks the change up on its next tick anyway.
    assert.equal(isStaleDaemon(daemon({ configMtimeMs: STARTED + 5 * MINUTE })), null);
  });

  it("reports the older build first when both signals are present", () => {
    const both = daemon({
      binMtimeMs: STARTED + 5 * MINUTE,
      authRejected: true,
      configMtimeMs: STARTED + 5 * MINUTE,
    });
    // Both end in the same action; the newer build is the one that can also fix the
    // token, so that is the reason the user is told.
    assert.equal(isStaleDaemon(both), "older-build");
  });

  it("refuses to judge a daemon whose start time is unknown", () => {
    // No pidfile, or one written by a build that didn't record startedAt: there is
    // nothing to compare against, and killing a daemon on a guess is worse than
    // leaving it up. The user can still `stop` explicitly.
    const loud = { binMtimeMs: STARTED + DAY, configMtimeMs: STARTED + DAY, authRejected: true };
    assert.equal(isStaleDaemon({ ...loud, startedAtMs: null }), null);
    assert.equal(isStaleDaemon({ ...loud, startedAtMs: Number.NaN }), null);
  });

  it("ignores a timestamp it could not read rather than guessing", () => {
    // Missing bin mtime must not block the token rule, and vice versa.
    assert.equal(
      isStaleDaemon(daemon({ binMtimeMs: null, authRejected: true, configMtimeMs: STARTED + MINUTE })),
      "revoked-token",
    );
    assert.equal(isStaleDaemon(daemon({ binMtimeMs: Number.NaN })), null);
    assert.equal(isStaleDaemon(daemon({ authRejected: true, configMtimeMs: null })), null);
    assert.equal(isStaleDaemon(daemon({ authRejected: true, configMtimeMs: Number.NaN })), null);
  });

  it("has a sentence to print for every reason it can return", () => {
    for (const reason of ["older-build", "revoked-token"] as const) {
      const sentence = STALE_DAEMON_EXPLANATION[reason];
      assert.ok(sentence && sentence.length > 0, `no explanation for ${reason}`);
      // It is printed as "Tracker is running (pid N), but <sentence>." — so it must
      // not arrive pre-capitalised or pre-punctuated.
      assert.ok(!/^[A-Z]/.test(sentence), `${reason}: reads as a sentence start`);
      assert.ok(!sentence.endsWith("."), `${reason}: carries its own full stop`);
    }
  });
});
