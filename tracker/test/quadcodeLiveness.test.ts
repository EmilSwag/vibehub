// Round 11, work item 3: Quadcode mid-turn liveness.
//
// Quadcode appends to its chat JSONL only at turn boundaries, so a long agent turn
// writes nothing and the adapter reported the turn's START as the last activity. The
// user went Idle on the site while the agent was working. `.quadcodeai/.data/
// file_versions/` gains an entry on every agent edit, so its directory mtime is the
// mid-turn signal - stat only, no recursion, no contents.
//
// QUADCODE_HOME points the adapter at a throwaway tree, so nothing here reads the real
// Quadcode data directory.

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const MINUTE = 60_000;
const WINDOW_MS = 6 * 60 * MINUTE;

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const setAt = (path: string, at: number): void => utimesSync(path, new Date(at), new Date(at));

interface Fixture {
  root: string;
  projectDir: string;
  chat: (name: string) => string;
  fileVersions: string;
}

/** A QUADCODE_HOME holding one project with the real directory shape. */
function fixture(project = "Vibemunity"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "vibehub-quadcode-"));
  roots.push(root);
  const projectDir = join(root, "apps", project);
  const sectionDir = join(projectDir, ".quadcodeai", ".data", "chats", "main.files");
  mkdirSync(sectionDir, { recursive: true });
  return {
    root,
    projectDir,
    chat: (name: string) => join(sectionDir, name),
    fileVersions: join(projectDir, ".quadcodeai", ".data", "file_versions"),
  };
}

/** Writes a chat log with one LLM record naming `model`, stamped at `at`. */
function writeChat(file: string, model: string, at: number): void {
  const record = {
    name: "Many",
    method: "LLM",
    message: "hello",
    timestamp: new Date(at).toISOString(),
    variations: [{ model_name: model }],
    variation_index: 0,
  };
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  setAt(file, at);
}

/** Loads the adapter with QUADCODE_HOME pointed at `root` (read in its constructor). */
function adapterFor(root: string) {
  process.env.QUADCODE_HOME = root;
  const { QuadcodeAdapter } = require("../src/adapters/quadcode") as typeof import("../src/adapters/quadcode");
  return new QuadcodeAdapter(WINDOW_MS);
}

describe("QuadcodeAdapter mid-turn liveness", () => {
  it("reports a live project even when its chat log has been silent for 40 minutes", async () => {
    const fx = fixture();
    const turnStartedAt = Date.now() - 40 * MINUTE;
    writeChat(fx.chat("chat_1.jsonl"), "claude-fable-5-1", turnStartedAt);
    // The agent has been editing files throughout the turn.
    mkdirSync(fx.fileVersions, { recursive: true });
    const lastEditAt = Date.now() - 30_000;
    setAt(fx.fileVersions, lastEditAt);

    const out = await adapterFor(fx.root).poll();
    assert.equal(out.length, 1);
    assert.equal(out[0].tool, "quadcode");
    assert.equal(out[0].confidence, "activity");
    assert.ok(
      Math.abs(out[0].lastActivityAt - lastEditAt) < 2000,
      `expected lastActivityAt near the edit (${lastEditAt}), got ${out[0].lastActivityAt}`,
    );
    // The identity still comes from the chat log.
    assert.equal(out[0].model, "claude-fable-5-1");
  });

  it("falls back to the chat mtime when there is no file_versions directory", async () => {
    const fx = fixture();
    const at = Date.now() - 5 * MINUTE;
    writeChat(fx.chat("chat_1.jsonl"), "claude-opus-5", at);

    const out = await adapterFor(fx.root).poll();
    assert.equal(out.length, 1);
    assert.ok(Math.abs(out[0].lastActivityAt - at) < 2000, `expected the chat mtime ${at}, got ${out[0].lastActivityAt}`);
  });

  it("never moves activity backwards: a stale file_versions loses to a fresh chat", async () => {
    const fx = fixture();
    const chatAt = Date.now() - MINUTE;
    writeChat(fx.chat("chat_1.jsonl"), "claude-opus-5", chatAt);
    mkdirSync(fx.fileVersions, { recursive: true });
    setAt(fx.fileVersions, Date.now() - 3 * 60 * MINUTE);

    const out = await adapterFor(fx.root).poll();
    assert.equal(out.length, 1);
    assert.ok(Math.abs(out[0].lastActivityAt - chatAt) < 2000, `expected the chat mtime ${chatAt}, got ${out[0].lastActivityAt}`);
  });

  it("bumps only the project's current chat, not every chat in it", async () => {
    const fx = fixture();
    const oldAt = Date.now() - 50 * MINUTE;
    const newerAt = Date.now() - 40 * MINUTE;
    writeChat(fx.chat("chat_1.jsonl"), "claude-opus-5", oldAt);
    writeChat(fx.chat("chat_2.jsonl"), "claude-fable-5-1", newerAt);
    mkdirSync(fx.fileVersions, { recursive: true });
    const lastEditAt = Date.now() - 10_000;
    setAt(fx.fileVersions, lastEditAt);

    const out = await adapterFor(fx.root).poll();
    assert.equal(out.length, 2);
    const byModel = new Map(out.map((o) => [o.model, o.lastActivityAt]));
    assert.ok(
      Math.abs((byModel.get("claude-fable-5-1") ?? 0) - lastEditAt) < 2000,
      "the newest chat should carry the liveness bump",
    );
    assert.ok(
      Math.abs((byModel.get("claude-opus-5") ?? 0) - oldAt) < 2000,
      "an older chat in the same project must keep its own mtime",
    );
  });

  it("keeps a project whose chat is older than the window alive while it is being edited", async () => {
    const fx = fixture();
    // Chat far outside recentWindowMs: without the bump this file is skipped entirely.
    writeChat(fx.chat("chat_1.jsonl"), "claude-fable-5-1", Date.now() - 12 * 60 * MINUTE);
    mkdirSync(fx.fileVersions, { recursive: true });
    const lastEditAt = Date.now() - 20_000;
    setAt(fx.fileVersions, lastEditAt);

    const out = await adapterFor(fx.root).poll();
    assert.equal(out.length, 1, "a live project must not be dropped because its chat is old");
    assert.ok(Math.abs(out[0].lastActivityAt - lastEditAt) < 2000);
  });
});
