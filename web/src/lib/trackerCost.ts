import type { TrackerSource } from "../types";
import { isTokenlessTool } from "./supportedTools";
import { getTokenPrice } from "./tokenPricing";
import { estimateTokenCost, isValidTokenCount, tokenlessCost } from "./tokenCost";
import type { TokenCostEstimate, TokenUsage } from "./tokenCost";

// ≈$ for the tracker panel (Home / Settings), from `GET /users/me/tracker` sources.
//
// That endpoint carries no server-side estimate (the one that does, `/tracker/me`, is
// tracker-token only), so this is the one ≈$ the web computes on its own. It prices
// EXACTLY like every other surface (lib/tokenCost + the tokenPricing table): a model
// without a verified tariff gets no ≈$ — never a family or "standard" rate. The old
// family fallbacks here were guesses and are gone (QA follow-up, 2026-09-26).

/** Verified cache-read rate for a model, via its exact tariff; null when none. */
export function cacheReadRate(model: string | null | undefined): number | null {
  return getTokenPrice(model)?.cacheReadUsdPerMillion ?? null;
}

/**
 * Sources only carry today's FRESH total, not its input/output split, so the split is
 * the stated 80/20 approximation. The rate itself is never approximated.
 */
function sourceUsage(source: TrackerSource): TokenUsage {
  const input = Math.round(source.tokensToday * 0.8);
  return {
    model: source.model,
    tokensInput: input,
    tokensOutput: source.tokensToday - input,
    cachedTokens: isValidTokenCount(source.cachedTokensToday) ? source.cachedTokensToday : undefined,
  };
}

/**
 * ≈$ for one (tool, model) row. A tool that reports no tokens gets no dollar figure at
 * all; an unknown model gets "≈ $—".
 */
export function estimateSourceCost(source: TrackerSource): TokenCostEstimate {
  if (isTokenlessTool(source.tool) && source.tokensToday <= 0) return tokenlessCost(source.tokensToday);
  if (!isValidTokenCount(source.tokensToday)) return estimateTokenCost(null, source.tokensToday);
  return estimateTokenCost([sourceUsage(source)], source.tokensToday);
}

/**
 * ≈$ for today across every source. Tokenless sources contribute no tokens and are
 * left out; a day made only of them is unmeasured, not free. Unknown models make the
 * figure partial (or unavailable when nothing is priceable).
 */
export function estimateTodayCost(sources: readonly TrackerSource[], totalTokens: number): TokenCostEstimate {
  const measuring = sources.filter((s) => !(isTokenlessTool(s.tool) && s.tokensToday <= 0));
  if (sources.length > 0 && measuring.length === 0) return tokenlessCost(totalTokens);
  if (measuring.some((s) => !isValidTokenCount(s.tokensToday))) return estimateTokenCost(null, totalTokens);
  return estimateTokenCost(measuring.map(sourceUsage), totalTokens);
}
