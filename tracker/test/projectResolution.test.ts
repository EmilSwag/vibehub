// L1 P0 (meta/plans/vibehub-qa-fix.md): a mid-session cwd change must not drop anything.
//
// Before: the first line's cwd fixed a file's project; any later line in another folder
// (a `cd server`, a tool run elsewhere) marked the file invalid and every later token
// AND its presence were dropped - about 62% of a live day. Now the project is the
// session's LAUNCH folder (the cwd prefix whose slug is the project directory's name),
// an unmatched cwd keeps the known project, and Codex keeps the first project it saw.
//
// SAFETY: HOME is redirected to a sandbox BEFORE any tracker module loads and asserted;
// no network, no processes. A real ~/.vibehub, ~/.claude or ~/.codex is never touched.

import { strict as assert } from "node:assert";
import { join, resolve } from "node:path";
import { after, describe, it, mock } from "node:test";

const fs = require("node:fs") as typeof import("node:fs");
const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
fs.mkdirSync(tempRoot, { recursive: true });
const sandbox = fs.mkdtempSync(join(tempRoot, "project-resolution-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

const { CONFIG_DIR } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) throw new Error(`refusing to run: tracker resolves ${CONFIG_DIR}, not ${sandbox}`);
const claude = require("../src/adapters/claudeCode") as typeof import("../src/adapters/claudeCode");
const { CodexAdapter } = require("../src/adapters/codex") as typeof import("../src/adapters/codex");

const forbidden = (): never => { throw new Error("process calls are forbidden here"); };
mock.method(process, "kill", forbidden);
for (const method of ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync"])
  mock.method(require("node:child_process"), method, forbidden);
after(() => { mock.restoreAll(); fs.rmSync(sandbox, { recursive: true, force: true }); });

const WINDOW = 300_000;
const projects = join(sandbox, ".claude", "projects");
/** The project directory Claude Code creates for a session launched in `folder`. */
const projectFor = (folder: string): string => {
  const dir = join(projects, claude.projectSlug(folder));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
let seq = 0;
const turn = (cwd: string, out: number, opts: { id?: string; req?: string } = {}): string => JSON.stringify({
  type: "assistant", timestamp: new Date().toISOString(), cwd, requestId: opts.req ?? `req_r${++seq}`,
  message: { id: opts.id ?? `msg_r${++seq}`, role: "assistant", model: "claude-opus-5-5",
    usage: { input_tokens: 1, output_tokens: out, cache_creation_input_tokens: 2, cache_read_input_tokens: 50 } },
}) + "\n";
type Obs = Awaited<ReturnType<InstanceType<typeof claude.ClaudeCodeAdapter>["poll"]>>;
const output = (list: Obs): number => list.reduce((n, o) => n + o.tokensOutputDelta, 0);
const hints = (list: Obs): string[] => [...new Set(list.map((o) => o.projectHint ?? "null"))];

describe("launchFolder: the cwd prefix whose slug is the project directory", () => {
  it("walks up from a subfolder, keeps dots, handles trailing and Windows separators", () => {
    assert.equal(claude.launchFolder("/work/vibehub/server/src", "-work-vibehub"), "vibehub");
    assert.equal(claude.launchFolder("/work/vibehub/", "-work-vibehub"), "vibehub");
    assert.equal(claude.launchFolder("/Users/me/my.app/lib", "-Users-me-my-app"), "my.app");
    assert.equal(claude.launchFolder("C:\\Users\\me\\proj\\sub", "C--Users-me-proj"), "proj");
  });
  it("returns null when nothing matches - never guesses", () => {
    assert.equal(claude.launchFolder("/tmp/elsewhere", "-work-vibehub"), null);
    assert.equal(claude.launchFolder("/work/vibehubX", "-work-vibehub"), null);
    for (const bad of [null, 5, "", "relative/path", "/work/vibe\nhub"]) assert.equal(claude.launchFolder(bad, "-work-vibehub"), null);
    assert.equal(claude.launchFolder("/work/vibehub", null), null);
  });
});

describe("Claude: a cwd change mid-session never drops tokens or presence", () => {
  it("cd into subfolders: everything counts, on the launch project, still live", async () => {
    const dir = projectFor("/work/vibehub");
    const file = join(dir, "s-subdir.jsonl");
    fs.writeFileSync(file, "");
    const adapter = new claude.ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    fs.appendFileSync(file, turn("/work/vibehub", 1) + turn("/work/vibehub/server", 2) + turn("/work/vibehub/web/src", 3));
    const list = await adapter.poll();
    assert.equal(output(list), 6);
    assert.deepEqual(hints(list), ["vibehub"]);
    assert.equal(list.some((o) => o.late), false, "fresh activity stays presence");
    fs.appendFileSync(file, turn("/work/vibehub/server", 4));
    assert.equal(output(await adapter.poll()), 4, "and keeps counting on later polls");
  });

  it("cd outside the launch folder: still counted, project unchanged", async () => {
    const dir = projectFor("/work/api");
    const file = join(dir, "s-outside.jsonl");
    fs.writeFileSync(file, "");
    const adapter = new claude.ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    fs.appendFileSync(file, turn("/work/api", 1) + turn("/tmp/scratch", 5) + turn("/work/api/src", 2));
    const list = await adapter.poll();
    assert.equal(output(list), 8);
    assert.deepEqual(hints(list), ["api"]);
  });

  it("after a restart the first line read may already be in a subfolder", async () => {
    const dir = projectFor("/work/restarted");
    const file = join(dir, "s-restart.jsonl");
    fs.writeFileSync(file, turn("/work/restarted", 100));
    const adapter = new claude.ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    fs.appendFileSync(file, turn("/work/restarted/deep/dir", 7));
    const list = await adapter.poll();
    assert.equal(output(list), 7);
    assert.deepEqual(hints(list), ["restarted"]);
  });

  it("a dotted launch folder keeps its name", async () => {
    const dir = projectFor("/Users/me/my.app");
    const file = join(dir, "s-dotted.jsonl");
    fs.writeFileSync(file, "");
    const adapter = new claude.ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    fs.appendFileSync(file, turn("/Users/me/my.app/lib", 3));
    assert.deepEqual(hints(await adapter.poll()), ["my.app"]);
  });

  it("subagents resolve the same way, and fall back to the parent's project", async () => {
    const dir = projectFor("/work/agents");
    fs.writeFileSync(join(dir, "s-parent.jsonl"), "");
    fs.mkdirSync(join(dir, "s-parent", "subagents"), { recursive: true });
    const adapter = new claude.ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    fs.appendFileSync(join(dir, "s-parent.jsonl"), turn("/work/agents", 1));
    fs.writeFileSync(join(dir, "s-parent", "subagents", "agent-in.jsonl"), turn("/work/agents/pkg", 10));
    fs.writeFileSync(join(dir, "s-parent", "subagents", "agent-wt.jsonl"), turn("/tmp/worktrees/feature", 20));
    const list = await adapter.poll();
    assert.equal(output(list), 31);
    assert.deepEqual(hints(list), ["agents"]);
  });
});

describe("Codex: the first project a rollout names is kept", () => {
  it("a later turn in another folder (or with no cwd) still counts", async () => {
    const dir = join(sandbox, ".codex", "sessions", "2026", "09", "26");
    fs.mkdirSync(dir, { recursive: true });
    const file = join(dir, "rollout-cwdchange.jsonl");
    fs.writeFileSync(file, "");
    const adapter = new CodexAdapter(WINDOW);
    await adapter.poll();
    const at = () => new Date().toISOString();
    const context = (cwd?: string) => JSON.stringify({ type: "turn_context", timestamp: at(),
      payload: { ...(cwd ? { cwd } : {}), model: "gpt-6-sol" } }) + "\n";
    const count = (input: number, output: number) => JSON.stringify({ type: "event_msg", timestamp: at(),
      payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output } } } }) + "\n";
    fs.appendFileSync(file, context("/work/vibehub") + count(100, 10) + count(150, 20) +
      context("/work/other") + count(250, 35) + context() + count(300, 40));
    const list = (await adapter.poll()).filter((o) => o.usage.length);
    assert.equal(list.reduce((n, o) => n + o.tokensInputDelta, 0), 200);
    assert.equal(list.reduce((n, o) => n + o.tokensOutputDelta, 0), 30);
    assert.deepEqual(hints(list), ["vibehub"]);
    assert.equal(list.some((o) => o.late), false);
  });
});

describe("replay regression: the adapter total equals a plain de-duplicated sum", () => {
  it("mixed cwds, streamed duplicates, retries and a subagent sum exactly", async () => {
    const dir = projectFor("/work/replay");
    const session = join(dir, "s-replay.jsonl");
    fs.writeFileSync(session, "");
    fs.mkdirSync(join(dir, "s-replay", "subagents"), { recursive: true });
    const adapter = new claude.ClaudeCodeAdapter(WINDOW);
    await adapter.poll();
    const cwds = ["/work/replay", "/work/replay/server", "/tmp/x", "/work/replay/web/src", "/elsewhere"];
    const lines: string[] = [];
    const agentLines: string[] = [];
    let expected = 0;
    for (let i = 0; i < 60; i++) {
      const id = `msg_rep${i}`;
      const line = turn(cwds[i % cwds.length], 10 + i, { id, req: `req_rep${i}` });
      // Claude Code logs one line per content block with the same usage: count once.
      lines.push(line, line);
      expected += 10 + i;
      // Every 7th turn is also echoed into a subagent transcript: still once.
      if (i % 7 === 0) agentLines.push(line);
      // Every 11th turn is retried under a new request id: a second, real turn.
      if (i % 11 === 0) { lines.push(turn(cwds[(i + 2) % cwds.length], 3, { id, req: `req_retry${i}` })); expected += 3; }
    }
    fs.appendFileSync(session, lines.join(""));
    fs.writeFileSync(join(dir, "s-replay", "subagents", "agent-echo.jsonl"), agentLines.join(""));
    let counted = 0;
    for (let i = 0; i < 3; i++) counted += output(await adapter.poll());
    assert.equal(counted, expected);
  });
});
