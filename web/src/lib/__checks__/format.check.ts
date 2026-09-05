// Contract pins for lib/format.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/format.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).

import {
  elapsedShort,
  humanizeModel,
  modelFamily,
  modelWithTool,
  presenceLine,
  presenceParts,
  presenceStatusLabel,
  toolFamily,
  toolLabel,
} from "../format";

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} → ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

// ---- humanizeModel: every example from the shared contract ----
const MODELS: [string | null | undefined, string | null][] = [
  ["claude-fable-5-1", "Claude Fable 5.1"],
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-opus-4-8", "Claude Opus 4.8"],
  ["claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"],
  ["claude-sonnet-4.5", "Claude Sonnet 4.5"],
  ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
  ["sonnet", "Claude Sonnet"],
  ["opus", "Claude Opus"],
  ["haiku", "Claude Haiku"],
  ["gpt-5-codex", "GPT-5 Codex"],
  ["gpt-4.1", "GPT-4.1"],
  ["gpt-4o-mini", "GPT-4o Mini"],
  ["o4-mini", "o4-mini"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite"],
  ["grok-4", "Grok 4"],
  ["grok", "Grok"],
  [null, null],
  [undefined, null],
  ["", null],
  ["unknown", null],
  ["<synthetic>", null],
  // beyond the contract: shapes the tracker has actually seen or will see
  ["claude-opus-4-1-20250805", "Claude Opus 4.1"],
  ["claude-sonnet-4-20250514", "Claude Sonnet 4"],
  ["claude-3-5-sonnet-20241022", "Claude Sonnet 3.5"],
  ["claude-3-7-sonnet-latest", "Claude Sonnet 3.7"],
  ["claude-sonnet-4-5-20250929[1m]", "Claude Sonnet 4.5"],
  ["anthropic/claude-fable-5-1", "Claude Fable 5.1"],
  ["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "Claude Sonnet 4.5"],
  ["claude-sonnet-4-5@20250929", "Claude Sonnet 4.5"],
  ["claude", "Claude"],
  ["Claude-Fable-5-1", "Claude Fable 5.1"],
  ["gpt-4o-2024-08-06", "GPT-4o"],
  ["gpt-5", "GPT-5"],
  ["gpt-3.5-turbo", "GPT-3.5 Turbo"],
  ["openai/gpt-5-codex", "GPT-5 Codex"],
  ["o3", "o3"],
  ["chatgpt-4o-latest", "ChatGPT-4o"],
  ["gemini-1.5-pro-002", "Gemini 1.5 Pro"],
  ["gemini", "Gemini"],
  ["grok-4-0709", "Grok 4"],
  ["grok-3-mini", "Grok 3 Mini"],
  ["deepseek-r1", "Deepseek R1"],
  ["DeepSeek-R1", "DeepSeek R1"],
  ["  UNKNOWN  ", null],
  // round 6: every model the Quadcode adapter has actually seen in a chat log
  // (plan Amendment 1 — 7 distinct values across 341 LLM records).
  ["claude-fable-5", "Claude Fable 5"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash"],
  ["grok-4.6", "Grok 4.6"],
];
for (const [raw, expected] of MODELS) eq(`humanizeModel(${JSON.stringify(raw)})`, humanizeModel(raw), expected);

// ---- modelFamily ----
eq("modelFamily(claude-fable-5-1)", modelFamily("claude-fable-5-1"), "claude");
eq("modelFamily(sonnet)", modelFamily("sonnet"), "claude");
eq("modelFamily(gpt-5-codex)", modelFamily("gpt-5-codex"), "gpt");
eq("modelFamily(o4-mini)", modelFamily("o4-mini"), "gpt");
eq("modelFamily(gemini-2.5-pro)", modelFamily("gemini-2.5-pro"), "gemini");
eq("modelFamily(grok-4)", modelFamily("grok-4"), "grok");
eq("modelFamily(unknown)", modelFamily("unknown"), "unknown");
eq("modelFamily(null)", modelFamily(null), "unknown");
eq("modelFamily(<synthetic>)", modelFamily("<synthetic>"), "unknown");
// tools are no longer model families
eq("modelFamily(cursor)", modelFamily("cursor"), "unknown");
eq("modelFamily(codex)", modelFamily("codex"), "unknown");
eq("modelFamily(quadcode)", modelFamily("quadcode"), "unknown");

// ---- toolLabel / toolFamily ----
const TOOLS: [string | null | undefined, string][] = [
  ["claude-code", "Claude Code"],
  ["claude_code", "Claude Code"],
  ["codex", "Codex CLI"],
  ["cursor", "Cursor"],
  ["vscode", "VS Code"],
  ["windsurf", "Windsurf"],
  ["zed", "Zed"],
  ["quadcode", "Quadcode AI"],
  ["chatgpt", "ChatGPT"],
  ["grok", "Grok"],
  ["unknown", "Unknown tool"],
  ["", "Unknown tool"],
  [null, "Unknown tool"],
  [undefined, "Unknown tool"],
  ["Claude-Code", "Claude Code"],
  ["visual-studio-code", "VS Code"],
  ["code", "VS Code"],
  ["genui", "Quadcode AI"],
  ["quadcode ai", "Quadcode AI"],
  ["my-tool", "My Tool"],
];
for (const [raw, expected] of TOOLS) eq(`toolLabel(${JSON.stringify(raw)})`, toolLabel(raw), expected);
eq("toolFamily(claude_code)", toolFamily("claude_code"), "claude-code");
eq("toolFamily(vscode)", toolFamily("vscode"), "vscode");
eq("toolFamily(my-tool)", toolFamily("my-tool"), "unknown");
eq("toolFamily(null)", toolFamily(null), "unknown");

// Every tool id the tracker actually emits (tracker/src/adapters/processes.ts RULES)
// must land on its own family — a family is what carries the glyph, so anything
// falling through to "unknown" here renders as a nameless dot in presence.
const TRACKER_TOOL_IDS = [
  "claude-code",
  "codex",
  "cursor",
  "vscode",
  "windsurf",
  "zed",
  "quadcode",
  "chatgpt",
  "grok",
] as const;
for (const id of TRACKER_TOOL_IDS) eq(`toolFamily(${id})`, toolFamily(id), id);
// …including the process names those rules match on.
eq("toolFamily(genui)", toolFamily("genui"), "quadcode");
eq("toolFamily(quadcode ai)", toolFamily("quadcode ai"), "quadcode");
eq("toolFamily(code)", toolFamily("code"), "vscode");

// ---- modelWithTool ----
eq("modelWithTool(claude-fable-5-1, claude-code)", modelWithTool("claude-fable-5-1", "claude-code"), "Claude Fable 5.1 · Claude Code");
eq("modelWithTool(gpt-5-codex, codex)", modelWithTool("gpt-5-codex", "codex"), "GPT-5 Codex · Codex CLI");
eq("modelWithTool(null, cursor)", modelWithTool(null, "cursor"), "Cursor");
eq("modelWithTool(unknown, quadcode)", modelWithTool("unknown", "quadcode"), "Quadcode AI");
// Round 6: `grok-4.6` is a *model under Quadcode*, distinct from the `grok` tool —
// the pair needs no special case (plan Amendment 1).
eq("modelWithTool(grok-4.6, quadcode)", modelWithTool("grok-4.6", "quadcode"), "Grok 4.6 · Quadcode AI");
eq("modelWithTool(null, grok)", modelWithTool(null, "grok"), "Grok");
eq("modelWithTool(<synthetic>, claude-code)", modelWithTool("<synthetic>", "claude-code"), "Claude Code");

// ---- elapsedShort (fixed `now`) ----
const NOW = Date.parse("2026-09-04T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
eq("elapsedShort(0s)", elapsedShort(ago(0), NOW), "just now");
eq("elapsedShort(59s)", elapsedShort(ago(59_000), NOW), "just now");
eq("elapsedShort(60s)", elapsedShort(ago(60_000), NOW), "1m");
eq("elapsedShort(12m)", elapsedShort(ago(12 * 60_000), NOW), "12m");
eq("elapsedShort(1h42m)", elapsedShort(ago(102 * 60_000), NOW), "1h 42m");
eq("elapsedShort(3h0m)", elapsedShort(ago(180 * 60_000), NOW), "3h 0m");
eq("elapsedShort(future)", elapsedShort(new Date(NOW + 60_000).toISOString(), NOW), "just now");
eq("elapsedShort(invalid)", elapsedShort("not-a-date", NOW), "just now");

// ---- presenceParts / presenceLine ----
const activity = { projectAlias: "vibehub", tool: "claude-code", model: "claude-fable-5-1", startedAt: ago(102 * 60_000) };
eq("presenceParts(active)", presenceParts(activity, NOW), {
  project: "vibehub",
  tool: "Claude Code",
  model: "Claude Fable 5.1",
  elapsed: "1h 42m",
});
eq("presenceLine(active)", presenceLine(activity, NOW), "vibehub · Claude Code · Claude Fable 5.1 · 1h 42m");

const noModel = { projectAlias: "neon-app", tool: "cursor", model: null, startedAt: ago(5 * 60_000) };
eq("presenceParts(no model)", presenceParts(noModel, NOW), { project: "neon-app", tool: "Cursor", model: null, elapsed: "5m" });
eq("presenceLine(no model)", presenceLine(noModel, NOW), "neon-app · Cursor · 5m");

const synthetic = { projectAlias: "vibehub", tool: "claude_code", model: "<synthetic>", startedAt: ago(30_000) };
eq("presenceLine(synthetic model, snake tool)", presenceLine(synthetic, NOW), "vibehub · Claude Code · just now");

const modelless = { projectAlias: "vibehub", tool: "quadcode", startedAt: ago(60_000) };
eq("presenceLine(model field absent)", presenceLine(modelless, NOW), "vibehub · Quadcode AI · 1m");

// ---- presenceStatusLabel ----
eq("presenceStatusLabel(active)", presenceStatusLabel("active"), "Online");
eq("presenceStatusLabel(idle)", presenceStatusLabel("idle"), "Idle");
eq("presenceStatusLabel(offline)", presenceStatusLabel("offline"), "Offline");
eq("presenceStatusLabel(undefined)", presenceStatusLabel(undefined), "Offline");

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`format.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
