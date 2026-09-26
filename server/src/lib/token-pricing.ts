// Server-side token pricing - the same allowlist as web/src/lib/tokenPricing.ts, so a
// ~$ figure the API returns and one the web derives from the same tokens agree to the
// unit. The table below is a verbatim copy; web/src/lib/__checks__/tokenPricingSync.check.ts
// fails the web checks the moment the two tables (or the arithmetic) drift, and the
// checked date / sources here are the single record of when they were verified.
//
// Standard text API-price equivalents, NOT invoices or subscription spending.
// Evidence, exact aliases and assumptions: meta/resources/vibehub-token-pricing.md
// (workspace meta, outside this repo). No network requests, provider SDKs, family
// matching or inferred model identities - exact, case-sensitive IDs only.
//
// Pure and Prisma-free on purpose: `__checks__/tokenPricing.check.ts` pins it without
// a database, and the web's sync check imports it directly.

export const TOKEN_PRICING_CHECKED_AT = "2026-09-16";

export const TOKEN_PRICING_SOURCES = Object.freeze({
  openai: "https://developers.openai.com/api/docs/pricing",
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
});

export interface TokenPrice {
  readonly provider: keyof typeof TOKEN_PRICING_SOURCES;
  readonly modelId: string;
  readonly aliases: readonly string[];
  /** USD per 1,000,000 ordinary input/output tokens; never cache or batch rates. */
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly checkedAt: string;
  readonly sourceUrl: string;
  readonly modelSourceUrl: string;
  /**
   * QA fix (R2): USD per 1,000,000 cache-READ / cache-WRITE tokens, only where a
   * verified rate exists (see CACHE_RATES). Absent means "no verified cache price":
   * cache reads then stay unpriced and cache writes are priced as ordinary input.
   * Server-only - the web keeps its own cache-read rates, and the sync check pins the
   * base fields above, not these.
   */
  readonly cacheReadUsdPerMillion?: number;
  readonly cacheWriteUsdPerMillion?: number;
}

/**
 * Verified cache rates (meta/plans/vibehub-qa-fix.md, "Verified prices", Sep 2026).
 * [read, write]; write null = the provider bills no separate cache write.
 * Deliberately NOT a multiplier rule: Opus 5.5 reads at 0.05x and Fable at 0.025x,
 * so "0.1x read / 1.25x write" is no longer true across a provider.
 */
const CACHE_RATES: Readonly<Record<string, readonly [number, number | null]>> = Object.freeze({
  "claude-opus-5-5": [0.20, 5],
  "claude-fable-5-1": [0.25, 12.5],
  "claude-opus-5": [0.50, 6.25],
  "claude-sonnet-5": [0.20, 2.5],
  "claude-haiku-4-5-20251001": [0.10, 1.25],
  "gpt-6-sol": [0.20, null],
  "gpt-6-luna": [0.01, null],
  "gpt-5.6-sol": [0.40, null], // developers.openai.com: cached input $0.40 at the $4/$20 promo rate
  "gpt-5.6-terra": [0.20, null],
});

function price(
  provider: TokenPrice["provider"],
  modelId: string,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  aliases: readonly string[] = [],
  modelSourceUrl: string = TOKEN_PRICING_SOURCES[provider],
): TokenPrice {
  const cache = CACHE_RATES[modelId];
  return Object.freeze({
    provider, modelId, inputUsdPerMillion, outputUsdPerMillion,
    aliases: Object.freeze([...aliases]),
    checkedAt: TOKEN_PRICING_CHECKED_AT,
    sourceUrl: TOKEN_PRICING_SOURCES[provider],
    modelSourceUrl,
    ...(cache ? { cacheReadUsdPerMillion: cache[0] } : {}),
    ...(cache && cache[1] !== null ? { cacheWriteUsdPerMillion: cache[1] } : {}),
  });
}

const openaiModel = "https://developers.openai.com/api/docs/models/";
const claudeModels = "https://platform.claude.com/docs/en/models/overview";
const claudeVersions = "https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions";
const claudeDeprecations = "https://platform.claude.com/docs/en/about-claude/model-deprecations";

export const TOKEN_PRICES: readonly TokenPrice[] = Object.freeze([
  // Official Standard pricing data: short-context baseline wherever tiered.
  price("openai", "gpt-6-astra", 10, 50),
  // Listed promotional standard rate, available at least through 2026-11-21.
  price("openai", "gpt-5.6-sol", 4, 20),
  price("openai", "gpt-5.6-terra", 2, 12),
  price("openai", "gpt-5.6-luna", 0.20, 1.20),
  price("openai", "gpt-5.5", 5, 30),
  price("openai", "gpt-5.5-pro", 30, 180),
  price("openai", "gpt-5.4", 2.50, 15),
  price("openai", "gpt-5.4-mini", 0.75, 4.50),
  price("openai", "gpt-5.4-nano", 0.20, 1.25),
  price("openai", "gpt-5.4-pro", 30, 180),
  price("openai", "gpt-5.2", 1.75, 14),
  price("openai", "gpt-5.2-pro", 21, 168),
  price("openai", "gpt-5.1", 1.25, 10),
  price("openai", "gpt-5", 1.25, 10, ["gpt-5-2025-08-07"], `${openaiModel}gpt-5`),
  price("openai", "gpt-5-mini", 0.25, 2),
  price("openai", "gpt-5-nano", 0.05, 0.40),
  price("openai", "gpt-5-pro", 15, 120),
  price("openai", "gpt-4.1", 2, 8, ["gpt-4.1-2025-04-14"], `${openaiModel}gpt-4.1`),
  price("openai", "gpt-4.1-mini", 0.40, 1.60),
  price("openai", "gpt-4.1-nano", 0.10, 0.40),
  price("openai", "gpt-4o", 2.50, 10, ["gpt-4o-2024-08-06"], `${openaiModel}gpt-4o`),
  // This older snapshot has a DIFFERENT published tariff. Never strip its date.
  price("openai", "gpt-4o-2024-05-13", 5, 15, [], `${openaiModel}gpt-4o`),
  price("openai", "gpt-4o-mini", 0.15, 0.60),
  price("openai", "o1", 15, 60),
  price("openai", "o1-pro", 150, 600),
  price("openai", "o3-pro", 20, 80),
  price("openai", "o3", 2, 8),
  price("openai", "o4-mini", 1.10, 4.40),
  price("openai", "o3-mini", 1.10, 4.40),
  // Each Codex ID and rate was checked on its own model page, not from the tool.
  price("openai", "gpt-5-codex", 1.25, 10, [], `${openaiModel}gpt-5-codex`),
  price("openai", "gpt-5.1-codex", 1.25, 10, [], `${openaiModel}gpt-5.1-codex`),
  price("openai", "gpt-5.1-codex-mini", 0.25, 2, [], `${openaiModel}gpt-5.1-codex-mini`),
  price("openai", "gpt-5.1-codex-max", 1.25, 10, [], `${openaiModel}gpt-5.1-codex-max`),
  price("openai", "gpt-5.2-codex", 1.75, 14, [], `${openaiModel}gpt-5.2-codex`),
  // Official pricing page: Specialized models / Standard, not Fast mode.
  price("openai", "gpt-5.3-codex", 1.75, 14),

  // Claude API IDs: overview/versioning docs plus the base input/output table.
  price("anthropic", "claude-fable-5-1", 10, 50, [], claudeModels),
  price("anthropic", "claude-fable-5", 10, 50, [], "https://platform.claude.com/docs/en/models/fable-5/overview"),
  price("anthropic", "claude-opus-5", 5, 25, [], claudeModels),
  price("anthropic", "claude-opus-4-8", 5, 25, [], claudeVersions),
  price("anthropic", "claude-opus-4-7", 5, 25, [], claudeVersions),
  price("anthropic", "claude-opus-4-6", 5, 25, [], claudeVersions),
  price("anthropic", "claude-opus-4-5-20251101", 5, 25, ["claude-opus-4-5"], "https://platform.claude.com/docs/en/models/opus-4-5/overview"),
  // Official pricing note: the scheduled Sep 1 increase was cancelled; $2/$10 is standard.
  price("anthropic", "claude-sonnet-5", 2, 10, [], claudeModels),
  price("anthropic", "claude-sonnet-4-6", 3, 15, [], claudeVersions),
  price("anthropic", "claude-sonnet-4-5-20250929", 3, 15, ["claude-sonnet-4-5"], "https://platform.claude.com/docs/en/models/sonnet-4-5/overview"),
  price("anthropic", "claude-haiku-4-5-20251001", 1, 5, ["claude-haiku-4-5"], claudeModels),
  // Retired on the Claude API but still listed with a price on the official pricing
  // page, and still present in older Claude Code session logs. Exact IDs and aliases
  // from the model-deprecations / model-ids docs; models the pricing page no longer
  // lists (Sonnet 3.7, Sonnet 3.5, Opus 3, Haiku 3) deliberately stay unknown.
  price("anthropic", "claude-opus-4-1-20250805", 15, 75, ["claude-opus-4-1"], claudeDeprecations),
  price("anthropic", "claude-opus-4-20250514", 15, 75, ["claude-opus-4-0"], claudeDeprecations),
  price("anthropic", "claude-sonnet-4-20250514", 3, 15, ["claude-sonnet-4-0"], claudeDeprecations),
  price("anthropic", "claude-3-5-haiku-20241022", 0.80, 4, ["claude-3-5-haiku-latest"], claudeDeprecations),
  // QA fix (R1), meta/plans/vibehub-qa-fix.md "Verified prices" (Sep 2026). APPENDED in
  // this exact order - the web table (web/src/lib/tokenPricing.ts) appends the same three
  // rows, and tokenPricingSync compares the two tables index by index.
  price("anthropic", "claude-opus-5-5", 4, 20),
  price("openai", "gpt-6-sol", 2, 10),
  price("openai", "gpt-6-luna", 0.10, 0.50),
]);

// A private Map avoids prototype-key lookups and exposes no mutable registry API.
const pricesById = new Map<string, TokenPrice>();
for (const entry of TOKEN_PRICES) {
  for (const id of [entry.modelId, ...entry.aliases]) pricesById.set(id, entry);
}

/** Exact, case-sensitive membership only. Unlisted/custom/future IDs stay unknown. */
export function getTokenPrice(model: unknown): TokenPrice | undefined {
  return typeof model === "string" ? pricesById.get(model) : undefined;
}

// ---------------------------------------------------------------------------------
// Cost fold - the server-side twin of web/src/lib/tokenCost.ts's estimateTokenCost.
//
// Same integer arithmetic (1e-12 USD units, so a sum is exact and order-independent
// and the sync check can compare the two sides to the unit), same rules: an unpriced
// model contributes nothing and makes the total partial; a total with nothing priced
// is null, not 0; a confirmed empty input is a legitimate 0; a malformed count makes
// the whole fold unavailable rather than silently sanitised.
// ---------------------------------------------------------------------------------

/** One usage row to price: a DailyStat row, an open Session, or a stats bucket. */
export interface PricedUsage {
  /** Model id as recorded (canonical or alias); null/"unknown" carry no price. */
  readonly model: string | null;
  /** FRESH input: includes cache writes, never cache reads. */
  readonly tokensInput: number;
  readonly tokensOutput: number;
  /** Cache reads, priced at the cache-read rate where one is verified. Default 0. */
  readonly tokensCacheRead?: number;
  /** The part of tokensInput written to the cache, priced at the cache-write rate. Default 0. */
  readonly tokensCacheWrite?: number;
}

export interface CostFold {
  /**
   * USD over every row whose model has a verified price. `null` when the rows carry
   * tokens but none could be priced, or when a zero-token input names an unknown model
   * (an unknown model is never a verified $0). A confirmed empty input is 0.
   */
  readonly estimatedUsd: number | null;
  /** The same amount as an exact integer in 1e-12 USD. Never serialise it (BigInt). */
  readonly amountUnits: bigint | null;
  /** Model id (as recorded) -> USD, priced models only; an alias is its own key. */
  readonly byModel: Record<string, number>;
  readonly pricedTokens: number;
  readonly totalTokens: number;
}

const RATE_SCALE = 1_000_000;
const USD_SCALE = 1_000_000_000_000n;
const CENT = USD_SCALE / 100n;
// Never hand out a value beyond safe cent precision, even after a future tariff update.
const MAX_COST_UNITS = BigInt(Number.MAX_SAFE_INTEGER) * CENT;

export function isValidTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// All published rates in this allowlist fit micro-USD per million tokens.
function rateUnits(rate: number): bigint | null {
  const scaled = rate * RATE_SCALE;
  return Number.isSafeInteger(scaled) && scaled > 0 ? BigInt(scaled) : null;
}

export function usdFromUnits(units: bigint): number {
  return Number(units) / Number(USD_SCALE);
}

/**
 * Exact cost of one row in 1e-12 USD, or null when the model is unpriced or a count is
 * malformed. With no cache counters (the 3-argument call) the arithmetic is exactly the
 * web's, which is what tokenPricingSync pins. Cache writes are a SUBSET of input: that
 * part moves from the input rate to the cache-write rate (input rate when none is
 * verified). Cache reads add at the cache-read rate, or nothing when none is verified -
 * an unverified rate is never guessed.
 */
export function costUnits(model: unknown, tokensInput: unknown, tokensOutput: unknown, tokensCacheRead: unknown = 0, tokensCacheWrite: unknown = 0): bigint | null {
  if (!isValidTokenCount(tokensInput) || !isValidTokenCount(tokensOutput) ||
      !isValidTokenCount(tokensCacheRead) || !isValidTokenCount(tokensCacheWrite) || tokensCacheWrite > tokensInput) return null;
  const tariff = getTokenPrice(model);
  if (!tariff) return null;
  const inputRate = rateUnits(tariff.inputUsdPerMillion);
  const outputRate = rateUnits(tariff.outputUsdPerMillion);
  if (inputRate === null || outputRate === null) return null;
  const readRate = tariff.cacheReadUsdPerMillion === undefined ? 0n : rateUnits(tariff.cacheReadUsdPerMillion);
  const writeRate = tariff.cacheWriteUsdPerMillion === undefined ? inputRate : rateUnits(tariff.cacheWriteUsdPerMillion);
  if (readRate === null || writeRate === null) return null;
  return BigInt(tokensInput - tokensCacheWrite) * inputRate + BigInt(tokensCacheWrite) * writeRate +
    BigInt(tokensCacheRead) * readRate + BigInt(tokensOutput) * outputRate;
}

/** USD for one (model, tokens) bucket - a stats `byModel` row - or null when unpriced. */
export function estimateUsd(model: unknown, tokensInput: unknown, tokensOutput: unknown, tokensCacheRead: unknown = 0, tokensCacheWrite: unknown = 0): number | null {
  const units = costUnits(model, tokensInput, tokensOutput, tokensCacheRead, tokensCacheWrite);
  return units === null || units > MAX_COST_UNITS ? null : usdFromUnits(units);
}

function unavailable(): CostFold {
  return { estimatedUsd: null, amountUnits: null, byModel: {}, pricedTokens: 0, totalTokens: 0 };
}

/**
 * sum(input * inputRate + output * outputRate) over the priced rows, plus the same
 * split per model. Rows are ORIGINAL per-model usage (never a pre-summed total), so
 * nothing is priced at a blended rate.
 */
export function foldEstimatedUsd(rows: readonly PricedUsage[]): CostFold {
  let totalTokens = 0;
  let pricedTokens = 0;
  let amountUnits = 0n;
  let hasUnknownModel = false;
  const perModel = new Map<string, bigint>();

  for (const row of rows) {
    if (!row || !isValidTokenCount(row.tokensInput) || !isValidTokenCount(row.tokensOutput) ||
        !isValidTokenCount(row.tokensCacheRead ?? 0) || !isValidTokenCount(row.tokensCacheWrite ?? 0) ||
        (row.tokensCacheWrite ?? 0) > row.tokensInput) return unavailable();
    const tokens = row.tokensInput + row.tokensOutput;
    totalTokens += tokens;
    if (!isValidTokenCount(tokens) || !isValidTokenCount(totalTokens)) return unavailable();

    const units = costUnits(row.model, row.tokensInput, row.tokensOutput, row.tokensCacheRead ?? 0, row.tokensCacheWrite ?? 0);
    if (units === null) {
      hasUnknownModel = true;
      continue;
    }
    pricedTokens += tokens;
    amountUnits += units;
    if (amountUnits > MAX_COST_UNITS) return unavailable();
    // costUnits only prices string ids, so `model` is a string here.
    const model = row.model as string;
    perModel.set(model, (perModel.get(model) ?? 0n) + units);
  }

  const byModel: Record<string, number> = {};
  for (const [model, units] of perModel) byModel[model] = usdFromUnits(units);

  if ((totalTokens === 0 && hasUnknownModel) || (totalTokens > 0 && pricedTokens === 0)) {
    return { estimatedUsd: null, amountUnits: null, byModel, pricedTokens, totalTokens };
  }
  return { estimatedUsd: usdFromUnits(amountUnits), amountUnits, byModel, pricedTokens, totalTokens };
}
