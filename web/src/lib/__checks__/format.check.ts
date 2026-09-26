// Contract pins for lib/format.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/format.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).

import {
  clampWords,
  formatCount,
  daysSince,
  elapsedShort,
  humanizeModel,
  modelFamily,
  modelWithTool,
  presenceLine,
  presenceParts,
  presenceStatusLabel,
  relativeDay,
  toolFamily,
  toolLabel,
  updatedLabel,
  projectLabel,
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
  ["claude-fable-5-1", "Fable 5.1"],
  ["claude-opus-5", "Opus 5"],
  ["claude-opus-4-8", "Opus 4.8"],
  ["claude-sonnet-4-5-20250929", "Sonnet 4.5"],
  ["claude-sonnet-4.5", "Sonnet 4.5"],
  ["claude-haiku-4-5-20251001", "Haiku 4.5"],
  ["sonnet", "Sonnet"],
  ["opus", "Opus"],
  ["haiku", "Haiku"],
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
  ["claude-opus-4-1-20250805", "Opus 4.1"],
  ["claude-sonnet-4-20250514", "Sonnet 4"],
  ["claude-3-5-sonnet-20241022", "Sonnet 3.5"],
  ["claude-3-7-sonnet-latest", "Sonnet 3.7"],
  ["claude-sonnet-4-5-20250929[1m]", "Sonnet 4.5"],
  ["anthropic/claude-fable-5-1", "Fable 5.1"],
  ["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "Sonnet 4.5"],
  ["claude-sonnet-4-5@20250929", "Sonnet 4.5"],
  ["claude", "Claude"],
  ["Claude-Fable-5-1", "Fable 5.1"],
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
  ["claude-fable-5", "Fable 5"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash"],
  ["grok-4.6", "Grok 4.6"],
  // round 9: human-cased names with spaces (Cursor reports these) — seen live as
  // "Claude Claude sonnet 5" in the connect modal before the fix.
  ["Claude Sonnet 5", "Sonnet 5"],
  ["Claude Sonnet 4.5", "Sonnet 4.5"],
  ["GPT 5 Codex", "GPT-5 Codex"],
  ["Gemini 2.5 Pro", "Gemini 2.5 Pro"],
  ["Grok 4", "Grok 4"],
  // QA R1 (2026-09-26): models released after the tracker allowlist — never "null".
  ["claude-opus-5-5", "Opus 5.5"],
  ["claude-opus-5-5[1m]", "Opus 5.5"],
  ["claude-fable-5-1", "Fable 5.1"],
  ["claude-sonnet-5", "Sonnet 5"],
  ["gpt-6-sol", "GPT-6 Sol"],
  ["gpt-6-luna", "GPT-6 Luna"],
  ["gpt-5.6-terra", "GPT-5.6 Terra"],
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
eq("modelWithTool(claude-fable-5-1, claude-code)", modelWithTool("claude-fable-5-1", "claude-code"), "Fable 5.1 · Claude Code");
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
  model: "Fable 5.1",
  elapsed: "1h 42m",
});
eq("presenceLine(active)", presenceLine(activity, NOW), "vibehub · Claude Code · Fable 5.1 · 1h 42m");

const noModel = { projectAlias: "neon-app", tool: "cursor", model: null, startedAt: ago(5 * 60_000) };
eq("presenceParts(no model)", presenceParts(noModel, NOW), { project: "neon-app", tool: "Cursor", model: null, elapsed: "5m" });
eq("presenceLine(no model)", presenceLine(noModel, NOW), "neon-app · Cursor · 5m");

const synthetic = { projectAlias: "vibehub", tool: "claude_code", model: "<synthetic>", startedAt: ago(30_000) };
eq("presenceLine(synthetic model, snake tool)", presenceLine(synthetic, NOW), "vibehub · Claude Code · just now");

const modelless = { projectAlias: "vibehub", tool: "quadcode", startedAt: ago(60_000) };
eq("presenceLine(model field absent)", presenceLine(modelless, NOW), "vibehub · Quadcode AI · 1m");

// ---- daysSince with an injected `now` (added for lib/lastOnline.ts to reuse
// directly; the no-arg, Date.now()-based call sites elsewhere are unaffected) ----
eq("daysSince(now, injected)", daysSince(ago(0), NOW), 0);
eq("daysSince(23h59m, injected)", daysSince(ago(23 * 60 * 60_000 + 59 * 60_000), NOW), 0);
eq("daysSince(exactly 1d, injected)", daysSince(ago(24 * 60 * 60_000), NOW), 1);
eq("daysSince(3d, injected)", daysSince(ago(3 * 24 * 60 * 60_000), NOW), 3);
eq("daysSince(7d, injected)", daysSince(ago(7 * 24 * 60 * 60_000), NOW), 7);
eq("daysSince(8d, injected)", daysSince(ago(8 * 24 * 60 * 60_000), NOW), 8);
eq("daysSince(future, injected, clamps to 0)", daysSince(new Date(NOW + 60_000).toISOString(), NOW), 0);

// ---- presenceStatusLabel ----
eq("presenceStatusLabel(active)", presenceStatusLabel("active"), "Online");
eq("presenceStatusLabel(idle)", presenceStatusLabel("idle"), "Idle");
eq("presenceStatusLabel(offline)", presenceStatusLabel("offline"), "Offline");
eq("presenceStatusLabel(undefined)", presenceStatusLabel(undefined), "Offline");

// ---- project-card excerpts / counts ----
eq("clampWords empty", clampWords(""), "");
eq("clampWords whitespace", clampWords(" \t\n "), "");
eq("clampWords normalizes whitespace", clampWords("  alpha\n\t beta  "), "alpha beta");
eq("clampWords exact fit", clampWords("alpha beta", 10), "alpha beta");
eq("clampWords whole-word boundary", clampWords("alpha beta gamma", 12), "alpha beta…");
eq("clampWords boundary at budget", clampWords("abc def", 4), "abc…");
eq("clampWords no partial word", clampWords("alpha beta gamma", 10), "alpha…");
eq("clampWords long token", clampWords("abcdefgh", 5), "abcd…");
eq("clampWords one character", clampWords("abcd", 1), "…");
eq("clampWords zero budget", clampWords("abcd", 0), "");
eq("clampWords negative budget", clampWords("abcd", -5), "");
eq("clampWords fractional budget", clampWords("abcdefgh", 5.8), "abcd…");
eq("clampWords Unicode is not split", clampWords("😀😀😀😀", 3), "😀😀…");
eq("clampWords preserves plain-text punctuation", clampWords("Ship it. It's ready!"), "Ship it. It's ready!");
const readme = "A small project that helps people ship useful things. ".repeat(8);
const excerpt = clampWords(readme);
eq("clampWords default budget", excerpt.length <= 180, true);
eq("clampWords ellipsis", excerpt.endsWith("…"), true);
eq("clampWords source prefix", readme.startsWith(excerpt.slice(0, -1)), true);
eq("clampWords idempotent", clampWords(excerpt), excerpt);
eq("formatCount zero", formatCount(0), "0");
eq("formatCount small", formatCount(42), "42");
eq("formatCount below thousand", formatCount(999), "999");
eq("formatCount thousand", formatCount(1000), "1k");
eq("formatCount 1.2k", formatCount(1234), "1.2k");
eq("formatCount million", formatCount(1_200_000), "1.2M");

// ---- relativeDay / updatedLabel: the project header's one timestamp ----
// Fixed instant so the day counts are the same on every machine and in every month.
// Named apart from the `NOW`/`ago` pair the elapsedShort block above declares: this
// file is one module scope, and that `ago` counts milliseconds where this one counts
// days, so sharing either name is a redeclaration, not a reuse.
const DAY_NOW = new Date("2026-09-22T12:00:00Z").getTime();
const DAY = 86_400_000;
const daysAgo = (days: number, hours = 0) => new Date(DAY_NOW - days * DAY - hours * 3_600_000).toISOString();

eq("relativeDay same instant", relativeDay(daysAgo(0), DAY_NOW), "today");
eq("relativeDay hours ago", relativeDay(daysAgo(0, 5), DAY_NOW), "today");
eq("relativeDay one day", relativeDay(daysAgo(1), DAY_NOW), "yesterday");
eq("relativeDay days", relativeDay(daysAgo(5), DAY_NOW), "5d ago");
eq("relativeDay 29 days", relativeDay(daysAgo(29), DAY_NOW), "29d ago");
// 30 days is where the count stops reading as a count and the date takes over.
eq("relativeDay 30 days", relativeDay(daysAgo(30), DAY_NOW), "Aug 23");
// Midday UTC on both: the absolute forms print in the machine's own timezone, and
// a midnight stamp would land on the previous day west of Greenwich.
eq("relativeDay this year keeps no year", relativeDay("2026-01-04T12:00:00Z", DAY_NOW), "Jan 4");
eq("relativeDay last year regains the year", relativeDay("2025-11-26T12:00:00Z", DAY_NOW), "Nov 26, 2025");
// The future is a clock skew, not a negative day count.
eq("relativeDay future", relativeDay(new Date(DAY_NOW + 4 * DAY).toISOString(), DAY_NOW), "today");
eq("relativeDay empty", relativeDay("", DAY_NOW), "");
eq("relativeDay junk", relativeDay("not-a-date", DAY_NOW), "");

eq("updatedLabel prefers the push", updatedLabel(daysAgo(2), daysAgo(40), DAY_NOW), "Updated 2d ago");
eq("updatedLabel falls back to the post", updatedLabel(null, daysAgo(3), DAY_NOW), "Updated 3d ago");
eq("updatedLabel falls back past an unparseable push", updatedLabel("nope", daysAgo(1), DAY_NOW), "Updated yesterday");
eq("updatedLabel no dates", updatedLabel(null, null, DAY_NOW), null);
eq("updatedLabel undefined dates", updatedLabel(undefined, undefined, DAY_NOW), null);
eq("updatedLabel empty strings", updatedLabel("", "", DAY_NOW), null);

// ---- QA R5: a hidden project reads "Private project", never "unknown" ----
for (const raw of [null, undefined, "", "  ", "unknown", "Unknown", "<private>", "private", "null"]) {
  eq(`projectLabel(${JSON.stringify(raw)})`, projectLabel(raw), "Private project");
}
eq("projectLabel keeps a real alias verbatim", projectLabel("vibehub"), "vibehub");
eq("presenceLine never prints unknown", presenceLine({ ...activity, projectAlias: "unknown" }, NOW).startsWith("Private project · "), true);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`format.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
