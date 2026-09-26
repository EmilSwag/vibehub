// Synthetic grouping checks. Imports pure helpers only; no API/account/log access.
import { groupStatsByModel, groupStatsByModelWithCosts, modelRowLabel } from "../recentModels";
import { isTokenlessTool } from "../supportedTools";
import { estimateTokenCost, presentTokenCost } from "../tokenCost";
import type { StatByModel } from "../../types";

let passed = 0;
const failures: string[] = [];
const stringify = (value: unknown) => JSON.stringify(value, (_, v: unknown) => typeof v === "bigint" ? `${v}n` : v);
function eq(label: string, actual: unknown, expected: unknown): void {
  if (stringify(actual) === stringify(expected)) { passed++; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}
const row = (tool: string, model: string, tokensInput: number, tokensOutput: number, activeSeconds = 60, lastActiveAt?: string): StatByModel =>
  ({ tool, model, tokensInput, tokensOutput, activeSeconds, ...(lastActiveAt ? { lastActiveAt } : {}) });
const count = (rows: StatByModel[]) => rows.reduce((n, r) => n + r.tokensInput + r.tokensOutput, 0);

eq("empty grouping remains empty", groupStatsByModelWithCosts([]), []);
const source = [
  row("codex", "gpt-4.1", 1_000_000, 0, 120, "2026-09-01T00:00:00Z"),
  row("claude-code", "gpt-4.1", 0, 1_000_000, 3600, "2026-09-03T00:00:00Z"),
  row("codex", "gpt-4.1-2025-04-14", 100_000, 200_000, 60, "2026-09-02T00:00:00Z"),
  row("quadcode", "claude-sonnet-5", 50_000, 10_000, 600, "2026-09-04T00:00:00Z"),
  row("cursor", "<synthetic>", 50, 20, 300),
];
const before = stringify(source);
const grouped = groupStatsByModelWithCosts(source);
const original = groupStatsByModel(source);
// Remove ONLY the opt-in cost fields; every legacy count, date, flag and ordering
// should be byte-for-byte identical to the unchanged legacy group function.
const legacy = grouped.map(({ cost: _cost, ...group }) => ({
  ...group, byTool: group.byTool.map(({ cost: _toolCost, ...bucket }) => bucket),
}));
eq("legacy count/order/date/flag fields are unchanged", legacy, original);
eq("input records are not mutated", stringify(source), before);
const gpt = grouped.find((g) => g.label === "GPT-4.1")!;
eq("multiple tools and dated alias fold into one model", gpt.tokens, 2_300_000);
eq("directions survive folding for correct parent cost", gpt.cost.usd, 11.8);
eq("tool ordering still follows hours", gpt.tools, ["claude-code", "codex"]);
eq("each raw source bucket is included once in its tool subtotal", gpt.byTool.map((b) => [b.tool, b.cost.usd]), [["claude-code", 8], ["codex", 3.8]]);
eq("tool tokens sum to model tokens", gpt.byTool.reduce((n, b) => n + b.tokens, 0), gpt.tokens);
eq("tool prices sum EXACTLY to model price", gpt.byTool.reduce((n, b) => n + b.cost.amountUnits!, 0n), gpt.cost.amountUnits);
eq("legacy-estimate flag is preserved", grouped.find((g) => g.label === "Sonnet 5")?.estimated, true);
// A tokenless tool's legacy figure is NOT billable usage: the vendor publishes no
// counts, so the row is unpriced rather than priced at whatever the model costs.
eq("a wholly tokenless row is unpriced, not zero", grouped.find((g) => g.label === "Sonnet 5")?.cost.usd, null);
eq("every tokenless group says why it has no price", grouped.filter((g) => g.tokenless).map((g) => [g.label, g.cost.reason]),
  [["Sonnet 5", "tokenless-tool"], ["Cursor", "tokenless-tool"]]);
const total = estimateTokenCost(source, count(source));
eq("unknown nonzero usage makes the full range partial", total.status, "partial");
const measuredRows = source.filter((r) => !isTokenlessTool(r.tool));
eq("priced subtotals sum EXACTLY to the raw estimate over the MEASURING rows", grouped.reduce((n, g) => n + (g.cost.amountUnits ?? 0n), 0n), estimateTokenCost(measuredRows, count(measuredRows)).amountUnits);
eq("model token subtotals sum to the displayed range count", grouped.reduce((n, g) => n + g.tokens, 0), count(source));
eq("model-less tool never inherits a live/default model rate", presentTokenCost(grouped.find((g) => g.label === "Cursor")!.cost).amount, "≈ $—");

// One humanized model name, two DIFFERENT published tariffs. No use of group.model.
const snapshots = [
  row("codex", "gpt-4o-2024-05-13", 1_000_000, 1_000_000),
  row("codex", "gpt-4o-2024-08-06", 1_000_000, 1_000_000),
  row("quadcode", "gpt-4o", 10, 50),
];
const folded = groupStatsByModelWithCosts(snapshots);
eq("different priced snapshots still share the existing display row", folded.length, 1);
eq("same-tool snapshots use each snapshot's own rate", folded[0].byTool.find((b) => b.tool === "codex")?.cost.usd, 32.5);
eq("folded price uses raw snapshots, not first-model tariff", folded[0].cost.usd, 32.5);
eq("a tokenless tool on a measured row adds activity, never price", folded[0].byTool.find((b) => b.tool === "quadcode")?.cost.reason, "tokenless-tool");
eq("snapshot subtotal equals its raw estimate over the measuring rows", folded[0].cost.amountUnits,
  estimateTokenCost(snapshots.filter((r) => !isTokenlessTool(r.tool)), folded[0].tokens).amountUnits);
eq("the unmeasured share is reported as uncovered, not dropped from the total", presentTokenCost(folded[0].cost).coverage, "partial · 99% covered");
eq("input ordering cannot change the chosen price", groupStatsByModelWithCosts([...snapshots].reverse())[0].cost.amountUnits, folded[0].cost.amountUnits);

// Dotted/provider-prefixed names humanize identically but are NOT verified aliases.
const unknownFold = [
  row("claude-code", "claude-sonnet-4-5-20250929", 1_000_000, 0),
  row("quadcode", "claude-sonnet-4.5", 0, 1_000_000),
  row("claude-code", "claude-sonnet-4-5", 0, 1_000_000),
  row("claude-code", "anthropic/claude-sonnet-4-5", 500_000, 0),
];
const partial = groupStatsByModelWithCosts(unknownFold)[0];
eq("fixture really folds verified and unverified IDs to one label", new Set(unknownFold.map((r) => modelRowLabel(r.tool, r.model))).size, 1);
eq("unpriced folded usage stays in the displayed count", partial.tokens, 3_500_000);
eq("folded unknown IDs are NOT laundered into the representative model", partial.cost.status, "partial");
eq("only the two verified source rows get prices", partial.cost.usd, 18);
eq("model coverage includes the unpriced folded rows", presentTokenCost(partial.cost).coverage, "partial · 57% covered");
const claude = partial.byTool.find((b) => b.tool === "claude-code")!;
const quadcode = partial.byTool.find((b) => b.tool === "quadcode")!;
eq("a tool can be partially priced inside a folded model", claude.cost.status, "partial");
eq("tool coverage uses its own tokens", presentTokenCost(claude.cost).coverage, "partial · 80% covered");
eq("entirely unknown tool is unavailable, not zero", presentTokenCost(quadcode.cost).amount, "≈ $—");
eq("partial priced tool subtotal agrees exactly with model", claude.cost.amountUnits, partial.cost.amountUnits);
eq("partial grouped price agrees exactly with raw total", partial.cost.amountUnits, estimateTokenCost(unknownFold, count(unknownFold)).amountUnits);
eq("unknown first representative cannot change partial math", groupStatsByModelWithCosts([...unknownFold].reverse())[0].cost, partial.cost);

const future = groupStatsByModelWithCosts([
  row("claude-code", "claude-sonnet-4-5-20250929", 100, 0),
  row("claude-code", "claude-sonnet-4-5-20990101", 100, 0),
])[0];
eq("unverified dated suffix keeps the existing label but no price", future.cost.status, "partial");
eq("future dated source is never added to known priced coverage", future.cost.pricedTokens, 100);
eq("future subtotal and model agree", future.byTool[0].cost, future.cost);

for (const model of ["<synthetic>", "custom-model", "claude-fable-5-2"]) {
  const g = groupStatsByModelWithCosts([row("codex", model, 100, 20)])[0];
  eq(`${model}: parent unavailable`, presentTokenCost(g.cost).amount, "≈ $—");
  eq(`${model}: tool unavailable`, presentTokenCost(g.byTool[0].cost).amount, "≈ $—");
}
const zero = groupStatsByModelWithCosts([row("codex", "gpt-5", 0, 0)])[0];
eq("known zero parent", presentTokenCost(zero.cost).amount, "≈ $0.00");
eq("known zero tool", presentTokenCost(zero.byTool[0].cost).amount, "≈ $0.00");
const missing = groupStatsByModelWithCosts([row("cursor", "<synthetic>", 0, 0)])[0];
eq("model-less zero parent stays unavailable", presentTokenCost(missing.cost).amount, "≈ $—");
eq("model-less zero tool stays unavailable", presentTokenCost(missing.byTool[0].cost).amount, "≈ $—");
const tiny = groupStatsByModelWithCosts([row("codex", "gpt-5-nano", 1, 0)])[0];
eq("tiny parent", presentTokenCost(tiny.cost).amount, "≈ <$0.01");
eq("tiny tool", presentTokenCost(tiny.byTool[0].cost).amount, "≈ <$0.01");

for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  const g = groupStatsByModelWithCosts([row("codex", "gpt-5", value, 0)])[0];
  eq("invalid folded parent unavailable", presentTokenCost(g.cost).amount, "≈ $—");
  eq("invalid folded tool unavailable", presentTokenCost(g.byTool[0].cost).amount, "≈ $—");
}
const overflow = groupStatsByModelWithCosts([row("codex", "gpt-5", Number.MAX_SAFE_INTEGER, 0), row("codex", "gpt-5", 1, 0)])[0];
eq("folded model overflow is unavailable", presentTokenCost(overflow.cost).amount, "≈ $—");
eq("folded tool overflow is unavailable", presentTokenCost(overflow.byTool[0].cost).amount, "≈ $—");
const rounding = groupStatsByModelWithCosts([row("codex", "gpt-5", 4000, 0), row("cursor", "gpt-5", 4000, 0)])[0];
eq("a measuring tool keeps the row priced when a tokenless one shares it", rounding.tokenless, false);
eq("the tokenless half is excluded from the row price", presentTokenCost(rounding.cost).amount, "≈ <$0.01");
eq("the excluded half still counts against coverage", presentTokenCost(rounding.cost).coverage, "partial · 50% covered");
eq("the tokenless bucket carries no price of its own", presentTokenCost(rounding.byTool.find((b) => b.tokenless)!.cost).amount, "≈ $—");
// The expanded row prints these underneath the row total, so they have to add up.
eq("measured tool subtotals still sum EXACTLY to the row", rounding.byTool.filter((b) => !b.tokenless).reduce((n, b) => n + b.cost.amountUnits!, 0n), rounding.cost.amountUnits);
const frozenRows = source.map((r) => Object.freeze({ ...r }));
Object.freeze(frozenRows);
eq("frozen input is safe and deterministic", groupStatsByModelWithCosts(frozenRows), grouped);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`tokenCost grouping checks failed: ${failures.join(", ")}`);
