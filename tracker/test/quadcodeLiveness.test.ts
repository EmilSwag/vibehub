// Round 4: Quadcode became a natively collected tool. These checks pin the two halves
// of that decision — what it now DOES report (activity, model) and what it still must
// never report (tokens, bodies, window/process presence). Pure: no host data, no
// fixture HOME and no live AI log is needed; the filesystem half lives in
// scripts/check-ai-only.mjs, which exercises the reader inside a sandboxed HOME.
import { strict as assert } from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { projectChatRecord, QuadcodeAdapter, estimateTokens, quadcodeRoot, stripToolResults, turnStartedAt } from "../src/adapters/quadcode";
import { ProcessAdapter, isRealWindowTitle, projectFromTitle } from "../src/adapters/processes";
import { isAttestedTool, isNativeTool, isSupportedTool, isTokenlessTool, projectUsage, safeModel } from "../src/privacy";

const BODY = "synthetic prompt / code / tool output, never evidence";
const HOME = path.resolve(path.join(path.sep, "fixture-home"));
const withinFixtureHome = (dir: string): boolean => !path.relative(HOME, dir).startsWith("..");
const NOW = Date.parse("2026-06-09T12:00:00.000Z");
const HOUR = 60 * 60_000;
/** Quadcode's own shape: local ISO, no zone, six-digit fraction. */
const localStamp = (ms: number): string => {
  const d = new Date(ms), p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}000`;
};
const llm = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "Agent", method: "LLM", message: BODY, timestamp: localStamp(NOW),
  is_status_message: false, variation_index: 0,
  variations: [{ model_name: "claude-fable-5-1", cluster_node_info: { id: 1 }, meta_info: { stop_reason: "end_turn", max_tokens: true } }],
  ...overrides,
});

describe("unsupported AI sources still fail closed", () => {
  it("generic process/editor presence is not a supported source", async () => {
    assert.deepEqual(await new ProcessAdapter(300000).poll(), []);
  });
  it("conversation length cannot produce invented token counts", () => {
    assert.equal(estimateTokens(BODY), 0);
  });
  it("retired content helpers do not retain or return raw prompt/tool output", () => {
    assert.equal(stripToolResults(BODY), "");
  });
  it("window titles cannot produce activity or a project alias", () => {
    assert.equal(isRealWindowTitle("Private project - Cursor"), false);
    assert.equal(projectFromTitle("Private project - Cursor", ["Cursor"]), null);
  });
  it("a Quadcode tree that does not exist yields nothing, and is not an error", async () => {
    assert.deepEqual(await new QuadcodeAdapter(300000, "/nonexistent-fixture-home").poll(NOW), []);
  });
});

describe("quadcode is native, receiver-eligible and permanently tokenless", () => {
  it("is collected natively AND may still arrive through the opt-in receiver", () => {
    assert.equal(isSupportedTool("quadcode"), true);
    assert.equal(isNativeTool("quadcode"), true);
    assert.equal(isAttestedTool("quadcode"), true);
  });
  it("never lets a producer speak for a natively-logged tool", () => {
    assert.equal(isAttestedTool("claude-code"), false);
    assert.equal(isAttestedTool("codex"), false);
  });
  it("has no token counter in any source, so usage is rejected rather than zeroed", () => {
    assert.equal(isTokenlessTool("quadcode"), true);
    assert.equal(isTokenlessTool("claude-code"), false);
    assert.equal(projectUsage({ tool: "quadcode", model: "claude-fable-5-1", tokensInputDelta: 40, tokensOutputDelta: 10 }), null);
    assert.equal(projectUsage({ tool: "quadcode", model: null, tokensInputDelta: 0, tokensOutputDelta: 0 }), null);
    assert.deepEqual(projectUsage({ tool: "codex", model: "gpt-5-codex", tokensInputDelta: 1, tokensOutputDelta: 2 }),
      { tool: "codex", model: "gpt-5-codex", tokensInputDelta: 1, tokensOutputDelta: 2 });
  });
  it("no model id was added on quadcode's behalf", () => {
    // Observed in the round-6 log sweep but absent from the reviewed catalogs, so
    // they stay unknown rather than becoming allowlist entries with no evidence.
    assert.equal(safeModel("grok-4.6", "quadcode"), null);
    assert.equal(safeModel("gemini-3.5-flash", "quadcode"), null);
    assert.equal(safeModel("claude-fable-5-1", "quadcode"), "claude-fable-5-1");
    assert.equal(safeModel("gpt-5-codex", "quadcode"), "gpt-5-codex");
  });
  // The PO layout names the base with %APPDATA% / $XDG_CONFIG_HOME. Honour it when it
  // is trustworthy; fail CLOSED when it is not - never ignore it, and never follow it
  // out of the home directory (a sandboxed child inherits the real profile is base).
  const ENV_BASE = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
  const withEnvBase = <T,>(value: string | undefined, run: () => T): T => {
    const previous = process.env[ENV_BASE];
    if (value === undefined) delete process.env[ENV_BASE];
    else process.env[ENV_BASE] = value;
    try { return run(); } finally {
      if (previous === undefined) delete process.env[ENV_BASE];
      else process.env[ENV_BASE] = previous;
    }
  };
  it("roots at the platform app-data directory, never at an arbitrary path", () => {
    // With no env base the root is the documented default, inside the home given.
    const root = withEnvBase(undefined, () => quadcodeRoot(HOME));
    assert.ok(root !== null && root.endsWith("QuadcodeAI"));
    assert.ok(root !== null && withinFixtureHome(root));
  });


  it("honours a custom in-home app-data base rather than silently ignoring it", (t) => {
    if (process.platform === "darwin") { t.skip("no env base in the documented macOS layout"); return; }
    const custom = path.join(HOME, "CustomAppData");
    assert.equal(withEnvBase(custom, () => quadcodeRoot(HOME)), path.join(custom, "QuadcodeAI"));
  });
  it("fails closed on an app-data base outside the home directory", (t) => {
    if (process.platform === "darwin") { t.skip("no env base in the documented macOS layout"); return; }
    assert.equal(withEnvBase(path.join(HOME, "..", "elsewhere"), () => quadcodeRoot(HOME)), null);
  });
  it("fails closed on a relative app-data base", (t) => {
    if (process.platform === "darwin") { t.skip("no env base in the documented macOS layout"); return; }
    assert.equal(withEnvBase("relative/app/data", () => quadcodeRoot(HOME)), null);
  });
  it("falls back to the documented default when no base is set", (t) => {
    if (process.platform === "darwin") { t.skip("no env base in the documented macOS layout"); return; }
    const expected = process.platform === "win32"
      ? path.join(HOME, "AppData", "Roaming", "QuadcodeAI")
      : path.join(HOME, ".config", "QuadcodeAI");
    assert.equal(withEnvBase(undefined, () => quadcodeRoot(HOME)), expected);
  });
});

describe("a Quadcode chat record only yields metadata, and only when it is a finished turn", () => {
  it("accepts a completed LLM turn and keeps only its model and variation", () => {
    const turn = projectChatRecord(llm(), NOW);
    assert.equal(turn?.model, "claude-fable-5-1");
    assert.equal(turn?.variation, 0);
    assert.equal(Object.hasOwn(turn ?? {}, "message"), false);
  });
  it("ignores a user request, a status line and a non-record", () => {
    assert.equal(projectChatRecord(llm({ method: "USER" }), NOW), null);
    assert.equal(projectChatRecord(llm({ is_status_message: true }), NOW), null);
    assert.equal(projectChatRecord("a string", NOW), null);
    assert.equal(projectChatRecord(null, NOW), null);
  });
  it("discards a turn whose start is more than a day old, however fresh the append", () => {
    assert.equal(projectChatRecord(llm({ timestamp: localStamp(NOW - 25 * HOUR) }), NOW), null);
    assert.ok(projectChatRecord(llm({ timestamp: localStamp(NOW - 23 * HOUR) }), NOW) !== null);
  });
  it("reads the record's own stamp as LOCAL text and refuses a zoned one", () => {
    // The field is documented as zoneless. A zoned value means this is not the record
    // shape we validated against, so it is rejected rather than reinterpreted.
    assert.equal(turnStartedAt("2026-06-09T12:00:00.000000Z"), null);
    assert.equal(turnStartedAt("2026-06-09T12:00:00.000+02:00"), null);
    assert.equal(turnStartedAt(""), null);
    assert.equal(turnStartedAt(42), null);
    assert.equal(turnStartedAt("2026-06-09T12:00:00.123456"), Date.parse("2026-06-09T12:00:00.123"));
  });
  it("keeps an unreviewed or missing model as null instead of inventing one", () => {
    assert.equal(projectChatRecord(llm({ variations: [{ model_name: "grok-4.6" }] }), NOW)?.model, null);
    assert.equal(projectChatRecord(llm({ variations: [] }), NOW)?.model, null);
    assert.equal(projectChatRecord(llm({ variations: [{ model_name: 42 }] }), NOW)?.model, null);
  });
  it("follows variation_index, and falls back to the first variation when it is junk", () => {
    const two = [{ model_name: "claude-opus-5" }, { model_name: "gpt-5-codex" }];
    assert.equal(projectChatRecord(llm({ variations: two, variation_index: 1 }), NOW)?.model, "gpt-5-codex");
    assert.equal(projectChatRecord(llm({ variations: two, variation_index: -1 }), NOW)?.model, "claude-opus-5");
    assert.equal(projectChatRecord(llm({ variations: two, variation_index: "1" }), NOW)?.model, "claude-opus-5");
  });
});
