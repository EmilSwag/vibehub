import { QuadcodeAdapter, estimateTokens, stripToolResults } from "../src/adapters/quadcode";
import { projectAttestedRecord } from "../src/adapters/attested";
import { eventTime } from "../src/privacy";

// Quadcode AI: the documented chat-log schema, and why it cannot feed the collector.
//
//   npx tsx scripts/local-quadcode-check.ts
//
// This script reads NOTHING. It builds the record shape documented in
// docs/ARCHITECTURE.md 4.5 (measured in the round-6 sweep: 44 chat logs, 13 projects,
// 341 LLM records) and demonstrates, on that shape alone, the two properties that keep
// native Quadcode support switched off:
//
//   1. `timestamp` is local ISO with NO timezone, so it is not an instant at all until
//      someone guesses the host's UTC offset. The collector refuses to guess.
//   2. On an LLM record that stamp is the turn *start*, and the line is appended only
//      once the turn ends (one measured record spanned 3h47m). So nothing inside the
//      file dates the reply; only the file append does, and append time is a
//      filesystem heuristic, not AI evidence.
//
// Together: the schema proves no dated AI request or response. What replaced the old
// estimator is the opt-in receiver (adapters/attested.ts), exercised in part 3 - a
// producer that genuinely knows when a turn finished states it, with a timezone, and
// says whether its token counts were measured. Unknown stays unknown.
//
// The previous version of this file asserted the deleted character-count estimator and
// had been failing on its first assertion ever since that estimator was removed; it was
// also orphaned (not in `npm test`, not in tsconfig.json, not in check-ai-only.mjs).
//
// The async half runs inside main() because the tracker package is CommonJS, where
// top-level await is not available.

let pass = true;
const eq = (label: string, got: unknown, want: unknown): void => {
  const okEq = JSON.stringify(got) === JSON.stringify(want);
  pass = pass && okEq;
  console.log(`${okEq ? "PASS" : "FAIL"}  ${label} - got ${JSON.stringify(got)}${okEq ? "" : ` want ${JSON.stringify(want)}`}`);
};
const ok = (label: string, cond: boolean, detail = ""): void => {
  pass = pass && cond;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  ${detail}`}`);
};

// --- The documented record shape (docs/ARCHITECTURE.md 4.5) -----------------------
// Kept verbatim: this is the project's only surviving record of the format.
const userRecord = {
  name: "PO",
  method: "USER",
  message: "<prompt text - never read, never forwarded>",
  timestamp: "2026-09-05T21:18:11.712000",
  is_status_message: false,
  variations: [],
};
const llmRecord = {
  name: "Many",
  method: "LLM",
  message: "<reply plus ~99% embedded tool transcript - never read, never forwarded>",
  timestamp: "2026-09-05T21:18:11.752000",
  is_status_message: false,
  variation_index: 0,
  variations: [{
    model_name: "claude-fable-5-1",
    cluster_node_info: { id: 1 },
    meta_info: { stop_reason: "end_turn", max_tokens: true },
  }],
};

const NOW = Date.parse("2026-09-05T21:19:00.000Z");
const WINDOW = 5 * 60_000;
const CONSENTED = ["quadcode"];

async function main(): Promise<void> {
  console.log("--- part 1: the native adapter reads nothing when there is no tree ---");

  // Round 4: the adapter is live. Pointed at a home that has no Quadcode tree it finds
  // nothing and does not throw — absence is unavailability, never an error or a guess.
  eq("QuadcodeAdapter.poll() discovers nothing without a Quadcode tree",
    await new QuadcodeAdapter(WINDOW, "/nonexistent-fixture-home").poll(NOW), []);
  eq("the retired character-count estimator returns no tokens", estimateTokens("x".repeat(400)), 0);
  eq("the retired transcript stripper retains no content", stripToolResults("keep <TOOL_RESULT>drop</TOOL_RESULT>"), "");

  console.log("\n--- part 2: the documented schema cannot date a request or a response ---");

  ok("an LLM record does carry a model id - the one field that IS reliable",
    llmRecord.variations[0]?.model_name === "claude-fable-5-1");
  ok("...but meta_info.max_tokens is a boolean flag, not a count",
    typeof llmRecord.variations[0]?.meta_info.max_tokens === "boolean");
  ok("...and cluster_node_info is a node id, not usage",
    JSON.stringify(llmRecord.variations[0]?.cluster_node_info) === '{"id":1}');

  eq("a USER timestamp is not an instant the collector accepts", eventTime(userRecord.timestamp, NOW, WINDOW), null);
  eq("an LLM timestamp is not an instant either", eventTime(llmRecord.timestamp, NOW, WINDOW), null);
  ok("the only difference from an acceptable stamp is the missing zone",
    eventTime(`${llmRecord.timestamp.slice(0, 23)}Z`, NOW, WINDOW) !== null);
  ok("the LLM stamp is the turn START: 40 ms after the user's, for work that ran for hours",
    Date.parse(`${llmRecord.timestamp}Z`) - Date.parse(`${userRecord.timestamp}Z`) === 40);

  console.log("\n--- part 3: what the opt-in receiver accepts instead ---");

  const measured = projectAttestedRecord({
    v: 1, tool: "quadcode", recordId: "turn-1", occurredAt: "2026-09-05T21:18:30.000Z",
    model: "claude-fable-5-1", projectHint: "vibehub",
    measured: true, tokensInputDelta: 391, tokensOutputDelta: 120,
  }, NOW, WINDOW, CONSENTED);
  eq("a dated, measured record is accepted", measured?.tool, "quadcode");
  eq("...with its model preserved", measured?.model, "claude-fable-5-1");
  // Round 4: quadcode is TOKENLESS. Even a producer's measured claim is not attributed
  // for it — the turn counts as activity and as a model sighting, and usage stays
  // unknown. The measured path remains for a future tool that has a real counter.
  eq("...but NOT its counts: quadcode has no token counter in any source", measured?.usage, []);
  eq("...and no path attached", measured?.cwd, null);

  const unmeasured = projectAttestedRecord({
    v: 1, tool: "quadcode", recordId: "turn-2", occurredAt: "2026-09-05T21:18:40.000Z",
    model: "claude-fable-5-1", projectHint: "vibehub", measured: false,
  }, NOW, WINDOW, CONSENTED);
  eq("an unmeasured record still reports activity", unmeasured?.tool, "quadcode");
  eq("...and reports NO usage rather than a zero", unmeasured?.usage, []);

  eq("the raw chat timestamp is rejected even from a producer", projectAttestedRecord({
    v: 1, tool: "quadcode", recordId: "turn-3", occurredAt: llmRecord.timestamp,
    model: "claude-fable-5-1", projectHint: "vibehub", measured: false,
  }, NOW, WINDOW, CONSENTED), null);

  eq("an estimate is rejected outright", projectAttestedRecord({
    v: 1, tool: "quadcode", recordId: "turn-4", occurredAt: "2026-09-05T21:18:50.000Z",
    model: "claude-fable-5-1", projectHint: "vibehub",
    measured: true, tokensInputDelta: 391, tokensOutputDelta: 120, estimated: true,
  }, NOW, WINDOW, CONSENTED), null);

  eq("an unreviewed model id stays unknown", projectAttestedRecord({
    v: 1, tool: "quadcode", recordId: "turn-5", occurredAt: "2026-09-05T21:18:55.000Z",
    model: "grok-4.6", projectHint: "vibehub", measured: false,
  }, NOW, WINDOW, CONSENTED)?.model, null);

  eq("nothing is accepted without consent", projectAttestedRecord({
    v: 1, tool: "quadcode", recordId: "turn-6", occurredAt: "2026-09-05T21:18:58.000Z",
    model: "claude-fable-5-1", projectHint: "vibehub", measured: false,
  }, NOW, WINDOW, []), null);
}

void main().then(
  () => {
    console.log(pass ? "\nALL PASS" : "\nFAILURES ABOVE");
    if (!pass) process.exitCode = 1;
  },
  (err) => {
    console.error("check crashed:", err);
    process.exitCode = 1;
  }
);
