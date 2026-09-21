// The five-tool table is the single source of truth for what VibeHub tracks, so it
// gets pinned in two directions:
//
//   1. AGAINST THE SERVER. `server/src/lib/tools.ts` decides which tools may never
//      have a token count attributed to them; the client decides how those tools are
//      rendered. Two copies of one list drift — that is exactly how the client ended
//      up printing "0 tokens" for a Cursor day after the server had already accepted
//      Cursor and Windsurf as tokenless. This check makes that drift impossible.
//   2. AGAINST THE COPY. Every tool in the table has to appear in the support line,
//      so adding a sixth tool cannot silently ship with copy that names five.
//
// Synthetic, pure, no network, no account, no tracker, nothing outside web/ written.
// Run with the existing runner:  node scripts/run-checks.mjs supportedTools
import { createRequire } from "node:module";
import {
  UNTRACKED_TOOLS,
  untrackedClause,
  HOOK_TOOLS,
  HOOK_TOOL_IDS,
  LEGACY_ESTIMATE_TOOLS,
  LOG_TOOLS,
  MEASURED_TOOLS,
  SUPPORTED_TOOLS,
  TOKENLESS_TOOLS,
  TOKENS_NOT_REPORTED,
  TOKENS_NOT_REPORTED_TITLE,
  isHookToolId,
  isLegacyEstimateTool,
  isTokenlessTool,
  namesOf,
  qualifiedNamesOf,
} from "../supportedTools";
import {
  DEVICE_CONNECT_SCOPE,
  HOOKS_CLI_REQUIREMENT,
  HOOKS_DRY_RUN,
  HOOKS_REPORTS,
  HOOKS_REVERSIBLE,
  HOOKS_SCOPE,
  HOOKS_TITLE,
  HOOKS_WRITES,
  TRACKER_LOCAL_READS,
  TRACKER_SUPPORT_NOTICE,
} from "../connectPrompt";

// The server package is CommonJS; require() through tsx hands back its exports
// directly, typed against the server source itself — the same read-only bridge
// `tokenPricingSync.check.ts` already uses for the price table.
const server = createRequire(import.meta.url)("../../../../server/src/lib/tools.ts") as typeof import("../../../../server/src/lib/tools");

let passed = 0;
const failures: string[] = [];
function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`); }
}
const ok = (label: string, condition: boolean) => eq(label, condition, true);

// ---- 1. the tokenless set is the server's, exactly ----
eq("web and server agree on which tools report no tokens",
  TOKENLESS_TOOLS.map((tool) => tool.id).slice().sort(),
  [...server.TOKENLESS_TOOLS].slice().sort());
eq("the set is the three the hooks report names",
  TOKENLESS_TOOLS.map((tool) => tool.id).slice().sort(), ["cursor", "quadcode", "windsurf"]);
for (const id of server.TOKENLESS_TOOLS) {
  ok(`server-tokenless "${id}" is tokenless on the client too`, isTokenlessTool(id));
}
for (const tool of SUPPORTED_TOOLS) {
  eq(`"${tool.id}": client and server agree`, isTokenlessTool(tool.id), server.isTokenlessTool(tool.id));
}
// The client folds aliases through `toolFamily`; the server matches raw ids. The
// client must therefore be the WIDER of the two — an alias that resolves to a
// tokenless family must never slip through as measured.
eq("aliases of a tokenless tool are tokenless too",
  ["genui", "Cursor", "WINDSURF", "quadcode"].map(isTokenlessTool), [true, true, true, true]);
eq("a measuring tool stays measured through its aliases",
  ["claude-code", "claude_code", "codex", "code"].map(isTokenlessTool), [false, false, false, false]);

// ---- 2. the table's own invariants ----
eq("five supported tools, no more", SUPPORTED_TOOLS.length, 5);
eq("ids are unique", new Set(SUPPORTED_TOOLS.map((tool) => tool.id)).size, SUPPORTED_TOOLS.length);
eq("measured and tokenless partition the table", MEASURED_TOOLS.length + TOKENLESS_TOOLS.length, SUPPORTED_TOOLS.length);
eq("log and hook feeds partition the table", LOG_TOOLS.length + HOOK_TOOLS.length, SUPPORTED_TOOLS.length);
ok("every hook tool is tokenless — neither vendor reports a count",
  HOOK_TOOLS.length > 0 && HOOK_TOOLS.every((tool) => !tool.measuresTokens));
ok("every legacy-estimate tool is tokenless, and they are not the whole set",
  LEGACY_ESTIMATE_TOOLS.every((tool) => !tool.measuresTokens) && LEGACY_ESTIMATE_TOOLS.length < TOKENLESS_TOOLS.length);
ok("no hook tool claims a legacy estimate — their records carry no counts at all",
  HOOK_TOOLS.every((tool) => !tool.hasLegacyEstimate));
ok("only a hook tool names a hook file",
  SUPPORTED_TOOLS.every((tool) => (tool.hookFile !== null) === (tool.feed === "hook")));
eq("hook files are the two user-scope paths the vendors document",
  HOOK_TOOLS.map((tool) => tool.hookFile), ["~/.cursor/hooks.json", "~/.codeium/windsurf/hooks.json"]);
ok("every hook file is under the user's own home, never a shared or system path",
  HOOK_TOOLS.every((tool) => {
    const path = tool.hookFile ?? "";
    return path.startsWith("~/") && !["ProgramData", "/etc/", "/Library/", ".."].some((bad) => path.includes(bad));
  }));
eq("hook ids are exactly the hook feeds", [...HOOK_TOOL_IDS], HOOK_TOOLS.map((tool) => tool.id));
eq("isHookToolId accepts only those two",
  ["cursor", "windsurf", "claude-code", "codex", "quadcode", "", "CURSOR", "cursor; id"].map(isHookToolId),
  [true, true, false, false, false, false, false, false]);
eq("isLegacyEstimateTool is a strict subset of isTokenlessTool",
  SUPPORTED_TOOLS.filter((tool) => isLegacyEstimateTool(tool.id)).map((tool) => tool.id), ["quadcode"]);

// ---- 3. the copy is derived, never transcribed ----
eq("serial joins read the way this product's copy already does",
  [namesOf(MEASURED_TOOLS), namesOf(TOKENLESS_TOOLS), namesOf(HOOK_TOOLS), qualifiedNamesOf(MEASURED_TOOLS)],
  ["Claude Code and Codex", "Quadcode AI, Cursor and Windsurf", "Cursor and Windsurf", "Claude Code and Codex (GPT models)"]);
for (const tool of SUPPORTED_TOOLS) {
  ok(`the support line names ${tool.copyName}`, TRACKER_SUPPORT_NOTICE.includes(tool.copyName));
  ok(`the local-reads disclosure accounts for ${tool.copyName}`, TRACKER_LOCAL_READS.includes(tool.copyName));
}
for (const tool of HOOK_TOOLS) {
  ok(`${tool.copyName} is named in the one-connection scope`, DEVICE_CONNECT_SCOPE.includes(tool.copyName));
  ok(`${tool.copyName} is named in the opt-in block`, HOOKS_TITLE.includes(tool.copyName) && HOOKS_SCOPE.includes(tool.copyName));
  ok(`${tool.copyName}'s hook file is shown before anything is written`, HOOKS_WRITES.includes(tool.hookFile ?? "\u0000"));
}

// A product named as NOT tracked is named from the table too, with its reason, so
// the support line still contains no tool name typed in by hand.
eq("exactly one product is named as untracked, with a reason",
  UNTRACKED_TOOLS.map((tool) => [tool.copyName, tool.reason]), [["ChatGPT", "browser and app leave no local source to read"]]);
ok("an untracked product is not also in the supported table",
  UNTRACKED_TOOLS.every((tool) => !SUPPORTED_TOOLS.some((s) => s.copyName === tool.copyName)));
eq("the untracked clause is what the support line ends with", untrackedClause(), "ChatGPT is not tracked: browser and app leave no local source to read.");
ok("the support line ends with that clause verbatim", TRACKER_SUPPORT_NOTICE.endsWith(untrackedClause()));
ok("no supported tool is described as untracked",
  SUPPORTED_TOOLS.every((tool) => !TRACKER_SUPPORT_NOTICE.includes(`${tool.copyName} is not tracked`)));
ok("the hook tools' model promise is qualified, never absolute",
  TRACKER_SUPPORT_NOTICE.includes("show a model only when VibeHub recognises the id") &&
  !/always shows the model|shows the model\b/i.test(TRACKER_SUPPORT_NOTICE));

// ---- 4. the opt-in block's load-bearing promises ----
ok("the opt-in is marked optional", HOOKS_TITLE.includes("(optional)"));
ok("a hook turn is stated to carry no tokens and no cost", HOOKS_REPORTS.includes("No tokens, no cost estimate"));
ok("a hook turn is stated to usually carry no project", HOOKS_REPORTS.includes("usually no project"));
ok("shared project and system-wide hook files are ruled out in writing",
  HOOKS_WRITES.includes("Shared project and system-wide hook files are never touched."));
ok("preview writes nothing, and says so", HOOKS_DRY_RUN.includes("writes nothing"));
ok("removal withdraws consent, not just the file entry", HOOKS_REVERSIBLE.includes("withdraws consent"));
// TWO release dependencies stand between this panel and a working command: nothing
// puts `vibehub-tracker` on PATH (measured: no shim in connect.sh or connect.ps1),
// and the served bundle predates `hooks` (hooks report F4). Naming only the second
// would read as "you are nearly there", so both are pinned — along with the absence
// of any promised fix, which this lane is not allowed to deliver.
ok("both of today's failure modes are named", HOOKS_CLI_REQUIREMENT.includes("command not found") &&
  HOOKS_CLI_REQUIREMENT.includes("unknown-command error"));
ok("the PATH gap is stated as the installer's, not the reader's, to close",
  HOOKS_CLI_REQUIREMENT.includes("from your PATH") && HOOKS_CLI_REQUIREMENT.includes("does not put it there"));
ok("the copy never implies a normal connector install makes these runnable",
  !/updat|upgrad|reinstall|simply|just |should work|once installed/i.test(HOOKS_CLI_REQUIREMENT));
ok("no workaround or installer instruction is smuggled into the note",
  !/npx|sudo|ln -s|export PATH|alias |chmod/i.test(HOOKS_CLI_REQUIREMENT));

// ---- 5. the unmeasured phrase is one string, used everywhere ----
eq("the unmeasured phrase never reads as a measured zero", TOKENS_NOT_REPORTED, "tokens not reported");
ok("the phrase contains no digit", !/[0-9]/.test(TOKENS_NOT_REPORTED));
for (const tool of TOKENLESS_TOOLS) {
  ok(`the explanation names ${tool.copyName}`, TOKENS_NOT_REPORTED_TITLE.includes(tool.copyName));
}
ok("the explanation keeps the legacy caveat to the one tool it applies to",
  TOKENS_NOT_REPORTED_TITLE.includes(`Older ${namesOf(LEGACY_ESTIMATE_TOOLS)} figures are legacy estimates.`));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`supportedTools check failed: ${failures.join(", ")}`);
