import { getTokenPrice, TOKEN_PRICING_CHECKED_AT } from "./tokenPricing";

/** Accept existing model rows without trusting their runtime numeric values. */
export interface TokenUsage {
  readonly model?: unknown;
  readonly tokensInput?: unknown;
  readonly tokensOutput?: unknown;
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
  "Uses recorded input/output tokens at base rates. Subscriptions, cache, batch, long-context tiers and extra fees are not identified. " +
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
