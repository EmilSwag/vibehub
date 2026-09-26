import type { TrackerSource } from "../types";
import { isTokenlessTool } from "./supportedTools";
import { getTokenPrice } from "./tokenPricing";
import { estimateTokenCost, isValidTokenCount, serverRowsCost, tokenlessCost } from "./tokenCost";
import type { ServerPricedUsage, TokenCostEstimate, TokenUsage } from "./tokenCost";

// ≈$ for the tracker panel (Home / Settings / onboarding), from `GET /users/me/tracker`.
//
// Server first: each source carries the server's exact `estimatedUsd` (real input /
// output / cache split), the same figure the Mac app shows from `/tracker/me`. Live QA
// 2026-09-26: the old client-only path guessed an 80/20 split and showed ≈ $0.22 where
// the server had $0.231. The guess below only runs against a server older than that
// field, and still prices EXACTLY via the verified tariff table: a model without one
// gets no ≈$, never a family or "standard" rate.

/** A source as a server-priced row; `estimatedUsd` only when the server sent it. */
function serverRow(source: TrackerSource): ServerPricedUsage {
  return {
    model: source.model,
    tokensInput: source.tokensToday,
    tokensOutput: 0,
    ...("estimatedUsd" in source ? { estimatedUsd: source.estimatedUsd } : {}),
  };
}

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
  return serverRowsCost([serverRow(source)], source.tokensToday)
    ?? estimateTokenCost([sourceUsage(source)], source.tokensToday);
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
  return serverRowsCost(measuring.map(serverRow), totalTokens)
    ?? estimateTokenCost(measuring.map(sourceUsage), totalTokens);
}
