// Round 11, work item 2: the loop must survive a tick that never finishes.
//
// Ticks skip rather than stack, which is right for a slow poll and wrong for a stuck
// one: `inFlight` stayed set forever, every later tick was skipped, and the daemon went
// on living while sending nothing at all. The watchdog abandons such a tick and keeps
// going - and, critically, a straggler that finally returns must not clear the marker
// of the tick that replaced it.
//
// SAFETY: importing the heartbeat module pulls in the tracker's path resolution, which
// is derived from the home directory at load time. HOME/USERPROFILE are redirected at a
// sandbox BEFORE that import and the redirect is asserted; a real ~/.vibehub is never
// read or written here.

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { TrackerConfig } from "../src/types";

const sandbox = mkdtempSync(join(tmpdir(), "vibehub-tracker-watchdog-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);

// require(), not import: this package is CommonJS and these modules must load AFTER the
// redirect above, which a hoisted static import would defeat.
const { CONFIG_DIR } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(
    `refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox} - a real ~/.vibehub must never be touched by tests`,
  );
}
const { MIN_TICK_WATCHDOG_MS, runLoop, tickWatchdogMs } = require("../src/heartbeat") as typeof import("../src/heartbeat");

after(() => rmSync(sandbox, { recursive: true, force: true }));

const config = (overrides: Partial<TrackerConfig> = {}): TrackerConfig => ({
  apiUrl: "http://127.0.0.1:1",
  deviceToken: "token-A",
  projectAliases: {},
  ...overrides,
});

const waitUntil = async (done: () => boolean, what: string, timeoutMs = 4000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const silence = () => {
  const warn = console.warn;
  const debug = console.debug;
  console.warn = () => {};
  console.debug = () => {};
  return () => {
    console.warn = warn;
    console.debug = debug;
  };
};

describe("tickWatchdogMs", () => {
  it("gives a tick three intervals before calling it stuck", () => {
    assert.equal(tickWatchdogMs(60_000), 180_000);
    assert.equal(tickWatchdogMs(120_000), 360_000);
  });

  it("never drops below the floor, however short the interval", () => {
    assert.equal(tickWatchdogMs(30_000), MIN_TICK_WATCHDOG_MS);
    assert.equal(tickWatchdogMs(1), MIN_TICK_WATCHDOG_MS);
    assert.equal(MIN_TICK_WATCHDOG_MS, 90_000);
  });
});

// Timings below are deliberately loose. These tests assert ordering ("not yet" then
// "now"), and the only way to assert "not yet" is to wait and look - so the wait has to
// sit far enough inside the watchdog that scheduler jitter cannot carry it past. A 45 ms
// wait against a 60 ms watchdog failed about one run in five; the margin here is ~5x.
const WATCHDOG_MS = 400;
const INTERVAL_MS = 15;
/** Comfortably inside WATCHDOG_MS: long enough to prove nothing fired, short enough to stay cheap. */
const WELL_INSIDE_MS = 80;

describe("runLoop tick watchdog", () => {
  it("abandons a wedged tick and keeps ticking", async () => {
    const restore = silence();
    // Held rather than dropped: stop() gives a tick still in flight a 3 s grace, so a
    // test that leaves one wedged pays that 3 s for nothing. Releasing them at the end
    // keeps the assertion about the watchdog and not about shutdown.
    const resolvers: Array<() => void> = [];
    let started = 0;
    const loop = runLoop(config({ heartbeatIntervalMs: INTERVAL_MS }), {
      loadConfig: () => config({ heartbeatIntervalMs: INTERVAL_MS }),
      watchdogMs: WATCHDOG_MS,
      runTick: () => {
        started += 1;
        return new Promise<void>((resolve) => resolvers.push(resolve));
      },
    });
    try {
      await waitUntil(() => started >= 1, "the first tick");
      // Well inside the watchdog: the loop must skip, not stack.
      await new Promise((resolve) => setTimeout(resolve, WELL_INSIDE_MS));
      assert.equal(started, 1, "a tick inside the watchdog window must not be replaced");
      await waitUntil(() => started >= 2, "the watchdog to abandon the wedged tick");
    } finally {
      for (const resolve of resolvers) resolve();
      await loop.stop();
      restore();
    }
  });

  it("does not let an abandoned tick clear the marker of the tick that replaced it", async () => {
    const restore = silence();
    const resolvers: Array<() => void> = [];
    let started = 0;
    const loop = runLoop(config({ heartbeatIntervalMs: INTERVAL_MS }), {
      loadConfig: () => config({ heartbeatIntervalMs: INTERVAL_MS }),
      watchdogMs: WATCHDOG_MS,
      runTick: () => {
        started += 1;
        return new Promise<void>((resolve) => resolvers.push(resolve));
      },
    });
    try {
      await waitUntil(() => started >= 1, "the first tick");
      await waitUntil(() => started >= 2, "the watchdog to start a second tick");
      assert.equal(started, 2);

      // Tick #1, long abandoned, finally returns. If its `finally` cleared the shared
      // marker, tick #2 would stop being "in flight" and a third tick would start
      // immediately - two live ticks sending overlapping, stale-dated payloads.
      // Tick #2 is only WELL_INSIDE_MS old here, so its own watchdog cannot be what
      // starts a third tick; anything that starts is the straggler's doing.
      resolvers[0]();
      await new Promise((resolve) => setTimeout(resolve, WELL_INSIDE_MS));
      assert.equal(started, 2, "a straggler must not free the slot held by the live tick");

      // The live tick finishing DOES free it.
      resolvers[1]();
      await waitUntil(() => started >= 3, "a new tick once the live one finished");
    } finally {
      for (const resolve of resolvers) resolve();
      await loop.stop();
      restore();
    }
  });
});
