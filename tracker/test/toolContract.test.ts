// Round 5 safety audit: the invariants that hold the three tool tables together, and the
// outgoing bounds that move when they grow.
//
// These are the assertions that would have caught the whole class of mistake this round
// could make: a tool that the receiver accepts but the wire refuses, a tool that becomes
// natively collectable by accident, a token counter appearing for something that has none,
// a model allowlist quietly widened to make a vendor's display id "work", or a heartbeat
// bound derived from a table that grew underneath it.
//
// Pure: `src/privacy.ts` imports nothing but types, so no HOME, file, process or network
// is involved and no sandbox is needed.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ATTESTED_TOOLS, isAttestedTool, isNativeTool, isSupportedTool, isTokenlessTool,
  MAX_USAGE_ENTRIES, NATIVE_TOOLS, projectHeartbeat, projectUsage, safeModel,
  SUPPORTED_TOOLS, TOKENLESS_TOOLS,
} from "../src/privacy";

const NOW = Date.parse("2026-06-09T12:00:00.000Z");
const ISO = "2026-06-09T11:59:30.000Z";
const beat = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventType: "heartbeat", projectAlias: "Demo", tool: "claude-code", model: "claude-opus-5",
  occurredAt: ISO, usage: [], ...overrides,
});

describe("tool tables: the unions are derived, not restated", () => {
  it("supported = native + the two hook tools, with no duplicates", () => {
    assert.deepEqual([...SUPPORTED_TOOLS], [...NATIVE_TOOLS, "cursor", "windsurf"]);
    assert.equal(new Set(SUPPORTED_TOOLS).size, SUPPORTED_TOOLS.length);
    assert.equal(SUPPORTED_TOOLS.length, 5);
  });

  it("every native and every receiver-eligible tool is reportable on the wire", () => {
    // The failure this prevents: a tool the receiver accepts but `projectHeartbeat`
    // drops, which would collect evidence and then silently never send it.
    for (const tool of [...NATIVE_TOOLS, ...ATTESTED_TOOLS]) {
      assert.equal(isSupportedTool(tool), true, `${tool} must be supported`);
    }
  });

  it("keeps Claude Code and Codex out of the receiver, and the hook tools out of native", () => {
    for (const tool of ["claude-code", "codex"]) {
      assert.equal(isNativeTool(tool), true);
      assert.equal(isAttestedTool(tool), false, `${tool} must never be assertable by a file`);
    }
    for (const tool of ["cursor", "windsurf"]) {
      assert.equal(isAttestedTool(tool), true);
      assert.equal(isNativeTool(tool), false, `${tool} must have no adapter in this repo`);
    }
    // Quadcode is the one deliberate overlap: collected natively AND consentable.
    assert.equal(isNativeTool("quadcode") && isAttestedTool("quadcode"), true);
  });

  it("makes every receiver-eligible tool tokenless, and no measuring tool tokenless", () => {
    for (const tool of ATTESTED_TOOLS) {
      assert.equal(isTokenlessTool(tool), true, `${tool} has no counter in any source`);
    }
    for (const tool of ["claude-code", "codex"]) assert.equal(isTokenlessTool(tool), false);
    assert.deepEqual([...TOKENLESS_TOOLS], [...ATTESTED_TOOLS]);
  });

  it("refuses everything outside the tables, in every predicate", () => {
    for (const tool of ["chatgpt", "vscode", "zed", "grok", "copilot", "Cursor", "cursor ",
      "", " ", "__proto__", null, undefined, 7, {}, ["cursor"]]) {
      assert.equal(isSupportedTool(tool), false, `${String(tool)} must not be supported`);
      assert.equal(isNativeTool(tool), false);
      assert.equal(isAttestedTool(tool), false);
      assert.equal(isTokenlessTool(tool), false);
    }
  });
});

describe("model allowlist: unchanged, and never widened for a hook tool", () => {
  it("gives the multi-model hosts the union of the reviewed catalogs and nothing more", () => {
    for (const tool of ["cursor", "windsurf", "quadcode"] as const) {
      assert.equal(safeModel("claude-opus-5", tool), "claude-opus-5");
      assert.equal(safeModel("gpt-5-codex", tool), "gpt-5-codex");
      // Vendor display ids, a competitor's id, and junk: all null, none added.
      for (const model of ["claude-4.5-sonnet", "claude-3.5-sonnet", "auto", "swe-1.5",
        "gpt-5-high", "grok-4.6", "gemini-3.5-flash", "o5", "", "claude-opus-5 ",
        "CLAUDE-OPUS-5", "__proto__", 5, null, undefined, {}]) {
        assert.equal(safeModel(model, tool), null, `${String(model)} must not be reported`);
      }
    }
  });

  it("keeps each measuring tool pinned to its own catalog", () => {
    // Cross-tool leakage would be the cheap way to "fix" an unknown model, and it would
    // attribute work to a vendor that never ran it.
    assert.equal(safeModel("gpt-5-codex", "claude-code"), null);
    assert.equal(safeModel("claude-opus-5", "codex"), null);
    assert.equal(safeModel("claude-opus-5", "claude-code"), "claude-opus-5");
    assert.equal(safeModel("gpt-5-codex", "codex"), "gpt-5-codex");
  });
});

describe("heartbeat bounds: derived from the tables, and still enforced", () => {
  it("accepts a hook tool as the reported activity", () => {
    for (const tool of ["cursor", "windsurf"]) {
      const projected = projectHeartbeat(beat({ tool }), NOW);
      assert.equal(projected?.tool, tool);
      // A tokenless primary with nothing measured omits the legacy sums entirely.
      assert.equal(Object.hasOwn(projected ?? {}, "tokensInputDelta"), false);
    }
    assert.equal(projectHeartbeat(beat({ tool: "chatgpt" }), NOW), null);
  });

  it("bounds the presence list at one entry per supported tool", () => {
    const entry = (tool: string): Record<string, unknown> => ({ tool, model: null, projectAlias: "Demo" });
    const five = [...SUPPORTED_TOOLS].map(entry);
    assert.equal(projectHeartbeat(beat({ tools: five }), NOW)?.tools?.length, 5);
    // One more than the table allows - rejected outright rather than truncated, so a
    // caller cannot pad the list with repeats to smuggle entries past the bound.
    assert.equal(projectHeartbeat(beat({ tools: [...five, entry("cursor")] }), NOW), null);
  });

  it("bounds usage entries and refuses the whole heartbeat past the limit", () => {
    const usage = (n: number): Record<string, unknown>[] => Array.from({ length: n }, (_, i) => ({
      tool: "claude-code", model: null, tokensInputDelta: i + 1, tokensOutputDelta: 0,
    }));
    assert.equal(MAX_USAGE_ENTRIES, 30);
    assert.ok(projectHeartbeat(beat({ usage: usage(MAX_USAGE_ENTRIES) }), NOW));
    assert.equal(projectHeartbeat(beat({ usage: usage(MAX_USAGE_ENTRIES + 1) }), NOW), null);
  });

  it("drops a usage entry for a tokenless tool instead of zeroing it", () => {
    for (const tool of TOKENLESS_TOOLS) {
      assert.equal(projectUsage({ tool, model: null, tokensInputDelta: 10, tokensOutputDelta: 2 }), null);
      assert.equal(projectUsage({ tool, model: null, tokensInputDelta: 0, tokensOutputDelta: 0 }), null);
      // ...and the heartbeat carrying it is refused whole, not quietly stripped.
      assert.equal(projectHeartbeat(beat({
        tool: "claude-code",
        usage: [{ tool, model: null, tokensInputDelta: 10, tokensOutputDelta: 2 }],
      }), NOW), null);
    }
    // A measuring tool may legitimately report a zero delta.
    assert.deepEqual(projectUsage({ tool: "codex", model: "gpt-5-codex", tokensInputDelta: 0, tokensOutputDelta: 0 }),
      { tool: "codex", model: "gpt-5-codex", tokensInputDelta: 0, tokensOutputDelta: 0 });
  });
});
