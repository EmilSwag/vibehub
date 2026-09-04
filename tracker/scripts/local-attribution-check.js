#!/usr/bin/env node
/**
 * Deterministic end-to-end check of heartbeat v2 token attribution.
 *
 *   node scripts/local-attribution-check.js        (from tracker/, after `npm run build`)
 *
 * Isolated by construction: HOME/USERPROFILE point at a throwaway dir (so
 * ~/.vibehub is never touched), CLAUDE_CONFIG_DIR at a fake projects tree with
 * one session file, CODEX_HOME at a nonexistent dir. Runs tick() once to prime
 * the tailer, appends assistant lines for two models ("claude-fable-5-1" with
 * usage 500/200 and "<synthetic>" with 5/5) plus a user line carrying cwd, runs
 * tick() again against a mock API, and asserts on what was sent.
 *
 * Part 1b drives two more ticks to pin the presence-model hysteresis: a one-off
 * side call on another model must not switch the session; the same model burning
 * alone in two consecutive polls must.
 *
 * Part 2 drives the Detector with stub adapters to pin the presence rules
 * (log-backed > process-only, hysteresis, tokens break hysteresis).
 *
 * Part 3 runs the real loop (runLoop) and drops ~/.vibehub/stop.request: the loop
 * must notice, send session_end after its last heartbeat, and write "offline".
 *
 * Override the built tracker location with VIBEHUB_TRACKER_DIST.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "vibehub-attr-home-"));
const fakeClaude = fs.mkdtempSync(path.join(os.tmpdir(), "vibehub-attr-claude-"));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome; // os.homedir() reads this on Windows
process.env.CLAUDE_CONFIG_DIR = fakeClaude;
process.env.CODEX_HOME = path.join(fakeClaude, "no-codex-here");

const dist = process.env.VIBEHUB_TRACKER_DIST || path.join(__dirname, "..", "dist");
const { tick, createLoopState, runLoop } = require(path.join(dist, "heartbeat.js"));
const { readStatus } = require(path.join(dist, "statusFile.js"));
const { Detector } = require(path.join(dist, "detector.js"));
const { requestStop, isStopRequested } = require(path.join(dist, "stopRequest.js"));

const FAKE_CWD = process.platform === "win32" ? "C:\\tmp\\fakeproj" : "/tmp/fakeproj";
const projectDir = path.join(fakeClaude, "projects", "C--tmp-fakeproj");
const sessionFile = path.join(projectDir, "s1.jsonl");

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`PASS  ${label}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${label}\n      ${err.message.split("\n").join("\n      ")}`);
  }
};

const line = (obj) => JSON.stringify(obj) + "\n";
const userLine = (ts) => line({ type: "user", cwd: FAKE_CWD, timestamp: ts, sessionId: "s1", message: { role: "user", content: "(test)" } });
const assistantLine = (ts, id, model, input, output) =>
  line({
    type: "assistant",
    cwd: FAKE_CWD,
    timestamp: ts,
    sessionId: "s1",
    message: {
      id,
      model,
      role: "assistant",
      usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });

function cleanup() {
  for (const dir of [fakeHome, fakeClaude]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/** Mock VibeHub API: records every heartbeat body in arrival order, answers 200. */
async function startMockApi() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body || "{}"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => server.listen(0, r));
  return {
    received,
    apiUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const events = (list) => list.map((p) => `${p.eventType}:${p.model}`).join(" ");

async function partOne() {
  console.log("--- part 1: end-to-end tick() attribution ---");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(sessionFile, userLine(new Date().toISOString()));

  const api = await startMockApi();
  const { received } = api;
  const config = {
    apiUrl: api.apiUrl,
    deviceToken: "attr-check-token",
    projectAliases: {},
    idleThresholdMs: 5 * 60 * 1000,
  };
  const state = createLoopState(config);

  await tick(config, state); // primes the tailer at the current end of s1.jsonl
  const afterPrime = received.length;

  const ts = new Date().toISOString();
  fs.appendFileSync(
    sessionFile,
    assistantLine(ts, "msg_fable_1", "claude-fable-5-1", 500, 200) +
      assistantLine(ts, "msg_fable_1", "claude-fable-5-1", 500, 200) + // streamed duplicate: same id, must not double count
      assistantLine(ts, "msg_synth_1", "<synthetic>", 5, 5) +
      userLine(ts)
  );
  await tick(config, state);

  const payloads = received.slice(afterPrime);
  for (const p of received) console.log("  sent:", JSON.stringify(p));

  const hb = payloads.filter((p) => p.eventType === "heartbeat");
  check("second tick sent exactly one heartbeat", () => assert.equal(hb.length, 1));
  const beat = hb[0] || {};
  const usage = Array.isArray(beat.usage) ? beat.usage : [];
  const byModel = (m) => usage.find((u) => u.tool === "claude-code" && u.model === m);

  check("usage has {claude-code, claude-fable-5-1, 500, 200} (streamed duplicate de-duped)", () =>
    assert.deepEqual(byModel("claude-fable-5-1"), { tool: "claude-code", model: "claude-fable-5-1", tokensInputDelta: 500, tokensOutputDelta: 200 })
  );
  check("synthetic tokens bucketed under model null (5/5)", () =>
    assert.deepEqual(byModel(null), { tool: "claude-code", model: null, tokensInputDelta: 5, tokensOutputDelta: 5 })
  );
  check("no usage entry carries the literal '<synthetic>'", () => assert.equal(usage.some((u) => u.model === "<synthetic>"), false));
  check("legacy top-level deltas equal the sums (505/205)", () => {
    assert.equal(beat.tokensInputDelta, 505);
    assert.equal(beat.tokensOutputDelta, 205);
  });
  check("presence tool/model is claude-code / claude-fable-5-1 (not <synthetic>)", () => {
    assert.equal(beat.tool, "claude-code");
    assert.equal(beat.model, "claude-fable-5-1");
  });
  check("projectAlias is the cwd basename 'fakeproj'", () => assert.equal(beat.projectAlias, "fakeproj"));
  check("session_start/session_end carry no usage and no deltas", () => {
    for (const p of received.filter((x) => x.eventType !== "heartbeat")) {
      assert.equal(p.usage, undefined, `${p.eventType} has usage`);
      assert.equal(p.tokensInputDelta, undefined, `${p.eventType} has tokensInputDelta`);
    }
  });
  check("no payload leaks the cwd path", () => {
    const blob = JSON.stringify(received);
    assert.equal(blob.includes(FAKE_CWD), false);
    assert.equal(blob.includes("fakeproj\\") || blob.includes("/fakeproj/"), false);
  });

  const status = readStatus();
  console.log("  status.json:", JSON.stringify(status));
  check("status.json model is claude-fable-5-1", () => assert.equal(status.model, "claude-fable-5-1"));
  check("status.json sources lists claude-code/claude-fable-5-1", () =>
    assert.ok((status.sources || []).some((s) => s.tool === "claude-code" && s.model === "claude-fable-5-1"))
  );
  check("status.json path is inside the throwaway home", () => {
    assert.ok(fs.existsSync(path.join(fakeHome, ".vibehub", "status.json")));
  });

  // ---- part 1b: presence-model hysteresis (token attribution stays exact) ----
  console.log("--- part 1b: presence-model hysteresis ---");

  // (i) One side call on another model (title generation, a sub-agent) while the
  // session's model is silent this poll → tokens are booked to sonnet, presence stays fable.
  let from = received.length;
  fs.appendFileSync(sessionFile, assistantLine(new Date().toISOString(), "msg_sonnet_1", "claude-sonnet-5", 40, 10));
  await tick(config, state);
  let sent = received.slice(from);
  console.log("  tick 3 sent:", events(sent));
  check("(i) side call once: no session_end/session_start", () =>
    assert.equal(sent.some((p) => p.eventType !== "heartbeat"), false, `got ${events(sent)}`)
  );
  check("(i) side call once: heartbeat presence model stays claude-fable-5-1", () => {
    assert.equal(sent.length, 1);
    assert.equal(sent[0].model, "claude-fable-5-1");
  });
  check("(i) side call once: the sonnet tokens are still attributed exactly (40/10)", () =>
    assert.deepEqual(sent[0].usage, [{ tool: "claude-code", model: "claude-sonnet-5", tokensInputDelta: 40, tokensOutputDelta: 10 }])
  );
  check("(i) status.json model stays claude-fable-5-1", () => assert.equal(readStatus().model, "claude-fable-5-1"));

  // (ii) The same model burns again in the very next poll while fable is still
  // silent → second consecutive poll → presence follows it (one clean switch).
  from = received.length;
  fs.appendFileSync(sessionFile, assistantLine(new Date().toISOString(), "msg_sonnet_2", "claude-sonnet-5", 30, 5));
  await tick(config, state);
  sent = received.slice(from);
  console.log("  tick 4 sent:", events(sent));
  check("(ii) new model twice in a row, old silent: session_end(fable) → session_start(sonnet) → heartbeat(sonnet)", () =>
    assert.deepEqual(
      sent.map((p) => [p.eventType, p.model]),
      [
        ["session_end", "claude-fable-5-1"],
        ["session_start", "claude-sonnet-5"],
        ["heartbeat", "claude-sonnet-5"],
      ]
    )
  );
  check("(ii) heartbeat after the switch carries only this poll's tokens (30/5)", () =>
    assert.deepEqual(sent[2].usage, [{ tool: "claude-code", model: "claude-sonnet-5", tokensInputDelta: 30, tokensOutputDelta: 5 }])
  );
  check("(ii) status.json model is now claude-sonnet-5", () => assert.equal(readStatus().model, "claude-sonnet-5"));

  // And back: a single fable burst does not flip it straight back.
  from = received.length;
  fs.appendFileSync(sessionFile, assistantLine(new Date().toISOString(), "msg_fable_2", "claude-fable-5-1", 20, 2));
  await tick(config, state);
  sent = received.slice(from);
  console.log("  tick 5 sent:", events(sent));
  check("(i') one fable burst after the switch: presence stays claude-sonnet-5, tokens go to fable", () => {
    assert.deepEqual(
      sent.map((p) => [p.eventType, p.model]),
      [["heartbeat", "claude-sonnet-5"]]
    );
    assert.deepEqual(sent[0].usage, [{ tool: "claude-code", model: "claude-fable-5-1", tokensInputDelta: 20, tokensOutputDelta: 2 }]);
  });

  await api.close();
}

async function partTwo() {
  console.log("--- part 2: Detector presence rules with stub adapters ---");
  const now = 1_800_000_000_000;
  const win = 5 * 60 * 1000;
  const obs = (tool, o) => ({
    tool,
    cwd: null,
    projectHint: null,
    model: null,
    lastActivityAt: now,
    tokensInputDelta: 0,
    tokensOutputDelta: 0,
    usage: [],
    confidence: "activity",
    ...o,
  });
  const withTokens = (model, i, out) => ({ model, tokensInputDelta: i, tokensOutputDelta: out, usage: [{ model, tokensInputDelta: i, tokensOutputDelta: out }] });
  const detect = async (observations, current) => {
    const d = new Detector(win);
    d.adapters = [{ name: "stub", poll: async () => observations }];
    return d.detect(now, current);
  };

  const claudeQuiet = obs("claude-code", { cwd: "/p/a", model: "claude-opus-5", lastActivityAt: now - 20_000 });
  const cursorFresh = obs("cursor", { projectHint: "a", lastActivityAt: now - 1_000 });

  let r = await detect([claudeQuiet, cursorFresh], { tool: "claude-code", cwd: "/p/a", projectHint: null });
  check("hysteresis: Claude session kept when Cursor's title changed later but burned nothing", () => assert.equal(r.tool, "claude-code"));

  r = await detect([claudeQuiet, cursorFresh], undefined);
  check("no session: log-backed Claude beats newer process-only Cursor", () => assert.equal(r.tool, "claude-code"));

  const claudeBurning = obs("claude-code", { cwd: "/p/a", lastActivityAt: now - 20_000, ...withTokens("claude-opus-5", 100, 10) });
  r = await detect([claudeBurning, cursorFresh], { tool: "cursor", cwd: null, projectHint: "a" });
  check("tokens break hysteresis: Cursor session switches to Claude that burned tokens", () => assert.equal(r.tool, "claude-code"));

  const codexBurning = obs("codex", { cwd: "/p/b", lastActivityAt: now - 40_000, ...withTokens("gpt-5-codex", 50, 5) });
  r = await detect([claudeQuiet, codexBurning, cursorFresh], { tool: "claude-code", cwd: "/p/a", projectHint: null });
  check("another log-backed tool burning tokens wins over a quiet current Claude session", () => assert.equal(r.tool, "codex"));

  const claudeB = obs("claude-code", { cwd: "/p/b", model: "claude-sonnet-5", lastActivityAt: now - 5_000 });
  r = await detect([claudeQuiet, claudeB], { tool: "claude-code", cwd: "/p/a", projectHint: null });
  check("same tool, two projects, no tokens: current project is kept over the newer one", () => assert.equal(r.cwd, "/p/a"));

  r = await detect([claudeQuiet, cursorFresh, obs("claude-code", { cwd: "/p/b", ...withTokens("claude-fable-5-1", 7, 3), lastActivityAt: now - 3_000 })], undefined);
  check("usage merges across observations; presence model is the picked file's model", () => {
    assert.deepEqual(r.usage, [{ tool: "claude-code", model: "claude-fable-5-1", tokensInputDelta: 7, tokensOutputDelta: 3 }]);
    assert.equal(r.tokensInputDelta, 7);
    assert.equal(r.model, "claude-fable-5-1");
  });

  const claudeStale = obs("claude-code", { cwd: "/p/a", model: "claude-opus-5", lastActivityAt: now - 10 * 60_000 });
  const cursorIdle = obs("cursor", { projectHint: "a", lastActivityAt: now - 8 * 60_000, observedAt: now, confidence: "presence" });
  r = await detect([claudeStale, cursorIdle], { tool: "claude-code", cwd: "/p/a", projectHint: null });
  check("nothing fresh: reported as not active", () => assert.equal(r.active, false));
  check("seen list includes the idle Cursor as observed now", () =>
    assert.ok(r.seen.some((s) => s.tool === "cursor" && s.lastSeenAt === now))
  );
}

async function partThree() {
  console.log("--- part 3: stop.request → cooperative shutdown ---");
  // s1.jsonl is fresh (part 1 just wrote it), so a new loop opens a session on its first tick.
  const api = await startMockApi();
  const { received } = api;
  const config = {
    apiUrl: api.apiUrl,
    deviceToken: "attr-check-token",
    projectAliases: {},
    heartbeatIntervalMs: 300,
    idleThresholdMs: 5 * 60 * 1000,
  };

  const stoppedAt = new Promise((resolve) => {
    const loop = runLoop(config, {
      onStopRequest: () => {
        // Mirrors daemon.ts's runForeground: the callback runs the normal shutdown.
        loop.stop().then(() => resolve(Date.now()));
      },
    });
  });

  // Let a couple of ticks go out, then ask for a stop the way `vibehub-tracker stop` does.
  await new Promise((r) => setTimeout(r, 1000));
  const beforeStop = received.length;
  const requestedAt = Date.now();
  requestStop();
  check("stop.request exists right after requestStop()", () => assert.equal(isStopRequested(), true));

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("loop did not stop within 5 s")), 5000));
  const at = await Promise.race([stoppedAt, timeout]);
  await api.close();

  console.log("  sequence:", events(received));
  const lastIdx = received.length - 1;
  const lastHeartbeat = received.map((p, i) => [p, i]).filter(([p]) => p.eventType === "heartbeat").pop();
  check("(iii) loop opened a session and sent at least one heartbeat before the stop", () => {
    assert.ok(received.slice(0, beforeStop).some((p) => p.eventType === "session_start"));
    assert.ok(lastHeartbeat, "no heartbeat at all");
  });
  check("(iii) the loop noticed stop.request within ~2 s", () => assert.ok(at - requestedAt < 2500, `took ${at - requestedAt} ms`));
  check("(iii) last payload is session_end, sent after the last heartbeat", () => {
    assert.equal(received[lastIdx].eventType, "session_end");
    assert.ok(lastHeartbeat[1] < lastIdx);
    assert.ok(Date.parse(received[lastIdx].occurredAt) >= Date.parse(lastHeartbeat[0].occurredAt));
  });
  check("(iii) session_end names the session that was open", () => {
    const start = received.filter((p) => p.eventType === "session_start").pop();
    assert.equal(received[lastIdx].projectAlias, start.projectAlias);
    assert.equal(received[lastIdx].tool, start.tool);
  });
  const status = readStatus();
  console.log("  status.json:", JSON.stringify(status));
  check("(iii) status.json is offline after the stop", () => {
    assert.equal(status.status, "offline");
    assert.equal(status.projectAlias, null);
  });
  check("(iii) stop.request was cleared by the loop", () => assert.equal(isStopRequested(), false));
}

(async () => {
  try {
    await partOne();
    await partTwo();
    await partThree();
  } catch (err) {
    failures++;
    console.log("FAIL  unexpected error:", err && err.stack ? err.stack : err);
  } finally {
    cleanup();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
