import { getTokenPrice, TOKEN_PRICING_CHECKED_AT } from "./tokenPricing";

/** Accept existing model rows without trusting their runtime numeric values. */
export interface TokenUsage {
  readonly model?: unknown;
  readonly tokensInput?: unknown;
  readonly tokensOutput?: unknown;
  /** QA R2: cache reads beside (never inside) input/output. Priced only at a verified
   *  cache-read rate; absent = none. Same name as StatByModel's, so rows pass through. */
  readonly cachedTokens?: unknown;
}

export type TokenCostReason = "missing-breakdown" | "invalid-counts" | "overflow" | "inconsistent-total" | "unknown-model" | "tokenless-tool";

export interface TokenCostEstimate {
  readonly status: "complete" | "partial" | "unavailable";
  readonly usd: number | null;
  /** Exact unrounded sum in 1e-12 USD units, for subtotal reconciliation. */
  readonly amountUnits: bigint | null;
  readonly pricedTokens: number;
  readonly totalTokens: number | null;
  readonly reason: TokenCostReason | null;
}

const RATE_SCALE = 1_000_000;
const USD_SCALE = 1_000_000_000_000n;
const CENT = USD_SCALE / 100n;
// Never format a value beyond safe cent precision, even after a future tariff update.
const MAX_COST_UNITS = BigInt(Number.MAX_SAFE_INTEGER) * CENT;

export const TOKEN_COST_LIMITATIONS =
  "Approximate standard API-price equivalent in USD, not money paid. " +
  "Uses recorded input/output tokens at base rates, plus cache reads where a verified cache rate exists. " +
  "Subscriptions, other cache pricing, batch, long-context tiers and extra fees are not identified. Models without a verified price show no estimate. " +
  "Counts may themselves be estimated or incomplete; rates are not historical billing rates.";

export function isValidTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function unavailable(reason: TokenCostReason, totalTokens: number | null = null): TokenCostEstimate {
  return { status: "unavailable", usd: null, amountUnits: null, pricedTokens: 0, totalTokens, reason };
}

// All published rates in this allowlist fit micro-USD per million tokens. Integer
// accumulation avoids order-dependent float drift and rounding each source bucket.
function rateUnits(rate: number): bigint | null {
  const scaled = rate * RATE_SCALE;
  return Number.isSafeInteger(scaled) && scaled > 0 ? BigInt(scaled) : null;
}

/**
 * sum(input * inputRate + output * outputRate) / 1e6, using ORIGINAL model rows.
 * `displayedTokens` is required: missing coverage must not masquerade as a full
 * total, and a different range/response must not be substituted by the caller.
 * Any malformed count invalidates the estimate; never silently sanitize it to zero.
 */
export function estimateTokenCost(
  rows: readonly TokenUsage[] | null | undefined,
  displayedTokens: unknown,
): TokenCostEstimate {
  if (!isValidTokenCount(displayedTokens)) return unavailable("invalid-counts");
  if (!Array.isArray(rows)) return unavailable("missing-breakdown", displayedTokens);

  let sourceTokens = 0;
  let pricedTokens = 0;
  let amountUnits = 0n;
  let hasUnknownModel = false;

  for (const row of rows) {
    if (!row || !isValidTokenCount(row.tokensInput) || !isValidTokenCount(row.tokensOutput)) {
      return unavailable("invalid-counts", displayedTokens);
    }
    const tokens = row.tokensInput + row.tokensOutput;
    sourceTokens += tokens;
    if (!isValidTokenCount(tokens) || !isValidTokenCount(sourceTokens)) {
      return unavailable("overflow", displayedTokens);
    }

    const tariff = getTokenPrice(row.model);
    if (!tariff) {
      hasUnknownModel = true;
      continue;
    }
    const inputRate = rateUnits(tariff.inputUsdPerMillion);
    const outputRate = rateUnits(tariff.outputUsdPerMillion);
    if (inputRate === null || outputRate === null) return unavailable("overflow", displayedTokens);

    pricedTokens += tokens;
    amountUnits += BigInt(row.tokensInput) * inputRate + BigInt(row.tokensOutput) * outputRate;
    if (row.cachedTokens !== undefined && row.cachedTokens !== null) {
      if (!isValidTokenCount(row.cachedTokens)) return unavailable("invalid-counts", displayedTokens);
      // No verified cache-read rate → the reads add nothing. Never a guessed multiplier.
      const readRate = tariff.cacheReadUsdPerMillion === undefined ? 0n : rateUnits(tariff.cacheReadUsdPerMillion);
      if (readRate === null) return unavailable("overflow", displayedTokens);
      amountUnits += BigInt(row.cachedTokens) * readRate;
    }
    if (amountUnits > MAX_COST_UNITS) return unavailable("overflow", displayedTokens);
  }

  if (sourceTokens > displayedTokens) return unavailable("inconsistent-total", displayedTokens);
  // A confirmed empty response is a legitimate zero. A model-less zero row is not
  // a verified zero-price tariff; LevelBadge's absent breakdown also stays unknown.
  if ((displayedTokens === 0 && hasUnknownModel) || (displayedTokens > 0 && pricedTokens === 0)) {
    return unavailable(hasUnknownModel ? "unknown-model" : "missing-breakdown", displayedTokens);
  }

  const usd = Number(amountUnits) / Number(USD_SCALE);
  if (!Number.isFinite(usd)) return unavailable("overflow", displayedTokens);
  return {
    status: pricedTokens < displayedTokens ? "partial" : "complete",
    usd,
    amountUnits,
    pricedTokens,
    totalTokens: displayedTokens,
    reason: null,
  };
}

/* ---- the server's own ≈$ (QA follow-up) ----
 *
 * `/stats` prices every bucket server-side with the cache counters the web never sees
 * (cache writes are off the wire), so its figure is the better one. The web prefers it
 * whenever it is a finite number >= 0 and falls back to `estimateTokenCost` otherwise —
 * an older server, a missing field, or a null (no verified price: then the client, with
 * the same exact table, also shows no ≈$). Nothing here ever guesses a rate.
 */

/** A server USD figure is only trusted as a finite, non-negative number. */
export function isServerUsd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Rows as the server sends them: `estimatedUsd` null = unpriced, absent = older server. */
export interface ServerPricedUsage extends TokenUsage {
  readonly estimatedUsd?: unknown;
}

/**
 * How many of these rows' tokens the server priced, or null when any row predates
 * the field (then coverage is unknown and the server total is not used).
 */
export function serverPricedTokens(rows: readonly ServerPricedUsage[] | null | undefined): number | null {
  if (!Array.isArray(rows)) return null;
  let priced = 0;
  for (const row of rows) {
    if (!row || !("estimatedUsd" in row)) return null;
    if (!isServerUsd(row.estimatedUsd)) continue;
    if (!isValidTokenCount(row.tokensInput) || !isValidTokenCount(row.tokensOutput)) return null;
    priced += row.tokensInput + row.tokensOutput;
  }
  return priced;
}

/**
 * Wraps a server USD total as an estimate over `displayedTokens`, `pricedTokens` of
 * which the server could price. Null when the figure is unusable, so callers write
 * `serverTokenCost(...) ?? estimateTokenCost(...)`.
 */
export function serverTokenCost(usd: unknown, displayedTokens: unknown, pricedTokens: unknown): TokenCostEstimate | null {
  if (!isServerUsd(usd) || !isValidTokenCount(displayedTokens) || !isValidTokenCount(pricedTokens)) return null;
  const priced = Math.min(pricedTokens, displayedTokens);
  // "Priced nothing" with a number attached is inconsistent: let the client decide.
  if (displayedTokens > 0 && priced === 0) return null;
  const micros = Math.round(usd * 1_000_000);
  if (!Number.isSafeInteger(micros)) return null;
  const amountUnits = BigInt(micros) * 1_000_000n;
  if (amountUnits > MAX_COST_UNITS) return null;
  return {
    status: priced < displayedTokens ? "partial" : "complete",
    usd: Number(amountUnits) / Number(USD_SCALE),
    amountUnits,
    pricedTokens: priced,
    totalTokens: displayedTokens,
    reason: null,
  };
}

/** A subtotal from its server rows: the sum of their finite `estimatedUsd`, or null
 *  when any row predates the field or none is priced. */
export function serverRowsCost(rows: readonly ServerPricedUsage[] | null | undefined, displayedTokens: unknown): TokenCostEstimate | null {
  const priced = serverPricedTokens(rows);
  if (priced === null || !rows) return null;
  const usd = rows.reduce((sum, row) => sum + (isServerUsd(row.estimatedUsd) ? row.estimatedUsd : 0), 0);
  return priced === 0 ? null : serverTokenCost(usd, displayedTokens, priced);
}

/** Server first, client exact estimate second. */
export function preferServerCost(
  rows: readonly ServerPricedUsage[] | null | undefined,
  displayedTokens: unknown,
  serverTotalUsd?: unknown,
): TokenCostEstimate {
  const server = serverTotalUsd === undefined
    ? serverRowsCost(rows, displayedTokens)
    : serverTokenCost(serverTotalUsd, displayedTokens, serverPricedTokens(rows));
  return server ?? estimateTokenCost(rows, displayedTokens);
}

/**
 * A subtotal made entirely of tools that report no token count. Not a zero and not a
 * failed lookup: there is nothing to price, because the vendor publishes no counts at
 * all. Deliberately outside `estimateTokenCost` — that function prices the records it
 * is handed, and the decision that a whole class of record is unmeasured belongs to
 * the tool table (`supportedTools.ts`), not to the arithmetic.
 */
export function tokenlessCost(displayedTokens: unknown): TokenCostEstimate {
  return unavailable("tokenless-tool", isValidTokenCount(displayedTokens) ? displayedTokens : null);
}

function reasonText(reason: TokenCostReason | null): string {
  switch (reason) {
    case "tokenless-tool": return "This tool reports no token counts.";
    case "missing-breakdown": return "Model input/output breakdown is unavailable.";
    case "unknown-model": return "No verified model price for this usage.";
    case "inconsistent-total": return "Model usage does not match this token total.";
    case "overflow": return "Token usage is too large to estimate safely.";
    default: return "Token counts are missing or invalid.";
  }
}

function hasUsableAmount(estimate: TokenCostEstimate): boolean {
  return (estimate.status === "complete" || estimate.status === "partial") &&
    typeof estimate.amountUnits === "bigint" && estimate.amountUnits >= 0n && estimate.amountUnits <= MAX_COST_UNITS &&
    typeof estimate.usd === "number" && Number.isFinite(estimate.usd) && estimate.usd >= 0 &&
    isValidTokenCount(estimate.pricedTokens) && isValidTokenCount(estimate.totalTokens) &&
    estimate.pricedTokens <= estimate.totalTokens &&
    (estimate.status === "complete" ? estimate.pricedTokens === estimate.totalTokens : estimate.pricedTokens > 0 && estimate.pricedTokens < estimate.totalTokens);
}

function fullCurrency(units: bigint): string {
  const cents = (units + CENT / 2n) / CENT;
  return `$${(cents / 100n).toLocaleString("en-US")}.${String(cents % 100n).padStart(2, "0")}`;
}

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
});

export interface TokenCostPresentation {
  readonly amount: string;
  readonly coverage: string | null;
  readonly description: string;
}

/** Shared visible and AT text. No raw model IDs or invalid values enter UI copy. */
export function presentTokenCost(estimate: TokenCostEstimate): TokenCostPresentation {
  const checked = `Rates checked ${TOKEN_PRICING_CHECKED_AT}.`;
  if (!hasUsableAmount(estimate)) {
    return {
      amount: "≈ $—",
      coverage: null,
      description: `API estimate unavailable. ${reasonText(estimate.reason)} ${checked}`,
    };
  }

  const units = estimate.amountUnits!;
  const tiny = units > 0n && units < CENT;
  const usd = Number(units) / Number(USD_SCALE);
  const amount = tiny ? "≈ <$0.01" : `≈ ${usd >= 1_000_000 ? compactCurrency.format(usd) : fullCurrency(units)}`;
  const spokenAmount = tiny ? "less than $0.01 USD" : `${fullCurrency(units)} USD`;

  if (estimate.status === "partial") {
    // Floor in exact integer arithmetic: incomplete coverage can NEVER round to 100%.
    const percent = BigInt(estimate.pricedTokens) * 100n / BigInt(estimate.totalTokens!);
    return {
      amount,
      coverage: `partial · ${percent === 0n ? "<1" : percent}% covered`,
      description: `Partial standard API-price equivalent: ${spokenAmount}. ` +
        `${estimate.pricedTokens.toLocaleString("en-US")} of ${estimate.totalTokens!.toLocaleString("en-US")} tokens covered; unpriced usage excluded. ${checked}`,
    };
  }

  return {
    amount,
    coverage: null,
    description: `Approximate standard API-price equivalent: ${spokenAmount}. ${checked}`,
  };
}
