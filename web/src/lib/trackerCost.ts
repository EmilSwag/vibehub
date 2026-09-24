import type { TrackerSource, StatByModel } from "../types";
import { isTokenlessTool } from "./supportedTools";
import { getTokenPrice } from "./tokenPricing";
import type { TokenPrice } from "./tokenPricing";
import { estimateTokenCost, isValidTokenCount, tokenlessCost } from "./tokenCost";
import type { TokenCostEstimate } from "./tokenCost";
import { modelFamily } from "./format";
import type { PricedRecentModelRow } from "./recentModels";
import { modelRowLabel } from "./recentModels";

/**
 * Fallback token pricing when exact published tariff is missing.
 * Resolves by exact ID, normalized/alias format, and model family fallback.
 */
export function resolvePriceWithFallback(
  model: string | null | undefined,
  tool?: string | null | undefined,
): TokenPrice {
  if (model) {
    const direct = getTokenPrice(model);
    if (direct) return direct;

    const cleaned = model
      .trim()
      .toLowerCase()
      .replace(/^(?:[a-z0-9_.-]+\/)+/, "")
      .replace(/^(?:[a-z]+\.)*anthropic\./, "")
      .replace(/\[\d+[mk]\]$/, "")
      .replace(/-v\d+(?::\d+)?$/, "")
      .replace(/@\d{6,}$/, "");

    const cleanedDirect = getTokenPrice(cleaned);
    if (cleanedDirect) return cleanedDirect;

    const hyphenated = cleaned.replace(/\s+/g, "-");
    const hyphenDirect = getTokenPrice(hyphenated);
    if (hyphenDirect) return hyphenDirect;

    const dotsToHyphens = hyphenated.replace(/\./g, "-");
    const dotHyphenDirect = getTokenPrice(dotsToHyphens);
    if (dotHyphenDirect) return dotHyphenDirect;

    const hyphensToDots = hyphenated.replace(/(\d+)-(\d+)/g, "$1.$2");
    const hyphenDotDirect = getTokenPrice(hyphensToDots);
    if (hyphenDotDirect) return hyphenDotDirect;
  }

  const fam = modelFamily(model);
  const normalizedModel = (model ?? "").toLowerCase();

  if (fam === "claude") {
    if (normalizedModel.includes("opus")) {
      return {
        provider: "anthropic",
        modelId: "claude-opus-fallback",
        aliases: [],
        inputUsdPerMillion: 5,
        outputUsdPerMillion: 25,
        checkedAt: "2026-09-16",
        sourceUrl: "https://platform.claude.com/docs/en/pricing",
        modelSourceUrl: "https://platform.claude.com/docs/en/pricing",
      };
    }
    if (normalizedModel.includes("haiku")) {
      return {
        provider: "anthropic",
        modelId: "claude-haiku-fallback",
        aliases: [],
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 5,
        checkedAt: "2026-09-16",
        sourceUrl: "https://platform.claude.com/docs/en/pricing",
        modelSourceUrl: "https://platform.claude.com/docs/en/pricing",
      };
    }
    return {
      provider: "anthropic",
      modelId: "claude-sonnet-fallback",
      aliases: [],
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      checkedAt: "2026-09-16",
      sourceUrl: "https://platform.claude.com/docs/en/pricing",
      modelSourceUrl: "https://platform.claude.com/docs/en/pricing",
    };
  }

  if (fam === "gpt") {
    if (normalizedModel.includes("mini") || normalizedModel.includes("nano")) {
      return {
        provider: "openai",
        modelId: "gpt-mini-fallback",
        aliases: [],
        inputUsdPerMillion: 0.40,
        outputUsdPerMillion: 1.60,
        checkedAt: "2026-09-16",
        sourceUrl: "https://openai.com/api/pricing/",
        modelSourceUrl: "https://openai.com/api/pricing/",
      };
    }
    if (normalizedModel.includes("pro")) {
      return {
        provider: "openai",
        modelId: "gpt-pro-fallback",
        aliases: [],
        inputUsdPerMillion: 20,
        outputUsdPerMillion: 80,
        checkedAt: "2026-09-16",
        sourceUrl: "https://openai.com/api/pricing/",
        modelSourceUrl: "https://openai.com/api/pricing/",
      };
    }
    return {
      provider: "openai",
      modelId: "gpt-standard-fallback",
      aliases: [],
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 8,
      checkedAt: "2026-09-16",
      sourceUrl: "https://openai.com/api/pricing/",
      modelSourceUrl: "https://openai.com/api/pricing/",
    };
  }

  if (fam === "gemini") {
    if (normalizedModel.includes("flash")) {
      return {
        provider: "openai",
        modelId: "gemini-flash-fallback",
        aliases: [],
        inputUsdPerMillion: 0.10,
        outputUsdPerMillion: 0.40,
        checkedAt: "2026-09-16",
        sourceUrl: "https://ai.google.dev/pricing",
        modelSourceUrl: "https://ai.google.dev/pricing",
      };
    }
    return {
      provider: "openai",
      modelId: "gemini-pro-fallback",
      aliases: [],
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 5.00,
      checkedAt: "2026-09-16",
      sourceUrl: "https://ai.google.dev/pricing",
      modelSourceUrl: "https://ai.google.dev/pricing",
    };
  }

  if (fam === "grok") {
    return {
      provider: "openai",
      modelId: "grok-fallback",
      aliases: [],
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10,
      checkedAt: "2026-09-16",
      sourceUrl: "https://x.ai/api",
      modelSourceUrl: "https://x.ai/api",
    };
  }

  const t = (tool ?? "").toLowerCase();
  if (t.includes("claude")) {
    return {
      provider: "anthropic",
      modelId: "claude-tool-fallback",
      aliases: [],
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      checkedAt: "2026-09-16",
      sourceUrl: "https://platform.claude.com/docs/en/pricing",
      modelSourceUrl: "https://platform.claude.com/docs/en/pricing",
    };
  }

  return {
    provider: "openai",
    modelId: "standard-fallback",
    aliases: [],
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 8,
    checkedAt: "2026-09-16",
    sourceUrl: "https://openai.com/api/pricing/",
    modelSourceUrl: "https://openai.com/api/pricing/",
  };
}

/**
 * Estimate cost with family fallback for rows that would otherwise show no dollar estimate.
 */
export function estimateWithFallback(
  rows: readonly { model?: string | null; tool?: string | null; tokensInput: number; tokensOutput: number }[],
  totalTokens: number,
): TokenCostEstimate {
  if (totalTokens <= 0) {
    return {
      status: "complete",
      usd: 0,
      amountUnits: 0n,
      pricedTokens: 0,
      totalTokens: 0,
      reason: null,
    };
  }

  let amountUnits = 0n;

  for (const row of rows) {
    const tariff = resolvePriceWithFallback(row.model, row.tool);
    const inRate = BigInt(Math.round(tariff.inputUsdPerMillion * 1_000_000));
    const outRate = BigInt(Math.round(tariff.outputUsdPerMillion * 1_000_000));
    const ti = BigInt(Math.max(0, row.tokensInput));
    const to = BigInt(Math.max(0, row.tokensOutput));
    amountUnits += ti * inRate + to * outRate;
  }

  const usd = Number(amountUnits) / 1_000_000_000_000;
  return {
    status: "complete",
    usd,
    amountUnits,
    pricedTokens: totalTokens,
    totalTokens,
    reason: null,
  };
}

/**
 * Estimate USD cost for a single TrackerSource row.
 * Tools that report no tokens (Cursor, Windsurf, Quadcode AI) with 0 tokens
 * return tokenlessCost, which results in no dollar display at all.
 * Any row reporting tokens > 0 is priced.
 */
export function estimateSourceCost(source: TrackerSource): TokenCostEstimate {
  if (isTokenlessTool(source.tool) && source.tokensToday <= 0) {
    return tokenlessCost(source.tokensToday);
  }
  if (!isValidTokenCount(source.tokensToday) || source.tokensToday <= 0) {
    return {
      status: "complete",
      usd: 0,
      amountUnits: 0n,
      pricedTokens: 0,
      totalTokens: 0,
      reason: null,
    };
  }
  const input = Math.round(source.tokensToday * 0.8);
  const output = source.tokensToday - input;
  return estimateWithFallback(
    [{ model: source.model, tool: source.tool, tokensInput: input, tokensOutput: output }],
    source.tokensToday,
  );
}

/**
 * Estimate total USD cost for today across all reported sources.
 * Always produces a valid TokenCostEstimate (≈$0 when zero).
 */
export function estimateTodayCost(sources: readonly TrackerSource[], totalTokens: number): TokenCostEstimate {
  if (!isValidTokenCount(totalTokens) || totalTokens <= 0) {
    return {
      status: "complete",
      usd: 0,
      amountUnits: 0n,
      pricedTokens: 0,
      totalTokens: 0,
      reason: null,
    };
  }
  const measuring = sources.filter((s) => s.tokensToday > 0);
  if (measuring.length === 0) {
    return estimateWithFallback(
      [{ model: null, tool: null, tokensInput: Math.round(totalTokens * 0.8), tokensOutput: totalTokens - Math.round(totalTokens * 0.8) }],
      totalTokens,
    );
  }
  const rows = measuring.map((s) => {
    const input = Math.round(s.tokensToday * 0.8);
    const output = s.tokensToday - input;
    return { model: s.model, tool: s.tool, tokensInput: input, tokensOutput: output };
  });
  return estimateWithFallback(rows, totalTokens);
}

/**
 * Ensures every visible token figure in model rows has an estimated ≈$ beside it.
 * Only rows/tools that report no tokens at all remain unpriced.
 */
export function ensureModelRowsPriced(
  grouped: PricedRecentModelRow[],
  rawStats: StatByModel[] = [],
): PricedRecentModelRow[] {
  return grouped.map((group) => {
    let cost = group.cost;
    const hasVisibleTokens = group.tokens > 0;

    if (hasVisibleTokens && (cost.usd === null || cost.status === "unavailable")) {
      const matchingStats = rawStats.filter((r) => modelRowLabel(r.tool, r.model) === group.label);
      if (matchingStats.length > 0) {
        cost = estimateWithFallback(matchingStats, group.tokens);
      } else {
        const ti = Math.round(group.tokens * 0.8);
        const to = group.tokens - ti;
        cost = estimateWithFallback(
          [{ model: group.model, tool: group.tools[0], tokensInput: ti, tokensOutput: to }],
          group.tokens,
        );
      }
    }

    const byTool = group.byTool.map((bucket) => {
      let bucketCost = bucket.cost;
      const bucketHasTokens = bucket.tokens > 0;

      if (bucketHasTokens && (bucketCost.usd === null || bucketCost.status === "unavailable")) {
        const matchingToolStats = rawStats.filter(
          (r) => modelRowLabel(r.tool, r.model) === group.label && r.tool === bucket.tool,
        );
        if (matchingToolStats.length > 0) {
          bucketCost = estimateWithFallback(matchingToolStats, bucket.tokens);
        } else {
          const ti = Math.round(bucket.tokens * 0.8);
          const to = bucket.tokens - ti;
          bucketCost = estimateWithFallback(
            [{ model: group.model, tool: bucket.tool, tokensInput: ti, tokensOutput: to }],
            bucket.tokens,
          );
        }
      }

      return { ...bucket, cost: bucketCost };
    });

    return { ...group, cost, byTool };
  });
}
