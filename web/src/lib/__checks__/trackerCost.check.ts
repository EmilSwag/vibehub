// QA (meta/plans/vibehub-qa-fix.md): every web ≈$ prefers the SERVER's figure when it is
// a finite number >= 0 and falls back to the exact client estimate otherwise. A model
// with no verified tariff gets no ≈$ anywhere — never a family or "standard" guess.
// Cache reads (R2) are secondary, never inside "tokens", and priced only at a verified
// cache-read rate. Pure, synthetic, no network. Run: node scripts/run-checks.mjs trackerCost
import { cacheReadRate, estimateSourceCost, estimateTodayCost } from "../trackerCost";
import { estimateTokenCost, isServerUsd, preferServerCost, serverRowsCost, serverTokenCost } from "../tokenCost";
import { groupStatsByModelWithCosts } from "../recentModels";
import { getTokenPrice } from "../tokenPricing";
import { sumToday } from "../sources";
import { humanizeModel, projectLabel } from "../format";
import type { StatByModel, TrackerSource } from "../../types";

let passed = 0;
const failures: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  const text = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
  if (text(actual) === text(expected)) { passed++; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}: expected ${text(expected)}, got ${text(actual)}`); }
}

// ---- the table: plan "Verified prices" rows and cache rates ----
const PLAN: [string, number, number, number, number | undefined][] = [
  ["claude-opus-5-5", 4, 20, 0.20, 5],
  ["claude-fable-5-1", 10, 50, 0.25, 12.5],
  ["claude-opus-5", 5, 25, 0.50, 6.25],
  ["claude-sonnet-5", 2, 10, 0.20, 2.5],
  ["claude-haiku-4-5", 1, 5, 0.10, 1.25],
  ["gpt-6-sol", 2, 10, 0.20, undefined],
  ["gpt-6-luna", 0.10, 0.50, 0.01, undefined],
  ["gpt-5.6-terra", 2, 12, 0.20, undefined],
];
for (const [model, input, output, read, write] of PLAN) {
  const tariff = getTokenPrice(model);
  eq(`${model}: in/out/cache-read/cache-write`,
    [tariff?.inputUsdPerMillion, tariff?.outputUsdPerMillion, tariff?.cacheReadUsdPerMillion, tariff?.cacheWriteUsdPerMillion],
    [input, output, read, write]);
}
eq("a model with no verified cache rate has none", getTokenPrice("gpt-4.1")?.cacheReadUsdPerMillion, undefined);
eq("cacheReadRate reads through aliases", cacheReadRate("claude-haiku-4-5"), 0.10);
eq("cacheReadRate is null for an unknown model", cacheReadRate("claude-opus-9"), null);

// ---- client exact estimate: cache reads, and no guessing ----
const opus = { model: "claude-opus-5-5", tokensInput: 1_000_000, tokensOutput: 0 };
eq("1M fresh input on Opus 5.5 = $4", estimateTokenCost([opus], 1_000_000).usd, 4);
eq("+100M cache reads adds $20, and stays out of the token total",
  [estimateTokenCost([{ ...opus, cachedTokens: 100_000_000 }], 1_000_000).usd, estimateTokenCost([{ ...opus, cachedTokens: 100_000_000 }], 1_000_000).totalTokens], [24, 1_000_000]);
eq("cache reads on a model without a verified cache rate add nothing",
  estimateTokenCost([{ ...opus, model: "gpt-4.1", cachedTokens: 100_000_000 }], 1_000_000).usd, 2);
eq("a malformed cache count invalidates the estimate", estimateTokenCost([{ ...opus, cachedTokens: -1 }], 1_000_000).status, "unavailable");
for (const model of ["claude-opus-9", "claude-sonnet-7", "gpt-7-nova", "gemini-4-pro", "grok-9", "mystery-model", null]) {
  eq(`unknown model ${JSON.stringify(model)} → no ≈$ (never a family guess)`,
    estimateTokenCost([{ ...opus, model }], 1_000_000).usd, null);
}

// ---- server first ----
eq("server USD must be a finite number >= 0",
  [0, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "3"].map(isServerUsd),
  [true, true, false, false, false, false, false, false]);
eq("a server total wraps as a complete estimate", serverTokenCost(12.34, 1_000, 1_000)?.status, "complete");
eq("server coverage below the total is partial", serverTokenCost(12.34, 1_000, 400)?.status, "partial");
eq("a server total over nothing priced falls back", serverTokenCost(5, 1_000, 0), null);
eq("an unusable server total falls back", [null, -1, Number.NaN].map((v) => serverTokenCost(v, 1_000, 1_000)), [null, null, null]);

// Server $ includes cache pricing the client cannot see: it must win.
const rows = (extra: Partial<StatByModel>[]): StatByModel[] => extra.map((row, i) => ({
  model: "claude-opus-5-5", tool: "claude-code", tokensInput: 1_000_000, tokensOutput: 0, activeSeconds: 60 + i, ...row,
}));
const serverRows = rows([{ estimatedUsd: 111 }, { model: "claude-sonnet-5", estimatedUsd: 9 }]);
eq("preferServerCost uses the server total when present", preferServerCost(serverRows, 2_000_000, 120).usd, 120);
eq("…else the sum of the server's row figures", preferServerCost(serverRows, 2_000_000).usd, 120);
eq("…a null server row is unpriced (partial), never guessed",
  [preferServerCost(rows([{ estimatedUsd: 7 }, { model: "claude-opus-9", estimatedUsd: null }]), 2_000_000).usd,
   preferServerCost(rows([{ estimatedUsd: 7 }, { model: "claude-opus-9", estimatedUsd: null }]), 2_000_000).status], [7, "partial"]);
eq("an older server (no estimatedUsd key) → exact client estimate", preferServerCost(rows([{}]), 1_000_000).usd, 4);
eq("an older server with a total but no row keys → client (coverage unknown)", preferServerCost(rows([{}]), 1_000_000, 999).usd, 4);
eq("a negative server figure → client", preferServerCost(rows([{ estimatedUsd: -3 }]), 1_000_000).usd, 4);
eq("server says unknown, client agrees: no ≈$", preferServerCost(rows([{ model: "claude-opus-9", estimatedUsd: null }]), 1_000_000).usd, null);
eq("serverRowsCost is null when nothing is priced", serverRowsCost(rows([{ estimatedUsd: null }]), 1_000_000), null);

// Recent models: each row and each tool bucket prefers its own server figures.
const grouped = groupStatsByModelWithCosts(rows([
  { tool: "claude-code", estimatedUsd: 30 },
  { tool: "codex", estimatedUsd: 10 },
]));
eq("model row = sum of its buckets' server ≈$", grouped[0].cost.usd, 40);
eq("tool buckets keep their own server ≈$", grouped[0].byTool.map((b) => b.cost.usd).sort(), [10, 30]);

// ---- tracker panel (no server figure on /users/me/tracker): exact only ----
const source = (over: Partial<TrackerSource>): TrackerSource => ({
  tool: "claude-code", model: "claude-opus-5-5", lastSeenAt: "2026-09-26T00:00:00.000Z",
  tokensToday: 2_000_000, tokens7d: 2_000_000, activeSecondsToday: 60, ...over,
});
const day = [source({ cachedTokensToday: 540_000_000 }), source({ model: "claude-sonnet-5", tokensToday: 0, cachedTokensToday: 1_000 })];
eq("tokens stay FRESH: cache reads never join the headline count", sumToday(day).tokens, 2_000_000);
eq("cache reads are summed separately", sumToday(day).cachedTokens, 540_001_000);
eq("an older server (no field) reads as 0 cached", sumToday([source({})]).cachedTokens, 0);
eq("source ≈$ adds verified cache reads", estimateSourceCost(source({ cachedTokensToday: 100_000_000 })).usd! - estimateSourceCost(source({})).usd!, 20);
eq("today ≈$ adds verified cache reads", estimateTodayCost(day, 2_000_000).usd! > estimateTodayCost([source({})], 2_000_000).usd!, true);
eq("an unknown model's source has no ≈$", estimateSourceCost(source({ model: "claude-opus-9" })).usd, null);
eq("a day of only unknown models has no ≈$", estimateTodayCost([source({ model: "claude-opus-9" })], 2_000_000).usd, null);
eq("an unknown model beside a known one makes today partial, not guessed",
  estimateTodayCost([source({}), source({ model: "claude-opus-9" })], 4_000_000).status, "partial");
eq("a tokenless-only day is unmeasured, not free", estimateTodayCost([source({ tool: "cursor", tokensToday: 0 })], 0).reason, "tokenless-tool");

// R1 / R5 end to end: never "null", never "unknown".
eq("R1: the new Opus reads as a name", humanizeModel("claude-opus-5-5"), "Opus 5.5");
eq("R1: GPT-6 Sol reads as a name", humanizeModel("gpt-6-sol"), "GPT-6 Sol");
eq("R5: an unmapped project is private, not unknown", projectLabel("unknown"), "Private project");

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`trackerCost check failed: ${failures.join(", ")}`);
