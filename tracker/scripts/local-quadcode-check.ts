import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { QuadcodeAdapter, estimateTokens, stripToolResults } from "../src/adapters/quadcode";

// Local-only proof for Round 6: the Quadcode adapter. Fully isolated — it builds a
// throwaway QUADCODE_HOME tree and never reads the operator's real chat logs.
//
//   npx tsx scripts/local-quadcode-check.ts
//
// Pins the three measured properties of the real format (round 6 plan, Amendment 1):
// tokens are estimated because the logs carry none; the file *append* is the activity
// signal, not the record's own timestamp; and <TOOL_RESULT> transcript must not be
// counted as model output. Also pins the project-alias rule and the decision that a
// media-generation turn keeps the chat model.
//
// The async half runs inside main() because the tracker package is CommonJS, where
// top-level await is not available.

let pass = true;
const eq = (label: string, got: unknown, want: unknown) => {
  const okEq = JSON.stringify(got) === JSON.stringify(want);
  pass = pass && okEq;
  console.log(`${okEq ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(got)}${okEq ? "" : ` want ${JSON.stringify(want)}`}`);
};
const ok = (label: string, cond: boolean, detail = "") => {
  pass = pass && cond;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  ${detail}`}`);
};

const userRec = (message: string) => ({
  name: "PO",
  method: "USER",
  message,
  timestamp: "2026-09-05T10:00:00.000000",
  is_status_message: false,
  variations: [],
});
const llmRec = (message: string, model: string) => ({
  name: "Many",
  method: "LLM",
  message,
  timestamp: "2026-09-05T10:00:00.040000",
  is_status_message: false,
  variation_index: 0,
  variations: [{ model_name: model, cluster_node_info: { id: 1 }, meta_info: {} }],
});

function checkPureFunctions(): void {
  console.log("--- part 1: estimation and tool-result stripping ---");

  eq("estimateTokens('') === 0", estimateTokens(""), 0);
  eq("estimateTokens(4 chars) === 1", estimateTokens("abcd"), 1);
  eq("estimateTokens(400 chars) === 100", estimateTokens("x".repeat(400)), 100);

  const withResult = "prose before <TOOL_RESULT>" + "R".repeat(1000) + "</TOOL_RESULT> prose after";
  eq("stripToolResults drops the block", stripToolResults(withResult), "prose before  prose after");
  ok(
    "stripping cuts the estimate by the block size",
    estimateTokens(stripToolResults(withResult)) < estimateTokens(withResult) / 10,
    `${estimateTokens(stripToolResults(withResult))} vs ${estimateTokens(withResult)}`
  );

  // TOOL_RUN args are the model's own output and must survive.
  const withRun = 'say <TOOL_RUN>{"name":"ToolReadFile"}</TOOL_RUN> done';
  eq("stripToolResults keeps TOOL_RUN", stripToolResults(withRun), withRun);

  // An unterminated block (truncated record) drops everything after the opener
  // rather than counting half a transcript as model output.
  eq("unterminated TOOL_RESULT drops the tail", stripToolResults("keep <TOOL_RESULT>junk forever"), "keep ");

  // The real measurement from Amendment 1: 215,709 chars, 214,147 inside tool blocks.
  const realish = "p".repeat(1562) + "<TOOL_RESULT>" + "t".repeat(214_147) + "</TOOL_RESULT>";
  const naive = estimateTokens(realish);
  const corrected = estimateTokens(stripToolResults(realish));
  ok("measured record: naive estimate is >50x the corrected one", naive > corrected * 50, `naive=${naive} corrected=${corrected}`);
  eq("corrected estimate for 1562 chars of prose", corrected, 391);
}

async function main(): Promise<void> {
  checkPureFunctions();

  console.log("\n--- part 2: discovery, tailing and attribution ---");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vh-quadcode-"));
  process.env.QUADCODE_HOME = tmp;

  const writeChat = (project: string, name: string, records: unknown[]): string => {
    const dir = path.join(tmp, "apps", project, ".quadcodeai", ".data", "chats", "r4.files");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
    return file;
  };
  const append = (file: string, records: unknown[]): void => {
    fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
  const forProject = (list: Array<{ cwd: string | null }>, needle: string) =>
    list.find((o) => (o.cwd ?? "").includes(needle));

  try {
    // A chat that already exists when the tracker starts.
    const file = writeChat("Demo", "chat_1.jsonl", [userRec("hi"), llmRec("older reply", "claude-opus-5")]);
    const adapter = new QuadcodeAdapter(60 * 60 * 1000);

    const first = await adapter.poll();
    ok("first poll sees the chat", first.length === 1, JSON.stringify(first));
    eq("first poll reports the model from the tail peek", first[0]?.model, "claude-opus-5");
    eq("first poll replays no history (no tokens)", [first[0]?.tokensInputDelta, first[0]?.tokensOutputDelta], [0, 0]);
    eq("tool id", first[0]?.tool, "quadcode");
    eq("confidence is activity", first[0]?.confidence, "activity");

    // A new turn lands: 400 chars of prompt, 800 of reply, 40k of tool transcript.
    append(file, [
      userRec("x".repeat(400)),
      llmRec("y".repeat(800) + "<TOOL_RESULT>" + "z".repeat(40_000) + "</TOOL_RESULT>", "claude-fable-5-1"),
    ]);
    const second = await adapter.poll();
    const obs = second.find((o) => o.model === "claude-fable-5-1");
    ok("second poll picks up the new model", !!obs, JSON.stringify(second));
    eq("input estimated from the user message (400 / 4)", obs?.tokensInputDelta, 100);
    eq("output excludes the TOOL_RESULT block (800 / 4)", obs?.tokensOutputDelta, 200);
    ok(
      "every usage bucket is flagged estimated",
      (obs?.usage ?? []).length > 0 && (obs?.usage ?? []).every((u) => u.estimated === true),
      JSON.stringify(obs?.usage)
    );
    ok(
      "user tokens book under the last known model, not null",
      (obs?.usage ?? []).some((u) => u.model === "claude-opus-5" && u.tokensInputDelta === 100),
      JSON.stringify(obs?.usage)
    );

    // Activity is the append, not the record's embedded timestamp (turn start).
    const embedded = Date.parse("2026-09-05T10:00:00.040Z");
    ok(
      "lastActivityAt is the file append, not the embedded timestamp",
      (obs?.lastActivityAt ?? 0) > embedded + 60_000,
      `lastActivityAt=${obs?.lastActivityAt} embedded=${embedded}`
    );

    const third = await adapter.poll();
    eq("idle poll reports no new tokens", [third[0]?.tokensInputDelta, third[0]?.tokensOutputDelta], [0, 0]);

    // A media-generation turn keeps the chat model — no media model exists in the log.
    append(file, [
      llmRec(
        'generating <TOOL_RUN>{"name":"ToolGenerateResourceFileFromMetaSection","args":{"section_id":"files.resources.video.clip_mp4"}}</TOOL_RUN>',
        "claude-sonnet-5"
      ),
    ]);
    const fourth = await adapter.poll();
    eq("media turn reports the chat model, never a media model", fourth[0]?.model, "claude-sonnet-5");

    // An oversized record (inline base64 image upload) is skipped, not parsed.
    append(file, [userRec("B".repeat(3 * 1024 * 1024))]);
    const fifth = await adapter.poll();
    eq("oversized record contributes no tokens", fifth[0]?.tokensInputDelta, 0);

    console.log("\n--- part 3: project alias resolution ---");

    // (a) the sole git repo inside the project folder wins — the Vibemunity/vibehub case.
    fs.mkdirSync(path.join(tmp, "apps", "Demo", "innerrepo", ".git"), { recursive: true });
    const aliasObs = await new QuadcodeAdapter(60 * 60 * 1000).poll();
    eq("sole inner git repo becomes the project path", path.basename(forProject(aliasObs, "Demo")?.cwd ?? ""), "innerrepo");

    // (b) two inner repos are ambiguous -> fall back to the project folder name.
    writeChat("Twin", "chat_1.jsonl", [llmRec("hi", "claude-opus-5")]);
    fs.mkdirSync(path.join(tmp, "apps", "Twin", "a", ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "apps", "Twin", "b", ".git"), { recursive: true });
    const twin = await new QuadcodeAdapter(60 * 60 * 1000).poll();
    eq("ambiguous inner repos fall back to the folder name", path.basename(forProject(twin, "Twin")?.cwd ?? ""), "Twin");

    // (c) the project folder is itself a repo -> use it as-is.
    writeChat("SelfRepo", "chat_1.jsonl", [llmRec("hi", "claude-opus-5")]);
    fs.mkdirSync(path.join(tmp, "apps", "SelfRepo", ".git"), { recursive: true });
    const selfRepo = await new QuadcodeAdapter(60 * 60 * 1000).poll();
    eq("project folder that is itself a repo is used as-is", path.basename(forProject(selfRepo, "SelfRepo")?.cwd ?? ""), "SelfRepo");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
