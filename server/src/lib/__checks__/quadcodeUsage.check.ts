// Contract pins for the server-side rejection of claimed Quadcode usage.
// Run from the repo root:  npx tsx server/src/lib/__checks__/quadcodeUsage.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.
//
// Fixtures only: this imports the zod schema and the tool table, nothing else. No
// database, no Prisma client, no network, no environment and no personal file is
// touched - schemas.ts depends on zod and two pure local modules, which is why this
// can be pinned without standing anything up.
//
// Why the rejection exists: Quadcode is collected natively for activity and model, but
// its chat format carries no token counter anywhere (`meta_info.max_tokens` is a
// boolean flag, `cluster_node_info` is a node id). A usage entry naming it is wrong by
// construction, whoever sent it. It is REJECTED rather than zeroed, because a stored 0
// would be read back as "a measurement was taken and it was empty" - a different, and
// false, claim from "not measured".

import { heartbeatSchema, isTokenlessTool, TOKENLESS_TOOLS, usageEntrySchema } from "../schemas";

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} -> ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tool: "quadcode",
  model: "claude-fable-5-1",
  tokensInputDelta: 391,
  tokensOutputDelta: 120,
  ...overrides,
});

// ---- the tool table ----
eq("quadcode is tokenless", isTokenlessTool("quadcode"), true);
// Round 5: Cursor and Windsurf are collected through their own hook systems, which
// report a model and a turn boundary and no token counter whatsoever. Same rule, same
// table - and it must stay identical to the tracker's, or the API would accept a count
// the tracker itself refuses to send.
eq("cursor is tokenless", isTokenlessTool("cursor"), true);
eq("windsurf is tokenless", isTokenlessTool("windsurf"), true);
eq("claude-code is not tokenless", isTokenlessTool("claude-code"), false);
eq("codex is not tokenless", isTokenlessTool("codex"), false);
eq("an absent tool is not tokenless", isTokenlessTool(undefined), false);
eq("a null tool is not tokenless", isTokenlessTool(null), false);
eq("the tokenless table is exactly quadcode, cursor and windsurf",
  [...TOKENLESS_TOOLS], ["quadcode", "cursor", "windsurf"]);

// ---- the rejection ----
eq("a claimed Quadcode usage entry is rejected", usageEntrySchema.safeParse(entry()).success, false);
eq("zeroed Quadcode usage is rejected too, not accepted as a measurement",
  usageEntrySchema.safeParse(entry({ tokensInputDelta: 0, tokensOutputDelta: 0 })).success, false);
eq("a Quadcode entry marked estimated is rejected",
  usageEntrySchema.safeParse(entry({ estimated: true })).success, false);
eq("a Quadcode entry with no model is still rejected",
  usageEntrySchema.safeParse(entry({ model: null })).success, false);
eq("the rejection is reported against the tool field",
  usageEntrySchema.safeParse(entry()).error?.issues[0]?.path, ["tool"]);

// ---- the same rejection covers the hook tools ----
for (const tool of ["cursor", "windsurf"]) {
  eq(`a claimed ${tool} usage entry is rejected`,
    usageEntrySchema.safeParse(entry({ tool, model: "claude-opus-5" })).success, false);
  eq(`a zeroed ${tool} usage entry is rejected too`,
    usageEntrySchema.safeParse(entry({ tool, tokensInputDelta: 0, tokensOutputDelta: 0 })).success, false);
  eq(`the ${tool} rejection is reported against the tool field`,
    usageEntrySchema.safeParse(entry({ tool })).error?.issues[0]?.path, ["tool"]);
}

// ---- tools that DO measure are unaffected ----
eq("a Codex usage entry is accepted", usageEntrySchema.safeParse(entry({ tool: "codex", model: "gpt-5-codex" })).success, true);
eq("a Claude Code usage entry is accepted",
  usageEntrySchema.safeParse(entry({ tool: "claude-code", model: "claude-opus-5" })).success, true);
eq("a measuring tool may legitimately report a zero delta",
  usageEntrySchema.safeParse(entry({ tool: "codex", model: "gpt-5-codex", tokensInputDelta: 0, tokensOutputDelta: 0 })).success, true);
eq("shape validation still applies to accepted tools",
  usageEntrySchema.safeParse(entry({ tool: "codex", tokensInputDelta: -1 })).success, false);

// ---- the legacy top-level pair (Round 6, F-E) ----
// Production verification forged `tokensInputDelta: 700000` / `tokensOutputDelta: 300000`
// with `tool: "cursor"` straight onto POST /tracker/heartbeat. It answered 200, attributed
// 1,333,348 tokens and $17.11 to a tokenless pair of tools, and lifted the account from
// level 1 to 4 - because the refusal lived on `usage[]` alone and this path had no tool
// guard at all. The two paths now share one predicate, so the guarantee is a property of
// the wire rather than of one validator.
const beat = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventType: "heartbeat",
  projectAlias: "neon-app",
  tool: "cursor",
  model: "claude-opus-5",
  occurredAt: "2026-09-21T10:00:00.000Z",
  ...overrides,
});

for (const tool of TOKENLESS_TOOLS) {
  eq(`a forged top-level input delta for ${tool} is refused`,
    heartbeatSchema.safeParse(beat({ tool, tokensInputDelta: 700000 })).success, false);
  eq(`a forged top-level output delta for ${tool} is refused`,
    heartbeatSchema.safeParse(beat({ tool, tokensOutputDelta: 300000 })).success, false);
  eq(`the ${tool} refusal names the field that carried the claim`,
    heartbeatSchema.safeParse(beat({ tool, tokensInputDelta: 1 })).error?.issues[0]?.path,
    ["tokensInputDelta"]);
  // Wire compatibility: a legacy tracker spells the pair on every heartbeat. Refusing a
  // zero would cost that device its presence over a field that attributes nothing, so
  // only a positive number counts as a claim.
  eq(`an explicit zero pair from ${tool} still keeps its presence`,
    heartbeatSchema.safeParse(beat({ tool, tokensInputDelta: 0, tokensOutputDelta: 0 })).success, true);
  eq(`an omitted pair from ${tool} is fine`, heartbeatSchema.safeParse(beat({ tool })).success, true);
}

eq("a measuring tool may still report top-level deltas",
  heartbeatSchema.safeParse(beat({ tool: "claude-code", tokensInputDelta: 10, tokensOutputDelta: 5 })).success, true);
eq("codex may still report top-level deltas",
  heartbeatSchema.safeParse(beat({ tool: "codex", model: "gpt-5-codex", tokensInputDelta: 4242 })).success, true);
// A body with no tool at all predates per-tool attribution; it is not a tokenless claim.
eq("a toolless legacy body is unaffected",
  heartbeatSchema.safeParse(beat({ tool: undefined, tokensInputDelta: 99 })).success, true);
// Both wire paths refuse with the same words, so a client cannot tell them apart.
eq("both paths refuse with one message",
  heartbeatSchema.safeParse(beat({ tool: "cursor", tokensInputDelta: 1 })).error?.issues[0]?.message,
  usageEntrySchema.safeParse(entry({ tool: "cursor" })).error?.issues[0]?.message);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`quadcodeUsage.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
