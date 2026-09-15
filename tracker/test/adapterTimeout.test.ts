// Round 11, work item 2: one adapter must never be able to hold up a tick.
//
// `Detector.detect` used to `await Promise.all(adapters.map(a => a.poll()))` with no
// bound at all, so a poll wedged on a hung `tasklist` or a disconnected network drive
// stalled the whole tick - and a tick that never returns is a daemon that is alive and
// sending nothing, which the site renders as "Offline" with no explanation anywhere.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ADAPTER_POLL_TIMEOUT_MS, pollAdapter } from "../src/detector";
import type { Adapter, Observation } from "../src/adapters/types";

const observation = (tool: string): Observation => ({
  tool,
  cwd: null,
  projectHint: null,
  model: null,
  lastActivityAt: Date.now(),
  tokensInputDelta: 0,
  tokensOutputDelta: 0,
  usage: [],
  confidence: "activity",
});

/** Swallows the one warning line pollAdapter prints, and hands it back for assertions. */
function captureWarn(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.warn = original;
    },
  };
}

const adapter = (name: string, poll: () => Promise<Observation[]>): Adapter => ({ name, poll });

describe("pollAdapter", () => {
  it("passes a healthy adapter's observations straight through", async () => {
    const out = await pollAdapter(adapter("fast", async () => [observation("cursor")]), 1000);
    assert.equal(out.length, 1);
    assert.equal(out[0].tool, "cursor");
  });

  it("gives up on an adapter that overruns, and says so once", async () => {
    const log = captureWarn();
    try {
      const started = Date.now();
      const out = await pollAdapter(
        adapter("wedged", () => new Promise<Observation[]>(() => {})), // never settles
        40,
      );
      const took = Date.now() - started;
      assert.deepEqual(out, [], "an adapter that overran must contribute nothing");
      assert.ok(took < 2000, `pollAdapter should return at the timeout, took ${took} ms`);
    } finally {
      log.restore();
    }
    assert.equal(log.lines.length, 1, `expected exactly one log line, got ${JSON.stringify(log.lines)}`);
    assert.match(log.lines[0], /wedged/);
  });

  it("does not let a late rejection from an abandoned poll escape", async () => {
    const log = captureWarn();
    let rejectLate: (err: Error) => void = () => {};
    try {
      const out = await pollAdapter(
        adapter("late", () => new Promise<Observation[]>((_resolve, reject) => (rejectLate = reject))),
        30,
      );
      assert.deepEqual(out, []);
      // The abandoned poll fails after we stopped waiting for it. Promise.race has
      // already attached a handler, so this must not surface as an unhandled rejection
      // (which would take the daemon down).
      rejectLate(new Error("late failure from an abandoned poll"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      log.restore();
    }
  });

  it("treats a throwing adapter as contributing nothing, with one line", async () => {
    const log = captureWarn();
    try {
      const out = await pollAdapter(
        adapter("broken", async () => {
          throw new Error("poll blew up");
        }),
        1000,
      );
      assert.deepEqual(out, []);
    } finally {
      log.restore();
    }
    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0], /broken/);
    assert.match(log.lines[0], /poll blew up/);
  });

  it("defaults to a ceiling above the process adapter's own budget", () => {
    // PowerShell 20 s + the tasklist fallback 20 s: the backstop must not preempt a
    // fallback that is legitimately still running.
    assert.ok(ADAPTER_POLL_TIMEOUT_MS > 40_000, `expected > 40000, got ${ADAPTER_POLL_TIMEOUT_MS}`);
  });
});
