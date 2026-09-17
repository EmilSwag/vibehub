// Standard text API-price equivalents, NOT invoices or subscription spending.
// Evidence, exact aliases and assumptions: meta/resources/vibehub-token-pricing.md.
// No network requests, provider SDKs, family matching or inferred model identities.

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
}

function price(
  provider: TokenPrice["provider"],
  modelId: string,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  aliases: readonly string[] = [],
  modelSourceUrl: string = TOKEN_PRICING_SOURCES[provider],
): TokenPrice {
  return Object.freeze({
    provider, modelId, inputUsdPerMillion, outputUsdPerMillion,
    aliases: Object.freeze([...aliases]),
    checkedAt: TOKEN_PRICING_CHECKED_AT,
    sourceUrl: TOKEN_PRICING_SOURCES[provider],
    modelSourceUrl,
  });
}

const openaiModel = "https://developers.openai.com/api/docs/models/";
const claudeModels = "https://platform.claude.com/docs/en/models/overview";
const claudeVersions = "https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions";

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
