// L1 follow-up (meta/plans/vibehub-qa-fix.md): what the tailer discovers and from where.
//
//   U1  Only the first poll with no cursor state primes at EOF (history is never replayed).
//       After that a file with no cursor that changed since the previous poll is read from
//       byte 0 - a new session's first turns used to be lost. Claude turns de-duplicate on
//       message.id + requestId in a bounded LRU; a NEW Codex rollout counts from zero.
//   U2  Subagent transcripts under projects/<project>/<session>/subagents/** (<= 5 levels)
//       are read and attributed to the parent session's project; discovery is bounded.
//
// SAFETY: HOME is redirected to a sandbox BEFORE any tracker module loads and asserted;
// no network, no processes. A real ~/.vibehub, ~/.claude or ~/.codex is never touched.

import { strict as assert } from "node:assert";
// require(), not a namespace import: mock.method must patch the object the tailer calls.
const fs = require("node:fs") as typeof import("node:fs");
import { join, resolve } from "node:path";
import { after, describe, it, mock } from "node:test";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
fs.mkdirSync(tempRoot, { recursive: true });
const sandbox = fs.mkdtempSync(join(tempRoot, "tail-discovery-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

const { CONFIG_DIR } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) throw new Error(`refusing to run: tracker resolves ${CONFIG_DIR}, not ${sandbox}`);
const { ClaudeCodeAdapter } = require("../src/adapters/claudeCode") as typeof import("../src/adapters/claudeCode");
const { CodexAdapter } = require("../src/adapters/codex") as typeof import("../src/adapters/codex");
const tail = require("../src/adapters/jsonlTail") as typeof import("../src/adapters/jsonlTail");

const forbidden = (): never => { throw new Error("process calls are forbidden here"); };
mock.method(process, "kill", forbidden);
for (const method of ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync"])
  mock.method(require("node:child_process"), method, forbidden);
after(() => { mock.restoreAll(); fs.rmSync(sandbox, { recursive: true, force: true }); });

const WINDOW = 300_000;
const projects = join(sandbox, ".claude", "projects");
let seq = 0;
/** A fresh project directory per test, so tests never see each other's writes. */
const project = (): string => { const dir = join(projects, `-work-p${++seq}`); fs.mkdirSync(dir, { recursive: true }); return dir; };
const turn = (opts: { id?: string; req?: string; cwd?: string; out?: number; at?: number } = {}): string => JSON.stringify({
  type: "assistant", timestamp: new Date(opts.at ?? Date.now()).toISOString(), cwd: opts.cwd ?? "/work/vibehub",
  ...(opts.req === undefined ? { requestId: `req_${++seq}` } : opts.req ? { requestId: opts.req } : {}),
  message: { id: opts.id ?? `msg_t${++seq}`, role: "assistant", model: "claude-opus-5-5",
    usage: { input_tokens: 1, output_tokens: opts.out ?? 10 } },
}) + "\n";
type Obs = Awaited<ReturnType<InstanceType<typeof ClaudeCodeAdapter>["poll"]>>;
const output = (list: Obs): number => list.reduce((n, o) => n + o.tokensOutputDelta, 0);
const past = (file: string, ms: number): void => { const t = new Date(Date.now() - ms); fs.utimesSync(file, t, t); };

describe("U1: prime only on the first run, read new work from byte 0", () => {
  it("the first poll primes existing history - nothing is replayed", async () => {
    const dir = project();
    fs.writeFileSync(join(dir, "old.jsonl"), turn({ out: 100 }));
    const adapter = new ClaudeCodeAdapter(WINDOW);
    assert.equal(output(await adapter.poll()), 0);
    assert.equal(output(await adapter.poll()), 0, "and it stays primed");
  });

  it("a session file created after the first poll is read from byte 0", async () => {
    const dir = project();
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    // Created AND written between two polls: before, its first writes were skipped.
    fs.writeFileSync(join(dir, "new-session.jsonl"), turn({ out: 7 }) + turn({ out: 5 }));
    assert.equal(output(await adapter.poll()), 12);
    fs.appendFileSync(join(dir, "new-session.jsonl"), turn({ out: 3 }));
    assert.equal(output(await adapter.poll()), 3, "then it is tailed like any other");
  });

  it("a file that re-enters the listing after changing is read from 0, each turn once", async () => {
    const dir = project();
    const file = join(dir, "returning.jsonl");
    const fillers = Array.from({ length: tail.MAX_LOG_FILES }, (_, i) => join(dir, `filler-${i}.jsonl`));
    fs.writeFileSync(file, turn({ id: "msg_early", req: "req_early", out: 4 }));
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    // Bury it below the MAX_LOG_FILES cap: it drops out of the listing and loses its cursor.
    const bury = async (): Promise<void> => {
      past(file, 60 * 60_000);
      for (const f of fillers) fs.writeFileSync(f, "");
      await adapter.poll();
      for (const f of fillers) past(f, 2 * 60 * 60_000);
    };
    await bury();
    // It changes while unlisted and returns as the newest file: read from byte 0. Its
    // earlier turn was primed history to this adapter, so per U1 it is new work too.
    fs.appendFileSync(file, turn({ id: "msg_mid", req: "req_mid", out: 6 }));
    assert.equal(output(await adapter.poll()), 10);
    // Drops out and comes back again: read from 0 again, and message.id + requestId keeps
    // every turn it already counted at one.
    await bury();
    fs.appendFileSync(file, turn({ out: 2 }));
    assert.equal(output(await adapter.poll()), 2);
    for (const f of fillers) fs.rmSync(f);
  });

  it("dedupes on message.id + requestId, bounded, across files", async () => {
    const dir = project();
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    const same = turn({ id: "msg_dup", req: "req_dup", out: 9 });
    fs.writeFileSync(join(dir, "a.jsonl"), same + same);
    fs.writeFileSync(join(dir, "b.jsonl"), same + turn({ id: "msg_dup", req: "req_retry", out: 2 }));
    // Same id + same request once (9); the same id under another request is another turn.
    assert.equal(output(await adapter.poll()), 9 + 2);
    assert.ok(Number.isInteger(tail.MAX_LOG_FILES));
    const { MAX_RECEIPTS } = require("../src/adapters/claudeCode") as typeof import("../src/adapters/claudeCode");
    assert.equal(MAX_RECEIPTS, 16_384, "the LRU is bounded");
  });

  it("clear() makes the next poll a first run again (primes, replays nothing)", async () => {
    const dir = project();
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    adapter.clear();
    fs.writeFileSync(join(dir, "after-clear.jsonl"), turn({ out: 8 }));
    assert.equal(output(await adapter.poll()), 0);
  });

  it("a Codex rollout created after the first poll counts its first turn", async () => {
    const dir = join(sandbox, ".codex", "sessions", "2026", "09", "26");
    fs.mkdirSync(dir, { recursive: true });
    const adapter = new CodexAdapter(WINDOW);
    await adapter.poll();
    const at = () => new Date().toISOString();
    fs.writeFileSync(join(dir, "rollout-born1.jsonl"),
      JSON.stringify({ type: "turn_context", timestamp: at(), payload: { cwd: "/work/vibehub", model: "gpt-6-sol" } }) + "\n" +
      JSON.stringify({ type: "event_msg", timestamp: at(), payload: { type: "token_count",
        info: { total_token_usage: { input_tokens: 1_000, cached_input_tokens: 600, output_tokens: 40 } } } }) + "\n");
    const [obs] = (await adapter.poll()).filter((o) => o.usage.length);
    assert.deepEqual(obs?.usage, [{ model: "gpt-6-sol", tokensInputDelta: 400, tokensOutputDelta: 40, tokensCacheReadDelta: 600 }]);
  });
});

describe("U2: subagent transcripts", () => {
  it("reads subagents/** and attributes them to the parent session's project", async () => {
    const dir = project();
    const session = join(dir, "sess1.jsonl");
    fs.writeFileSync(session, "");
    const deep = join(dir, "sess1", "subagents", "workflows", "wf_abc-2f5");
    fs.mkdirSync(deep, { recursive: true });
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    fs.appendFileSync(session, turn({ out: 1, cwd: "/work/vibehub" }));
    // The subagent runs in a worktree: its own cwd names another folder.
    fs.writeFileSync(join(dir, "sess1", "subagents", "agent-a1.jsonl"), turn({ out: 20, cwd: "/tmp/wt/feature-x" }));
    fs.writeFileSync(join(deep, "agent-b2.jsonl"), turn({ out: 30, cwd: "/tmp/wt/feature-y" }));
    const list = await adapter.poll();
    assert.equal(output(list), 51);
    assert.deepEqual([...new Set(list.map((o) => o.projectHint))], ["vibehub"], "all of it is the parent's project");
  });

  it("stays inside the layout: depth <= 5 below subagents/, only subagents/, recent only", async () => {
    const dir = project();
    fs.writeFileSync(join(dir, "sess2.jsonl"), "");
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    const ok5 = join(dir, "sess2", "subagents", "a", "b", "c", "d", "e");
    const tooDeep = join(ok5, "f");
    const outside = join(dir, "sess2", "notes");
    for (const d of [tooDeep, outside]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(join(ok5, "agent-ok.jsonl"), turn({ out: 5 }));
    fs.writeFileSync(join(tooDeep, "agent-deep.jsonl"), turn({ out: 1000 }));
    fs.writeFileSync(join(outside, "agent-out.jsonl"), turn({ out: 1000 }));
    const stale = join(dir, "sess2", "subagents", "agent-stale.jsonl");
    fs.writeFileSync(stale, turn({ out: 1000 }));
    past(stale, 25 * 60 * 60_000);
    assert.equal(output(await adapter.poll()), 5);
  });

  it("an unchanged file is not even opened on the next poll", async () => {
    const dir = project();
    fs.writeFileSync(join(dir, "quiet.jsonl"), turn());
    const adapter = new ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    await adapter.poll();
    const opens = mock.method(fs, "openSync");
    try {
      await adapter.poll();
      assert.equal(opens.mock.calls.length, 0);
    } finally { opens.mock.restore(); }
  });

  it("subagent discovery keeps to its per-poll directory budget", async () => {
    const dir = project();
    const count = tail.MAX_SUBAGENT_DIRS_PER_POLL + 40;
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(join(dir, `s${i}.jsonl`), "");
      fs.mkdirSync(join(dir, `s${i}`, "subagents"), { recursive: true });
    }
    const opened = mock.method(fs, "opendirSync");
    try {
      const started = Date.now();
      new tail.JsonlTailer("claude-code").files();
      const subagentDirs = opened.mock.calls.filter((call) => String(call.arguments[0]).includes(`${join("", "subagents")}`)).length;
      assert.ok(subagentDirs <= tail.MAX_SUBAGENT_DIRS_PER_POLL, `${subagentDirs} subagent dirs opened`);
      assert.ok(Date.now() - started < 10_000, "discovery stays far below the 90 s watchdog");
    } finally { opened.mock.restore(); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
