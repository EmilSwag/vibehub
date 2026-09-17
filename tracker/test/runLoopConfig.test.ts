// T1 (round 10): a running daemon must pick up config.json between ticks.
//
// The bug: `runLoop(config)` closed over the config it was spawned with, so a
// `login` run while the daemon was alive wrote a good token that nothing ever read.
// The daemon kept 401-ing on the revoked one, the site said "Offline", and there was
// no way out that did not involve knowing to stop the daemon first.
//
// SAFETY: the tracker's paths are derived from the home directory at module load, so
// HOME/USERPROFILE are redirected at a sandbox BEFORE anything that knows about
// ~/.vibehub is imported, and the redirect is asserted below. A real ~/.vibehub — and
// any daemon actually running against it — is never read or written by this file.

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, describe, it, mock } from "node:test";
import type { TrackerConfig } from "../src/types";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "loop-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);

// require(), not import: this package is CommonJS, and the whole point is that these
// modules load AFTER the redirect above — a static import would hoist past it.
const { CONFIG_DIR } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(
    `refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox} — a real ~/.vibehub must never be touched by tests`,
  );
}
const { refreshConfig, runLoop } = require("../src/heartbeat") as typeof import("../src/heartbeat");

const forbidden = (): never => { throw new Error("Live network/process calls are forbidden in isolated loop tests"); };
mock.method(globalThis, "fetch", async () => forbidden());
mock.method(process, "kill", forbidden);
for (const method of ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync"])
  mock.method(require("node:child_process"), method, forbidden);
after(() => { mock.restoreAll(); rmSync(sandbox, { recursive: true, force: true }); });

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

/** Collects what the loop logs, so the log line can be asserted on — including what it must NOT contain. */
function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

describe("refreshConfig", () => {
  it("adopts a token written while the daemon was running", () => {
    const active = config();
    const result = refreshConfig(active, config({ deviceToken: "token-B" }));
    assert.deepEqual(result.changed, ["deviceToken"]);
    assert.equal(result.config.deviceToken, "token-B");
  });

  it("adopts a changed apiUrl", () => {
    const result = refreshConfig(config(), config({ apiUrl: "https://example.invalid" }));
    assert.deepEqual(result.changed, ["apiUrl"]);
    assert.equal(result.config.apiUrl, "https://example.invalid");
  });

  it("reports every live field that moved", () => {
    const result = refreshConfig(
      config(),
      config({
        apiUrl: "https://example.invalid",
        deviceToken: "token-B",
        projectAliases: { vibehub: "VibeHub" },
        idleThresholdMs: 1000,
      }),
    );
    assert.deepEqual(result.changed, ["apiUrl", "deviceToken", "projectAliases", "idleThresholdMs"]);
  });

  it("adopts an alias edit made by set on a live daemon", () => {
    const result = refreshConfig(config(), config({ projectAliases: { vibehub: "hidden" } }));
    assert.deepEqual(result.changed, ["projectAliases"]);
    assert.deepEqual(result.config.projectAliases, { vibehub: "hidden" });
  });

  it("keeps the config it has when nothing moved", () => {
    const active = config();
    const result = refreshConfig(active, config()); // equal values, different object
    assert.deepEqual(result.changed, []);
    assert.equal(result.config, active, "an unchanged file must not swap the object the loop holds");
  });

  it("does not claim a restart-only field was applied", () => {
    // heartbeatIntervalMs set the interval timer when the daemon started; saying it
    // had been applied here would be a lie, so it is not reported as a change.
    const result = refreshConfig(config(), config({ heartbeatIntervalMs: 5000 }));
    assert.deepEqual(result.changed, []);
  });

  it("pauses when config.json is gone; old values are only a comparison baseline", () => {
    const active = config();
    const result = refreshConfig(active, null);
    assert.equal(result.config, active);
    assert.equal(result.paused, true);
    assert.deepEqual(result.changed, []);
  });

  it("keeps the last good config when the file is half-written or credential-less", () => {
    const active = config();
    const broken = [
      { apiUrl: "http://127.0.0.1:1" },
      { deviceToken: "token-B" },
      { apiUrl: "", deviceToken: "token-B" },
      { apiUrl: "http://127.0.0.1:1", deviceToken: "" },
    ];
    for (const half of broken) {
      const result = refreshConfig(active, half as TrackerConfig);
      assert.equal(result.config, active, `adopted a broken config: ${JSON.stringify(half)}`);
      assert.equal(result.paused, true);
      assert.deepEqual(result.changed, []);
    }
  });

  it("normalises a config.json with no alias table", () => {
    const loaded = { apiUrl: "http://127.0.0.1:1", deviceToken: "token-B" } as TrackerConfig;
    const result = refreshConfig(config(), loaded);
    assert.deepEqual(result.changed, ["deviceToken"]);
    assert.deepEqual(result.config.projectAliases, {});
  });
});

describe("runLoop config swap", () => {
  it("hands each tick the config.json of the moment, not the one it was spawned with", async () => {
    const tokens: string[] = [];
    let onDisk: TrackerConfig | null = config({ heartbeatIntervalMs: 20 });
    const log = captureLog();
    const loop = runLoop(onDisk, {
      loadConfig: () => onDisk,
      runTick: async (tickConfig) => {
        tokens.push(tickConfig.deviceToken);
      },
    });
    try {
      await waitUntil(() => tokens.length >= 1, "the first tick");
      // What `vibehub-tracker login <newToken>` does to a live daemon's world.
      onDisk = config({ heartbeatIntervalMs: 20, deviceToken: "token-B" });
      await waitUntil(() => tokens.includes("token-B"), "the swapped token to reach a tick");
    } finally {
      await loop.stop();
      log.restore();
    }
    assert.equal(tokens[0], "token-A", "the first tick should use the token the daemon started with");
    assert.equal(tokens.at(-1), "token-B");

    const announced = log.lines.filter((line) => line.includes("config.json changed"));
    assert.equal(announced.length, 1, `expected exactly one swap log line, got: ${JSON.stringify(log.lines)}`);
    assert.match(announced[0], /deviceToken/);
    assert.ok(
      !log.lines.some((line) => line.includes("token-A") || line.includes("token-B")),
      "a device token must never reach the daemon log",
    );
  });

  it("pauses instead of retaining collection permission when config.json disappears", async () => {
    const tokens: string[] = [];
    let onDisk: TrackerConfig | null = config({ heartbeatIntervalMs: 20 });
    const loop = runLoop(onDisk, {
      loadConfig: () => onDisk,
      runTick: async (tickConfig) => { tokens.push(tickConfig.deviceToken); },
    });
    try {
      await waitUntil(() => tokens.length >= 1, "the first tick");
      onDisk = null;
      const before = tokens.length;
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(tokens.length, before, "no tick may use cached credentials after config removal");
      onDisk = config({ heartbeatIntervalMs: 20, deviceToken: "token-B" });
      await waitUntil(() => tokens.includes("token-B"), "valid configuration to resume collection");
    } finally { await loop.stop(); }
  });

  it("follows apiUrl to a new server without a restart", async () => {
    const urls: string[] = [];
    let onDisk: TrackerConfig | null = config({ heartbeatIntervalMs: 20 });
    const loop = runLoop(onDisk, {
      loadConfig: () => onDisk,
      runTick: async (tickConfig) => {
        urls.push(tickConfig.apiUrl);
      },
    });
    try {
      await waitUntil(() => urls.length >= 1, "the first tick");
      onDisk = config({ heartbeatIntervalMs: 20, apiUrl: "http://127.0.0.1:2" });
      await waitUntil(() => urls.includes("http://127.0.0.1:2"), "the swapped apiUrl to reach a tick");
    } finally {
      await loop.stop();
    }
    assert.equal(urls[0], "http://127.0.0.1:1");
  });
});
