// Contract pins for lib/token-pricing.ts - plain assertions, no test framework.
// Run from the repo root:  npx tsx server/src/lib/__checks__/tokenPricing.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.
//
// The *table* is pinned against the web's copy by web/src/lib/__checks__/tokenPricingSync.check.ts;
// this file pins the server's own fold (what /tracker/me and /users/:u/stats put on the
// wire) so its rules cannot drift from the web's estimateTokenCost either.

import { costUnits, estimateUsd, foldEstimatedUsd, getTokenPrice, isValidTokenCount, TOKEN_PRICES, TOKEN_PRICING_CHECKED_AT, usdFromUnits } from "../token-pricing";

let passed = 0;
const failures: string[] = [];

// Formatting only - no assertion changes. A top-level bigint was handled, but a bigint
// NESTED in a value (foldEstimatedUsd returns `amountUnits: 0n`) threw inside
// JSON.stringify and aborted the run at the first fold assertion. Both sides go through
// the same formatter, so comparisons stay exact.
const show = (value: unknown): string => typeof value === "bigint"
  ? `${value}n`
  : JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? `${nested}n` : nested);

function eq<T>(label: string, actual: T, expected: T): void {
  const a = show(actual);
  const e = show(expected);
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} -> ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}
const ok = (label: string, condition: boolean) => eq(label, condition, true);
const row = (model: string | null, tokensInput: number, tokensOutput: number) => ({ model, tokensInput, tokensOutput });

// ---- allowlist hygiene ----
ok("allowlist is immutable", Object.isFrozen(TOKEN_PRICES));
ok("allowlist is non-empty", TOKEN_PRICES.length > 40);
eq("source snapshot date", TOKEN_PRICING_CHECKED_AT, "2026-09-16");
for (const unknown of [null, undefined, "", "unknown", "<synthetic>", "codex", "claude-code", "GPT-5", "gpt-5 ", "claude-opus-5[1m]", "__proto__", "constructor", 5, {}]) {
  eq(`unlisted ${JSON.stringify(unknown)} is not priced`, getTokenPrice(unknown), undefined);
  eq(`unlisted ${JSON.stringify(unknown)} has no units`, costUnits(unknown, 100, 50), null);
  eq(`unlisted ${JSON.stringify(unknown)} has no USD`, estimateUsd(unknown, 100, 50), null);
}
eq("alias resolves to the canonical tariff", getTokenPrice("claude-opus-4-5")?.modelId, "claude-opus-4-5-20251101");

// ---- per-row arithmetic (USD per million input / output) ----
eq("gpt-4.1 million input", estimateUsd("gpt-4.1", 1_000_000, 0), 2);
eq("gpt-4.1 million output", estimateUsd("gpt-4.1", 0, 1_000_000), 8);
eq("the web's $3.42 example", estimateUsd("gpt-4.1", 1_000_000, 177_500), 3.42);
eq("claude-opus-5 small counts are exact in units", costUnits("claude-opus-5", 10, 20), 550_000_000n);
eq("units -> USD", usdFromUnits(550_000_000n), 0.00055);
eq("old GPT-4o snapshot keeps its own tariff", estimateUsd("gpt-4o-2024-05-13", 1_000_000, 1_000_000), 20);
eq("new GPT-4o snapshot keeps its own tariff", estimateUsd("gpt-4o-2024-08-06", 1_000_000, 1_000_000), 12.5);

// ---- counts ----
for (const bad of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5, null, undefined, "1", true]) {
  eq(`invalid count ${String(bad)}: rejected`, isValidTokenCount(bad), false);
  eq(`invalid count ${String(bad)}: no units`, costUnits("gpt-5", bad, 0), null);
  eq(`invalid count ${String(bad)}: fold unavailable`, foldEstimatedUsd([row("gpt-5", bad as number, 0)]).estimatedUsd, null);
}
eq("maximum safe count is still priced", estimateUsd("o1-pro", 0, Number.MAX_SAFE_INTEGER), Number(BigInt(Number.MAX_SAFE_INTEGER) * 600_000_000n) / 1e12);

// ---- fold: the rules /tracker/me and stats rely on ----
eq("empty fold is a legitimate zero", foldEstimatedUsd([]), { estimatedUsd: 0, amountUnits: 0n, byModel: {}, pricedTokens: 0, totalTokens: 0 });
eq("known zero row is zero", foldEstimatedUsd([row("gpt-5", 0, 0)]).estimatedUsd, 0);
eq("known zero row still lists its model", foldEstimatedUsd([row("gpt-5", 0, 0)]).byModel, { "gpt-5": 0 });
eq("unknown zero row is not a verified $0", foldEstimatedUsd([row("unknown", 0, 0)]).estimatedUsd, null);
eq("null-model zero row is not a verified $0", foldEstimatedUsd([row(null, 0, 0)]).estimatedUsd, null);
eq("only unknown usage is unavailable, not free", foldEstimatedUsd([row("custom", 100, 50)]).estimatedUsd, null);
eq("unavailable still reports the tokens it saw", foldEstimatedUsd([row("custom", 100, 50)]).totalTokens, 150);

const mixed = foldEstimatedUsd([row("gpt-4.1", 100_000, 900_000), row("gpt-5-nano", 900_000, 100_000)]);
eq("different models never share a blended rate", mixed.estimatedUsd, 7.485);
eq("byModel splits the same amount", mixed.byModel, { "gpt-4.1": 7.4, "gpt-5-nano": 0.085 });
eq("units are the exact sum", mixed.amountUnits, 7_485_000_000_000n);
eq("complete coverage", [mixed.pricedTokens, mixed.totalTokens], [2_000_000, 2_000_000]);

const partial = foldEstimatedUsd([row("gpt-4.1", 500_000, 0), row("custom", 300_000, 200_000), row("unknown", 5, 5)]);
eq("partial: priced rows only", partial.estimatedUsd, 1);
eq("partial: coverage is visible", [partial.pricedTokens, partial.totalTokens], [500_000, 1_000_010]);
eq("partial: unpriced models are absent from byModel", Object.keys(partial.byModel), ["gpt-4.1"]);

const repeated = foldEstimatedUsd([row("claude-opus-5", 10, 20), row("claude-opus-5", 10, 20), row("claude-opus-4-5", 1_000_000, 0), row("claude-opus-4-5-20251101", 1_000_000, 0)]);
eq("same model twice merges into one byModel key", repeated.byModel["claude-opus-5"], 0.0011);
eq("an alias is its own byModel key (as recorded), not folded into the canonical id", [repeated.byModel["claude-opus-4-5"], repeated.byModel["claude-opus-4-5-20251101"]], [5, 5]);
eq("...but both are priced into the total", repeated.estimatedUsd, 10.0011);

eq("one malformed row invalidates the fold rather than being skipped", foldEstimatedUsd([row("gpt-5", 10, 0), row("custom", NaN, 0)]).estimatedUsd, null);
eq("negative counts cannot cancel to a believable total", foldEstimatedUsd([row("gpt-5", -5, 10)]).estimatedUsd, null);
eq("sum of safe rows can overflow the token count", foldEstimatedUsd([row("gpt-5", Number.MAX_SAFE_INTEGER, 0), row("gpt-5", 1, 0)]).estimatedUsd, null);
eq("a row that overflows the cost cap is unavailable", foldEstimatedUsd([row("o1-pro", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)]).estimatedUsd, null);

// The fold must be usable straight from res.json(): only `amountUnits` is a BigInt and
// callers never serialise it - assert the rest survives JSON.stringify untouched.
const wire = foldEstimatedUsd([row("gpt-5", 8_000, 0)]);
eq("JSON-safe fields", JSON.parse(JSON.stringify({ estimatedUsd: wire.estimatedUsd, byModel: wire.byModel })), { estimatedUsd: 0.01, byModel: { "gpt-5": 0.01 } });

// ---- QA fix: new models (R1) and cache rates (R2), meta/plans/vibehub-qa-fix.md ----
// Appended in the web's order, so tokenPricingSync can compare index by index.
eq("new rows are appended last, in order", TOKEN_PRICES.slice(-3).map((p) => p.modelId), ["claude-opus-5-5", "gpt-6-sol", "gpt-6-luna"]);
eq("claude-opus-5-5 base rates", [getTokenPrice("claude-opus-5-5")?.inputUsdPerMillion, getTokenPrice("claude-opus-5-5")?.outputUsdPerMillion], [4, 20]);
eq("gpt-6-sol base rates", [getTokenPrice("gpt-6-sol")?.inputUsdPerMillion, getTokenPrice("gpt-6-sol")?.outputUsdPerMillion], [2, 10]);
eq("gpt-6-luna base rates", [getTokenPrice("gpt-6-luna")?.inputUsdPerMillion, getTokenPrice("gpt-6-luna")?.outputUsdPerMillion], [0.1, 0.5]);
// 3-argument calls are the web's arithmetic, unchanged.
eq("no cache args = the old arithmetic", costUnits("claude-opus-5-5", 1_000_000, 0), costUnits("claude-opus-5-5", 1_000_000, 0, 0, 0));
// Opus 5.5: 1M cache reads at $0.20; 1M input of which all are cache writes at $5.
eq("opus 5.5 cache read rate", estimateUsd("claude-opus-5-5", 0, 0, 1_000_000), 0.2);
eq("opus 5.5 cache write rate", estimateUsd("claude-opus-5-5", 1_000_000, 0, 0, 1_000_000), 5);
eq("fable 5.1 cache read rate (0.025x, not 0.1x)", estimateUsd("claude-fable-5-1", 0, 0, 1_000_000), 0.25);
eq("haiku alias inherits its cache rate", estimateUsd("claude-haiku-4-5", 0, 0, 1_000_000), 0.1);
eq("openai: no cache-write rate means ordinary input", estimateUsd("gpt-6-sol", 1_000_000, 0, 0, 1_000_000), 2);
eq("gpt-6-sol cache read rate", estimateUsd("gpt-6-sol", 0, 0, 1_000_000), 0.2);
eq("no verified cache rate: reads are not guessed", estimateUsd("claude-opus-4-8", 0, 0, 1_000_000), 0);
eq("cache writes cannot exceed input", costUnits("claude-opus-5-5", 10, 0, 0, 11), null);
eq("malformed cache read", costUnits("claude-opus-5-5", 10, 0, -1), null);
eq("fold prices cache counters", foldEstimatedUsd([{ model: "claude-opus-5-5", tokensInput: 0, tokensOutput: 0, tokensCacheRead: 5_000_000 }]).estimatedUsd, 1);
eq("fold rejects a malformed cache row", foldEstimatedUsd([{ model: "claude-opus-5-5", tokensInput: 1, tokensOutput: 0, tokensCacheWrite: 2 }]).estimatedUsd, null);

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`tokenPricing.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
