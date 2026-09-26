// Synthetic, pure checks only. No profiles, network, accounts, APIs or tracker logs.
// Run with the existing runner: node scripts/run-checks.mjs tokenCost
import { estimateTokenCost, isValidTokenCount, presentTokenCost, TOKEN_COST_LIMITATIONS } from "../tokenCost";
import type { TokenUsage } from "../tokenCost";
import { getTokenPrice, TOKEN_PRICES, TOKEN_PRICING_CHECKED_AT, TOKEN_PRICING_SOURCES } from "../tokenPricing";

let passed = 0;
const failures: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) { passed++; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}: expected ${String(expected)}, got ${String(actual)}`); }
}
const ok = (label: string, condition: boolean) => eq(label, condition, true);
const usage = (model: unknown, tokensInput: unknown, tokensOutput: unknown): TokenUsage => ({ model, tokensInput, tokensOutput });
const amount = (rows: readonly TokenUsage[] | null | undefined, count: unknown) => presentTokenCost(estimateTokenCost(rows, count)).amount;

// Independent snapshot pins: USD per million INPUT and OUTPUT tokens. Sources and
// checked date are in meta/resources/vibehub-token-pricing.md, not inferred families.
const verified: [string, number, number][] = [
  ["gpt-6-astra", 10, 50], ["gpt-5.6-sol", 4, 20], ["gpt-5.6-terra", 2, 12], ["gpt-5.6-luna", 0.20, 1.20],
  ["gpt-5.5", 5, 30], ["gpt-5.5-pro", 30, 180],
  ["gpt-5.4", 2.50, 15], ["gpt-5.4-mini", 0.75, 4.50], ["gpt-5.4-nano", 0.20, 1.25], ["gpt-5.4-pro", 30, 180],
  ["gpt-5.2", 1.75, 14], ["gpt-5.2-pro", 21, 168], ["gpt-5.1", 1.25, 10],
  ["gpt-5", 1.25, 10], ["gpt-5-mini", 0.25, 2], ["gpt-5-nano", 0.05, 0.40], ["gpt-5-pro", 15, 120],
  ["gpt-4.1", 2, 8], ["gpt-4.1-mini", 0.40, 1.60], ["gpt-4.1-nano", 0.10, 0.40],
  ["gpt-4o", 2.50, 10], ["gpt-4o-2024-05-13", 5, 15], ["gpt-4o-mini", 0.15, 0.60],
  ["o1", 15, 60], ["o1-pro", 150, 600], ["o3-pro", 20, 80], ["o3", 2, 8], ["o4-mini", 1.10, 4.40], ["o3-mini", 1.10, 4.40],
  ["gpt-5-codex", 1.25, 10], ["gpt-5.1-codex", 1.25, 10], ["gpt-5.1-codex-mini", 0.25, 2],
  ["gpt-5.1-codex-max", 1.25, 10], ["gpt-5.2-codex", 1.75, 14], ["gpt-5.3-codex", 1.75, 14],
  ["claude-fable-5-1", 10, 50], ["claude-fable-5", 10, 50], ["claude-opus-5", 5, 25],
  ["claude-opus-4-8", 5, 25], ["claude-opus-4-7", 5, 25], ["claude-opus-4-6", 5, 25],
  ["claude-opus-4-5-20251101", 5, 25], ["claude-sonnet-5", 2, 10], ["claude-sonnet-4-6", 3, 15],
  ["claude-sonnet-4-5-20250929", 3, 15], ["claude-haiku-4-5-20251001", 1, 5],
  // Retired, still priced on the official page (pricing "Model pricing" table, 2026-09-17).
  ["claude-opus-4-1-20250805", 15, 75], ["claude-opus-4-20250514", 15, 75],
  ["claude-sonnet-4-20250514", 3, 15], ["claude-3-5-haiku-20241022", 0.80, 4],
  // QA fix R1 (meta/plans/vibehub-qa-fix.md "Verified prices", Sep 2026).
  ["claude-opus-5-5", 4, 20], ["gpt-6-sol", 2, 10], ["gpt-6-luna", 0.10, 0.50],
];
eq("all and only researched tariff entries", TOKEN_PRICES.length, verified.length);
eq("source snapshot date", TOKEN_PRICING_CHECKED_AT, "2026-09-26");
ok("allowlist is immutable", Object.isFrozen(TOKEN_PRICES));

for (const [model, input, output] of verified) {
  const tariff = getTokenPrice(model);
  eq(`${model}: input tariff`, tariff?.inputUsdPerMillion, input);
  eq(`${model}: output tariff`, tariff?.outputUsdPerMillion, output);
  eq(`${model}: million input math`, estimateTokenCost([usage(model, 1_000_000, 0)], 1_000_000).usd, input);
  eq(`${model}: million output math`, estimateTokenCost([usage(model, 0, 1_000_000)], 1_000_000).usd, output);
  ok(`${model}: dated official source metadata`, !!tariff && tariff.checkedAt === TOKEN_PRICING_CHECKED_AT &&
    tariff.sourceUrl === TOKEN_PRICING_SOURCES[tariff.provider] && /^https:\/\/(developers\.openai\.com|platform\.claude\.com)\//.test(tariff.modelSourceUrl));
  ok(`${model}: immutable entry and aliases`, Object.isFrozen(tariff) && Object.isFrozen(tariff?.aliases));
}

const aliases: [string, string][] = [
  ["gpt-5-2025-08-07", "gpt-5"], ["gpt-4.1-2025-04-14", "gpt-4.1"], ["gpt-4o-2024-08-06", "gpt-4o"],
  ["claude-opus-4-5", "claude-opus-4-5-20251101"], ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"],
  ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
  ["claude-opus-4-1", "claude-opus-4-1-20250805"], ["claude-opus-4-0", "claude-opus-4-20250514"],
  ["claude-sonnet-4-0", "claude-sonnet-4-20250514"], ["claude-3-5-haiku-latest", "claude-3-5-haiku-20241022"],
];
eq("only explicit researched aliases", TOKEN_PRICES.flatMap((p) => p.aliases).length, aliases.length);
for (const [alias, canonical] of aliases) {
  eq(`${alias}: exact alias identity`, getTokenPrice(alias), getTokenPrice(canonical));
  eq(`${alias}: alias arithmetic`, estimateTokenCost([usage(alias, 80, 20)], 100).amountUnits, estimateTokenCost([usage(canonical, 80, 20)], 100).amountUnits);
}
const ids = TOKEN_PRICES.flatMap((p) => [p.modelId, ...p.aliases]);
eq("IDs never silently overwrite one another", new Set(ids).size, ids.length);
eq("old GPT-4o snapshot is not priced like the newer model", amount([usage("gpt-4o-2024-05-13", 1_000_000, 1_000_000)], 2_000_000), "≈ $20.00");
eq("new GPT-4o snapshot retains its own rate", amount([usage("gpt-4o-2024-08-06", 1_000_000, 1_000_000)], 2_000_000), "≈ $12.50");

const unknownIds: unknown[] = [
  null, undefined, "", "unknown", "<synthetic>", "codex", "cursor", "claude-code", "Claude Sonnet 5", "GPT-5", "gpt-5 ",
  "claude-sonnet-4.5", "claude-sonnet-4-5-20990101", "claude-fable-5-2", "claude-fable-5-1-custom", "gpt-99",
  "my-gpt-5", "gpt-5-custom", "gpt-5-2099-01-01", "gpt-4o-2024-11-20", "ft:gpt-5:custom", "openai/gpt-5",
  "anthropic/claude-sonnet-5", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-opus-5[1m]",
  "gemini-2.5-pro", "grok-4", "toString", "constructor", "__proto__", 5, {}, ["gpt-5"],
];
for (const [index, model] of unknownIds.entries()) {
  eq(`unlisted ID ${index}: not resolved`, getTokenPrice(model), undefined);
  eq(`unlisted ID ${index}: never free`, amount([usage(model, 100, 50)], 150), "≈ $—");
}
const onlyTool = { tool: "codex", ...usage(null, 100, 50) };
eq("a tool name cannot supply a missing model", amount([onlyTool], 150), "≈ $—");

const exact = estimateTokenCost([usage("gpt-4.1", 1_000_000, 177_500)], 1_177_500);
eq("requested $3.42 example uses input/output math", exact.usd, 3.42);
eq("USD example formatting", presentTokenCost(exact).amount, "≈ $3.42");
eq("complete coverage has no partial label", presentTokenCost(exact).coverage, null);
const mixed = [usage("gpt-4.1", 100_000, 900_000), usage("gpt-5-nano", 900_000, 100_000)];
eq("different models and directions never use a blended total rate", estimateTokenCost(mixed, 2_000_000).usd, 7.485);
eq("round only after summing", amount(mixed, 2_000_000), "≈ $7.49");

const partial = estimateTokenCost([usage("gpt-4.1", 500_000, 0), usage("custom", 300_000, 200_000)], 1_000_000);
eq("mixed known/unknown is partial", partial.status, "partial");
eq("partial includes only verified usage", partial.usd, 1);
eq("partial still retains the whole displayed count", partial.totalTokens, 1_000_000);
eq("partial has visible coverage", presentTokenCost(partial).coverage, "partial · 50% covered");
ok("partial reason gives exact coverage", presentTokenCost(partial).description.includes("500,000 of 1,000,000 tokens covered"));
eq("missing rows count as uncovered, not an invented price", estimateTokenCost([usage("gpt-4.1", 5, 0)], 10).status, "partial");
eq("positive known usage plus zero unknown does not lose coverage", estimateTokenCost([usage("gpt-4.1", 5, 0), usage("custom", 0, 0)], 5).status, "complete");
eq("incomplete coverage never rounds up to 100%", presentTokenCost(estimateTokenCost([usage("gpt-5-nano", 999_999, 0), usage("custom", 1, 0)], 1_000_000)).coverage, "partial · 99% covered");
eq("tiny positive coverage never rounds down to zero", presentTokenCost(estimateTokenCost([usage("gpt-5-nano", 1, 0)], 1_000_000)).coverage, "partial · <1% covered");
eq("known zero does not make unknown positive usage free", amount([usage("gpt-5", 0, 0), usage("custom", 10, 0)], 10), "≈ $—");
eq("overfull or wrong-range breakdown is unavailable", estimateTokenCost([usage("gpt-5", 10, 0)], 9).reason, "inconsistent-total");

eq("confirmed empty breakdown is legitimate zero", amount([], 0), "≈ $0.00");
eq("verified zero row is legitimate zero", amount([usage("gpt-5", 0, 0)], 0), "≈ $0.00");
eq("negative zero is still zero", amount([usage("gpt-5", -0, 0)], -0), "≈ $0.00");
eq("unknown zero is not a free tariff", amount([usage("custom", 0, 0)], 0), "≈ $—");
eq("missing breakdown is unknown even at zero", amount(undefined, 0), "≈ $—");
eq("null breakdown is unknown", amount(null, 100), "≈ $—");
eq("empty breakdown with nonzero total is unknown", amount([], 100), "≈ $—");
eq("object instead of breakdown is unknown", amount({} as readonly TokenUsage[], 0), "≈ $—");
eq("missing output direction is not zero", amount([{ model: "gpt-5", tokensInput: 0 }], 0), "≈ $—");
eq("null source row is invalid", amount([null as unknown as TokenUsage], 0), "≈ $—");
eq("positive sub-cent amount is not $0.00", amount([usage("gpt-5-nano", 1, 0)], 1), "≈ <$0.01");
eq("value just below one cent is still shown as tiny", amount([usage("gpt-5", 7_999, 0)], 7_999), "≈ <$0.01");
eq("one-cent boundary", amount([usage("gpt-5", 8_000, 0)], 8_000), "≈ $0.01");
eq("half-cent rounding only after the positive tiny threshold", amount([usage("gpt-5", 12_000, 0)], 12_000), "≈ $0.02");

const invalidCounts: unknown[] = [-1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE, 1.5, null, undefined, "1", 1n, true];
for (const [index, count] of invalidCounts.entries()) {
  eq(`invalid count ${index}: validation`, isValidTokenCount(count), false);
  eq(`invalid count ${index}: input`, amount([usage("gpt-5", count, 0)], 1), "≈ $—");
  eq(`invalid count ${index}: output`, amount([usage("gpt-5", 0, count)], 1), "≈ $—");
  eq(`invalid count ${index}: displayed total`, amount([usage("gpt-5", 0, 0)], count), "≈ $—");
  const text = presentTokenCost(estimateTokenCost([usage("gpt-5", count, 0)], 1));
  ok(`invalid count ${index}: no raw error values`, !/NaN|Infinity|undefined|null/.test(text.amount + text.description));
}
eq("negative values cannot cancel to a believable total", amount([usage("gpt-5", -5, 10)], 5), "≈ $—");
eq("invalid unknown usage cannot be silently excluded", amount([usage("gpt-5", 10, 0), usage("custom", NaN, 0)], 10), "≈ $—");
eq("one row overflows before conversion", estimateTokenCost([usage("gpt-5", Number.MAX_SAFE_INTEGER, 1)], Number.MAX_SAFE_INTEGER).reason, "overflow");
eq("sum of individually safe rows can overflow", estimateTokenCost([usage("gpt-5", Number.MAX_SAFE_INTEGER, 0), usage("gpt-5", 1, 0)], Number.MAX_SAFE_INTEGER).reason, "overflow");
const maximum = estimateTokenCost([usage("o1-pro", 0, Number.MAX_SAFE_INTEGER)], Number.MAX_SAFE_INTEGER);
eq("maximum safe count remains supported", maximum.status, "complete");
eq("large multiplication is exact before formatting", maximum.amountUnits, BigInt(Number.MAX_SAFE_INTEGER) * 600_000_000n);
ok("large visible values are compact for narrow UI", presentTokenCost(maximum).amount.length < 18);
ok("large accessible amount remains fully specified", presentTokenCost(maximum).description.includes("$5,404,319,552,844.59 USD"));
for (const usd of [NaN, Infinity, -Infinity, -1]) eq("formatter rejects malformed numeric estimates", presentTokenCost({ ...exact, usd }).amount, "≈ $—");
eq("formatter rejects cost overflow", presentTokenCost({ ...exact, amountUnits: 10n ** 80n }).amount, "≈ $—");
eq("formatter rejects negative cost", presentTokenCost({ ...exact, amountUnits: -1n }).amount, "≈ $—");
eq("malformed partial coverage cannot divide by zero", presentTokenCost({ ...exact, status: "partial", totalTokens: 0 }).amount, "≈ $—");

for (const phrase of ["not money paid", "Subscriptions", "cache", "batch", "long-context", "incomplete", "historical"]) {
  ok(`billing limitation: ${phrase}`, TOKEN_COST_LIMITATIONS.includes(phrase));
}
ok("unavailable cost has a short missing-breakdown reason", presentTokenCost(estimateTokenCost(undefined, 42)).description.includes("Model input/output breakdown is unavailable"));
ok("unknown cost has a verified-price reason", presentTokenCost(estimateTokenCost([usage("custom", 1, 0)], 1)).description.includes("No verified model price"));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`tokenCost checks failed: ${failures.join(", ")}`);
