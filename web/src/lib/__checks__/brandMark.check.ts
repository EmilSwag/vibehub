// Contract pins for the round-8 brand marks — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/brandMark.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).
//
// What this guards that the type system cannot:
//   - a mark id in the family map with no path behind it (a typo silently degrades
//     that family to the neutral dot, which looks fine and is wrong)
//   - a real model/tool id no longer routing to the brand it belongs to
//   - a mark that stopped being monochrome, i.e. carries its own colour

import { MARK_BY_FAMILY, SMALL_BELOW, brandMarkFor, markAt, markById } from "../../components/ui/BrandMark";
import { BRAND_MARK_PATHS } from "../../components/ui/brand-mark-paths";
import { SMALL_MARKS } from "../../components/ui/brand-mark-small";
import { LINK_MARKS } from "../../components/LinkIcon";
import { modelFamily, toolFamily } from "../format";
import type { ModelFamily, ToolFamily } from "../format";

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

function ok(label: string, condition: boolean): void {
  eq(label, condition, true);
}

const families = Object.keys(MARK_BY_FAMILY) as Array<ModelFamily | ToolFamily>;

// ---- every family resolves to real geometry ----
// `brandMarkFor` falls back to the neutral dot at runtime, so "resolves" is not enough:
// only "unknown" is allowed to land there.
const neutral = brandMarkFor("unknown");
for (const family of families) {
  const mark = brandMarkFor(family);
  ok(`${family}: path is non-empty`, mark.d.length > 0);
  ok(`${family}: path starts with a moveto`, /^[Mm]/.test(mark.d.trim()));
  if (family !== "unknown") {
    ok(`${family}: is a real mark, not the neutral fallback`, mark.d !== neutral.d);
  }
}

// ---- the marks carry no colour of their own ----
// A mark is painted by `fill="currentColor"` on the <svg>; anything baked into the path
// data would be a hue leak the design spec forbids outright.
for (const family of families) {
  const mark = brandMarkFor(family);
  ok(`${family}: path data is geometry only`, !/#|rgb|fill|stroke/i.test(mark.d));
}

// ---- real ids route to the brand they belong to ----
// Same shape as format.check.ts's tables: the input is what the tracker actually reports.
const MODELS: [string, ModelFamily][] = [
  ["claude-opus-5", "claude"],
  ["claude-sonnet-4-5-20250929", "claude"],
  ["us.anthropic.claude-haiku-4-5-20251001-v1:0", "claude"],
  ["gpt-5-codex", "gpt"],
  ["o3-mini", "gpt"],
  ["gemini-2.5-flash-lite", "gemini"],
  ["grok-4", "grok"],
  ["deepseek-r1", "unknown"],
  ["", "unknown"],
];
for (const [id, family] of MODELS) {
  eq(`modelFamily(${JSON.stringify(id)}) → mark`, MARK_BY_FAMILY[modelFamily(id)], MARK_BY_FAMILY[family]);
}

const TOOLS: [string, ToolFamily][] = [
  ["claude-code", "claude-code"],
  ["claude_code", "claude-code"],
  ["cursor", "cursor"],
  ["codex", "codex"],
  ["visual-studio-code", "vscode"],
  ["windsurf", "windsurf"],
  ["zed", "zed"],
  ["genui", "quadcode"],
  ["chatgpt", "chatgpt"],
  ["<synthetic>", "unknown"],
];
for (const [id, family] of TOOLS) {
  eq(`toolFamily(${JSON.stringify(id)}) → mark`, MARK_BY_FAMILY[toolFamily(id)], MARK_BY_FAMILY[family]);
}

// ---- the deliberate sharing, pinned so it stays deliberate ----
// ChatGPT, Codex-the-model and the GPT family are all OpenAI products; Codex-the-CLI
// has its own mark and must not collapse into the blossom.
eq("gpt and chatgpt share the OpenAI blossom", MARK_BY_FAMILY.gpt, MARK_BY_FAMILY.chatgpt);
ok("codex keeps its own mark", brandMarkFor("codex").d !== brandMarkFor("gpt").d);
ok("the Grok mark is shared by the model and the tool", brandMarkFor("grok").d.length > 0);

// ---- the 12px redraws ----
// Below 14px a mark may swap to a simplified redraw; at 16 and up it never does. These
// pin the swap so a mark cannot quietly start (or stop) simplifying itself.
const REDRAWN = ["claude-code", "codex", "zed", "website"];

eq("exactly these marks have a 12px redraw", Object.keys(SMALL_MARKS).sort(), [...REDRAWN].sort());
eq("the threshold is 14 — 13px in a tracker row still simplifies", SMALL_BELOW, 14);

for (const id of REDRAWN) {
  const mark = markById(id);
  ok(`${id}: carries its redraw`, mark.small !== undefined);
  ok(`${id}: 12px differs from the published mark`, markAt(mark, 12).d !== mark.d);
  eq(`${id}: 13px also simplifies`, markAt(mark, 13).d, markAt(mark, 12).d);
  eq(`${id}: 16px is the published mark`, markAt(mark, 16).d, mark.d);
  eq(`${id}: 26px is the published mark`, markAt(mark, 26).d, mark.d);
}

// Claude Code borrows Claude's own burst — pinned, because that is a product decision
// rather than a drawing, and it should break loudly if either mark moves.
eq("claude-code's 12px redraw is Claude's burst", markAt(markById("claude-code"), 12).d, BRAND_MARK_PATHS.claude.d);

// Every other mark is published geometry at every size.
for (const family of families) {
  const mark = brandMarkFor(family);
  const id = MARK_BY_FAMILY[family];
  if (REDRAWN.includes(id)) continue;
  eq(`${family}: 12px is the published mark`, markAt(mark, 12).d, mark.d);
}

// A redraw is line art, so it has to declare a usable stroke — a stroked path with no
// width renders as nothing at all.
for (const [id, mark] of Object.entries(SMALL_MARKS)) {
  ok(`${id} redraw: path is non-empty and starts with a moveto`, /^[Mm]/.test(mark.d.trim()));
  ok(`${id} redraw: geometry only, no colour`, !/#|rgb|fill=|stroke=/i.test(mark.d));
  if (mark.stroke !== undefined) ok(`${id} redraw: stroke width is positive`, mark.stroke > 0);
}

// ---- profile-header link icons ----
// The server now maps t.me / telegram.org to the icon key "telegram" (round 8C
// follow-up). Pinned because the failure is silent: an unknown key falls back to the
// website globe, which looks deliberate and is wrong.
eq("telegram renders the Telegram mark, not the globe", LINK_MARKS.telegram.d, BRAND_MARK_PATHS.telegram.d);
ok("telegram is not the website fallback", LINK_MARKS.telegram.d !== LINK_MARKS.generic.d);
eq("x.com still arrives as the server's 'twitter' key", LINK_MARKS.twitter.d, BRAND_MARK_PATHS.x.d);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`brandMark.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
