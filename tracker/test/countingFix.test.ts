// QA fix, lane L1 COUNT (meta/plans/vibehub-qa-fix.md): what the tracker counts.
//
//   R1  model ids are accepted by a safe shape, so a model released after this build
//       (claude-opus-5-5) is named instead of reported as null.
//   R2  cache reads are NOT input: Claude fresh input = input + cache writes, Codex fresh
//       input = input - cached; reads (and writes, for pricing) ride as their own counters.
//   R3  nothing read is silently dropped: big appends are caught up in chunks, a record
//       cap pauses instead of skipping, late records still count (never as presence), and
//       usage from a heartbeat that failed goes out with the next one.
//
// SAFETY: same sandbox rule as every tracker test - HOME is redirected BEFORE any tracker
// module loads and the redirect is asserted, network is a local stub, processes are
// forbidden. A real ~/.vibehub, ~/.claude or ~/.codex is never read or written.

import { strict as assert } from "node:assert";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, describe, it, mock } from "node:test";
import type { TrackerConfig } from "../src/types";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "counting-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

const { CONFIG_DIR } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(`refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox}`);
}
const privacy = require("../src/privacy") as typeof import("../src/privacy");
const { ClaudeCodeAdapter } = require("../src/adapters/claudeCode") as typeof import("../src/adapters/claudeCode");
const { CodexAdapter } = require("../src/adapters/codex") as typeof import("../src/adapters/codex");
const { MAX_CHUNK_BYTES, MAX_RECORDS_PER_FILE } = require("../src/adapters/jsonlTail") as typeof import("../src/adapters/jsonlTail");
const { Detector } = require("../src/detector") as typeof import("../src/detector");
const { createLoopState, tick } = require("../src/heartbeat") as typeof import("../src/heartbeat");

const forbidden = (): never => { throw new Error("process calls are forbidden in isolated counting tests"); };
mock.method(process, "kill", forbidden);
for (const method of ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync"])
  mock.method(require("node:child_process"), method, forbidden);
after(() => { mock.restoreAll(); rmSync(sandbox, { recursive: true, force: true }); });

const WINDOW = 300_000;
const claudeDir = join(sandbox, ".claude", "projects", "-work-vibehub");
mkdirSync(claudeDir, { recursive: true });
let fileSeq = 0;
const newClaudeLog = (): string => {
  const file = join(claudeDir, `session-${++fileSeq}.jsonl`);
  writeFileSync(file, "");
  return file;
};
let msgSeq = 0;
const assistant = (usage: Record<string, number>, opts: { model?: string; at?: number; id?: string } = {}): string =>
  JSON.stringify({
    type: "assistant", timestamp: new Date(opts.at ?? Date.now()).toISOString(), cwd: "/work/vibehub",
    message: { id: opts.id ?? `msg_test${++msgSeq}`, role: "assistant", model: opts.model ?? "claude-opus-5-5", usage },
  }) + "\n";
const OPUS_TURN = { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 5_000, cache_creation_input_tokens: 200 };

describe("R1: model ids by safe shape", () => {
  it("names models released after this build", () => {
    assert.equal(privacy.safeModel("claude-opus-5-5", "claude-code"), "claude-opus-5-5");
    assert.equal(privacy.safeModel("claude-haiku-4-5-20251001", "claude-code"), "claude-haiku-4-5-20251001");
    assert.equal(privacy.safeModel("gpt-6-sol", "codex"), "gpt-6-sol");
    assert.equal(privacy.safeModel("gpt-6-luna", "codex"), "gpt-6-luna");
    assert.equal(privacy.safeModel("gpt-5.1-codex-max", "codex"), "gpt-5.1-codex-max");
    assert.equal(privacy.safeModel("gpt-4o-2024-08-06", "codex"), "gpt-4o-2024-08-06");
  });
  it("still refuses display ids, junk and cross-tool ids", () => {
    for (const model of ["claude-4.5-sonnet", "gpt-5-high", "gpt-6-sol-xhigh", "Claude-Opus-5-5", "claude-opus-5-5 ",
      "<synthetic>", "claude-opus-5-5\n", "x".repeat(61), "o5", "auto", "", null, 5]) {
      assert.equal(privacy.safeModel(model, "claude-code"), null, String(model));
      assert.equal(privacy.safeModel(model, "codex"), null, String(model));
    }
    assert.equal(privacy.safeModel("gpt-6-sol", "claude-code"), null);
    assert.equal(privacy.safeModel("claude-opus-5-5", "codex"), null);
  });
});

describe("R2: cache counters on the wire", () => {
  it("projects cache counters and refuses writes larger than input", () => {
    assert.deepEqual(privacy.projectUsage({ tool: "claude-code", model: "claude-opus-5-5", tokensInputDelta: 210,
      tokensOutputDelta: 50, tokensCacheReadDelta: 5_000, tokensCacheWriteDelta: 200 }),
    { tool: "claude-code", model: "claude-opus-5-5", tokensInputDelta: 210, tokensOutputDelta: 50,
      tokensCacheReadDelta: 5_000, tokensCacheWriteDelta: 200 });
    assert.equal(privacy.projectUsage({ tool: "claude-code", model: null, tokensInputDelta: 1, tokensOutputDelta: 0,
      tokensCacheWriteDelta: 2 }), null);
    assert.equal(privacy.projectUsage({ tool: "claude-code", model: null, tokensInputDelta: 1, tokensOutputDelta: 0,
      tokensCacheReadDelta: -1 }), null);
  });
  it("sends legacy cache sums and keeps a cache-read-only entry", () => {
    const payload = privacy.projectHeartbeat({ eventType: "heartbeat", projectAlias: "unknown", tool: "claude-code",
      model: "claude-opus-5-5", occurredAt: new Date().toISOString(),
      usage: [{ tool: "claude-code", model: "claude-opus-5-5", tokensInputDelta: 0, tokensOutputDelta: 0, tokensCacheReadDelta: 9 }] });
    assert.equal(payload?.usage?.length, 1);
    assert.equal(payload?.tokensInputDelta, 0);
    assert.equal(payload?.tokensCacheReadDelta, 9);
    assert.equal(payload?.tokensCacheWriteDelta, undefined);
  });

  it("Claude Code: fresh input = input + cache writes; reads ride separately; repeats count once", async () => {
    const file = newClaudeLog();
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    const id = "msg_repeat1";
    appendFileSync(file, assistant(OPUS_TURN, { id }) + assistant(OPUS_TURN, { id }));
    const [obs] = (await adapter.poll()).filter((o) => o.usage.length);
    assert.deepEqual(obs.usage, [{ model: "claude-opus-5-5", tokensInputDelta: 210, tokensOutputDelta: 50,
      tokensCacheReadDelta: 5_000, tokensCacheWriteDelta: 200 }]);
    assert.equal(obs.model, "claude-opus-5-5");
    assert.equal(obs.tokensInputDelta, 210);
  });

  it("Codex: fresh input = input - cached", async () => {
    const dir = join(sandbox, ".codex", "sessions", "2026", "09", "26");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "rollout-test1.jsonl");
    writeFileSync(file, "");
    const adapter = new CodexAdapter(WINDOW);
    await adapter.poll();
    const at = () => new Date().toISOString();
    const count = (input: number, cached: number, output: number) => JSON.stringify({ type: "event_msg", timestamp: at(),
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } }) + "\n";
    appendFileSync(file, JSON.stringify({ type: "turn_context", timestamp: at(), payload: { cwd: "/work/vibehub", model: "gpt-6-sol" } }) + "\n" +
      count(1_000, 800, 10) + count(3_000, 2_500, 30));
    const [obs] = (await adapter.poll()).filter((o) => o.usage.length);
    assert.deepEqual(obs.usage, [{ model: "gpt-6-sol", tokensInputDelta: 300, tokensOutputDelta: 20, tokensCacheReadDelta: 1_700 }]);
  });
});

describe("R3: nothing read is dropped", () => {
  const filler = (bytes: number): string => {
    const line = JSON.stringify({ type: "user", pad: "x".repeat(100_000) }) + "\n";
    return line.repeat(Math.ceil(bytes / line.length));
  };

  it("catches up an append larger than one chunk instead of jumping to EOF", async () => {
    const file = newClaudeLog();
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    appendFileSync(file, filler(MAX_CHUNK_BYTES + 1_000_000) + assistant(OPUS_TURN));
    let counted = 0;
    for (let i = 0; i < 3; i++) for (const o of await adapter.poll()) counted += o.tokensOutputDelta;
    assert.equal(counted, 50);
  });

  it("pauses at the record cap and resumes, instead of skipping the rest", async () => {
    const file = newClaudeLog();
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    appendFileSync(file, `${JSON.stringify({ type: "user" })}\n`.repeat(MAX_RECORDS_PER_FILE + 10) + assistant(OPUS_TURN));
    const first = (await adapter.poll()).reduce((n, o) => n + o.tokensOutputDelta, 0);
    const second = (await adapter.poll()).reduce((n, o) => n + o.tokensOutputDelta, 0);
    assert.deepEqual([first, second], [0, 50]);
  });

  it("counts a record read late, but never as presence", async () => {
    const file = newClaudeLog();
    const detector = new Detector(WINDOW);
    await detector.detect();
    detector.takeLateUsage();
    appendFileSync(file, assistant(OPUS_TURN, { at: Date.now() - 20 * 60_000 }));
    assert.equal(await detector.detect(), null, "a 20-minute-old turn is not live activity");
    assert.deepEqual(detector.takeLateUsage(), [{ tool: "claude-code", model: "claude-opus-5-5", tokensInputDelta: 210,
      tokensOutputDelta: 50, tokensCacheReadDelta: 5_000, tokensCacheWriteDelta: 200 }]);
    assert.deepEqual(detector.takeLateUsage(), [], "drained once");
  });

  it("delivers usage from a failed heartbeat with the next one, exactly once", async () => {
    const file = newClaudeLog();
    const config: TrackerConfig = { apiUrl: "http://127.0.0.1:9", deviceToken: "token-A", projectAliases: {} };
    const state = createLoopState(config);
    state.loadConfig = () => config;
    const beats: Record<string, unknown>[] = [];
    let heartbeatStatus = 200;
    const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/connection")) {
        return new Response(JSON.stringify({ protocol: "connection-v1", connected: true, lastSeenAt: new Date().toISOString() }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      if (body.eventType !== "heartbeat") return new Response("{}", { status: 200 });
      if (heartbeatStatus !== 200) return new Response("{}", { status: heartbeatStatus });
      beats.push(body);
      return new Response("{}", { status: 200 });
    });
    try {
      await tick(config, state); // primes the logs
      appendFileSync(file, assistant(OPUS_TURN));
      heartbeatStatus = 503;
      await tick(config, state);
      assert.equal(beats.length, 0);
      assert.equal(state.pendingUsage.size, 1, "the undelivered usage is kept");
      heartbeatStatus = 200;
      appendFileSync(file, assistant({ input_tokens: 1, output_tokens: 2 }));
      await tick(config, state);
      assert.equal(beats.length, 1);
      assert.deepEqual(beats[0].usage, [{ tool: "claude-code", model: "claude-opus-5-5", tokensInputDelta: 211,
        tokensOutputDelta: 52, tokensCacheReadDelta: 5_000, tokensCacheWriteDelta: 200 }]);
      assert.equal(beats[0].tokensCacheReadDelta, 5_000);
      assert.equal(state.pendingUsage.size, 0);
      await tick(config, state);
      const later = beats.slice(1).flatMap((b) => (b.usage as unknown[]) ?? []);
      assert.deepEqual(later, [], "nothing is sent twice");
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("drops usage the server refuses instead of re-sending it forever", async () => {
    const file = newClaudeLog();
    const config: TrackerConfig = { apiUrl: "http://127.0.0.1:9", deviceToken: "token-B", projectAliases: {} };
    const state = createLoopState(config);
    state.loadConfig = () => config;
    const beats: Record<string, unknown>[] = [];
    let heartbeatStatus = 200;
    const warn = mock.method(console, "warn", () => {});
    const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/connection")) {
        return new Response(JSON.stringify({ protocol: "connection-v1", connected: true, lastSeenAt: new Date().toISOString() }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      if (body.eventType !== "heartbeat") return new Response("{}", { status: 200 });
      if (heartbeatStatus !== 200) return new Response("{}", { status: heartbeatStatus });
      beats.push(body);
      return new Response("{}", { status: 200 });
    });
    try {
      await tick(config, state); // primes the logs
      appendFileSync(file, assistant(OPUS_TURN));
      heartbeatStatus = 400;
      await tick(config, state);
      assert.equal(state.pendingUsage.size, 0, "a refused body is not stashed for a retry");
      assert.equal(warn.mock.callCount(), 1);
      heartbeatStatus = 200;
      appendFileSync(file, assistant({ input_tokens: 1, output_tokens: 2 }));
      await tick(config, state);
      assert.equal(beats.length, 1, "the next beat goes through");
      assert.deepEqual(beats[0].usage, [{ tool: "claude-code", model: "claude-opus-5-5", tokensInputDelta: 1, tokensOutputDelta: 2 }]);
    } finally {
      fetchMock.mock.restore();
      warn.mock.restore();
    }
  });
});
