// Lane B (mac app): the server carries its own copy of the token price table
// (server/src/lib/token-pricing.ts) so `GET /api/v1/tracker/me` and the stats route can
// put a ~$ figure next to token counts for the Mac app. Two copies of one table drift,
// so this check pins them to each other: same entries, rates, aliases, checked date and
// sources - and the same exact-integer arithmetic on a shared set of rows, so a $ the
// API returns and a $ the web computes from the same tokens can never disagree.
//
// Synthetic, pure, no network, no accounts. Run with the existing runner:
//   node scripts/run-checks.mjs tokenPricingSync
import { createRequire } from "node:module";
import { estimateTokenCost } from "../tokenCost";
import type { TokenUsage } from "../tokenCost";
import { getTokenPrice, TOKEN_PRICES, TOKEN_PRICING_CHECKED_AT, TOKEN_PRICING_SOURCES } from "../tokenPricing";

// The server package is CommonJS; require() through tsx hands back its exports directly
// (no ESM<->CJS named-export guessing), typed against the server source itself.
const server = createRequire(import.meta.url)("../../../../server/src/lib/token-pricing.ts") as typeof import("../../../../server/src/lib/token-pricing");

let passed = 0;
const failures: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) { passed++; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}: expected ${String(expected)}, got ${String(actual)}`); }
}
const ok = (label: string, condition: boolean) => eq(label, condition, true);
const usage = (model: unknown, tokensInput: unknown, tokensOutput: unknown): TokenUsage => ({ model, tokensInput, tokensOutput });

// ---- the table: one entry set, byte for byte ----
eq("same number of tariffs", server.TOKEN_PRICES.length, TOKEN_PRICES.length);
eq("same checked date", server.TOKEN_PRICING_CHECKED_AT, TOKEN_PRICING_CHECKED_AT);
eq("same source URLs", JSON.stringify(server.TOKEN_PRICING_SOURCES), JSON.stringify(TOKEN_PRICING_SOURCES));
ok("server allowlist is immutable too", Object.isFrozen(server.TOKEN_PRICES));

const fields = ["provider", "modelId", "aliases", "inputUsdPerMillion", "outputUsdPerMillion", "checkedAt", "sourceUrl", "modelSourceUrl"] as const;
for (const [index, web] of TOKEN_PRICES.entries()) {
  const mirror = server.TOKEN_PRICES[index];
  for (const field of fields) {
    eq(`${web.modelId}: ${field}`, JSON.stringify(mirror?.[field]), JSON.stringify(web[field]));
  }
}

// QA fix R2: verified cache rates live in both tables too, and must agree.
for (const [index, web] of TOKEN_PRICES.entries()) {
  const mirror = server.TOKEN_PRICES[index] as { cacheReadUsdPerMillion?: number; cacheWriteUsdPerMillion?: number } | undefined;
  eq(`${web.modelId}: cache read/write rates`,
    `${mirror?.cacheReadUsdPerMillion}/${mirror?.cacheWriteUsdPerMillion}`,
    `${web.cacheReadUsdPerMillion}/${web.cacheWriteUsdPerMillion}`);
}

// Every id and alias resolves on both sides to the same tariff (or on neither).
const ids = TOKEN_PRICES.flatMap((p) => [p.modelId, ...p.aliases]);
for (const id of ids) {
  const web = getTokenPrice(id);
  const mirror = server.getTokenPrice(id);
  eq(`${id}: resolves to the same model`, mirror?.modelId, web?.modelId);
  eq(`${id}: same rates`, `${mirror?.inputUsdPerMillion}/${mirror?.outputUsdPerMillion}`, `${web?.inputUsdPerMillion}/${web?.outputUsdPerMillion}`);
}
for (const unknown of [null, undefined, "", "unknown", "<synthetic>", "codex", "GPT-5", "gpt-5 ", "claude-sonnet-4.5", "claude-opus-5[1m]", "openai/gpt-5", "__proto__", 5, {}]) {
  eq(`unlisted ${JSON.stringify(unknown)}: unknown on both sides`, server.getTokenPrice(unknown), getTokenPrice(unknown));
}

// ---- the arithmetic: exact units agree row for row ----
const fixtures: { label: string; rows: TokenUsage[] }[] = [
  { label: "empty", rows: [] },
  { label: "one known row", rows: [usage("gpt-4.1", 1_000_000, 177_500)] },
  { label: "two models, both directions", rows: [usage("gpt-4.1", 100_000, 900_000), usage("gpt-5-nano", 900_000, 100_000)] },
  { label: "alias and canonical", rows: [usage("claude-opus-4-5", 10, 20), usage("claude-opus-4-5-20251101", 10, 20)] },
  { label: "known plus unknown (partial)", rows: [usage("gpt-4.1", 500_000, 0), usage("custom", 300_000, 200_000)] },
  { label: "known zero plus unknown positive", rows: [usage("gpt-5", 0, 0), usage("custom", 10, 0)] },
  { label: "only unknown", rows: [usage("custom", 100, 50)] },
  { label: "unknown zero", rows: [usage("custom", 0, 0)] },
  { label: "known zero", rows: [usage("gpt-5", 0, 0)] },
  { label: "sub-cent", rows: [usage("gpt-5-nano", 1, 0)] },
  { label: "one-cent boundary", rows: [usage("gpt-5", 8_000, 0)] },
  { label: "old and new GPT-4o snapshots", rows: [usage("gpt-4o-2024-05-13", 1_000_000, 1_000_000), usage("gpt-4o-2024-08-06", 1_000_000, 1_000_000)] },
  { label: "maximum safe count", rows: [usage("o1-pro", 0, Number.MAX_SAFE_INTEGER)] },
  { label: "malformed count", rows: [usage("gpt-5", 10, 0), usage("custom", NaN, 0)] },
  { label: "negative count", rows: [usage("gpt-5", -5, 10)] },
];
for (const { label, rows } of fixtures) {
  const total = rows.reduce((sum, r) => sum + (Number(r.tokensInput) || 0) + (Number(r.tokensOutput) || 0), 0);
  const web = estimateTokenCost(rows, Number.isSafeInteger(total) && total >= 0 ? total : 0);
  const mirror = server.foldEstimatedUsd(rows as { model: string | null; tokensInput: number; tokensOutput: number }[]);
  eq(`${label}: same exact units`, mirror.amountUnits, web.amountUnits);
  eq(`${label}: same USD`, mirror.estimatedUsd, web.usd);
  eq(`${label}: same priced token count`, mirror.pricedTokens, web.pricedTokens);
  eq(`${label}: same availability`, mirror.estimatedUsd === null, web.status === "unavailable");
  eq(`${label}: same partial/complete verdict`, mirror.estimatedUsd !== null && mirror.pricedTokens < mirror.totalTokens, web.status === "partial");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`tokenPricingSync checks failed: ${failures.join(", ")}`);
