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

import { isTokenlessTool, TOKENLESS_TOOLS, usageEntrySchema } from "../schemas";

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

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`quadcodeUsage.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
