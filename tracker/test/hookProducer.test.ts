// Round 5: the Cursor / Windsurf hook PRODUCER - the process a vendor's own hook system
// spawns, which turns one AI event into one bounded metadata record.
//
// The contract pinned here, field by field. A record is exactly:
//   { v: 1, tool: <from argv>, recordId: <fresh random>, occurredAt: <instant>,
//     model: <allowlisted or null>, projectHint?: <folder basename> }
// and NOTHING else - no `measured`, no token counts, no `estimated`, in any polarity.
// Absence is the claim: there is no field for a later change to flip, and the receiver
// reads absent counts as unknown rather than as a measured zero.
//
// Two further properties are what the fixtures below exist for:
//   1. Nothing a vendor hands us survives into the record. Every fixture fills every
//      documented vendor field - prompt, transcript path, workspace roots, e-mail,
//      conversation and trajectory ids, the entire Cascade response - with a canary, and
//      the serialized record must not contain it. The record is CONSTRUCTED, never copied,
//      and the only thing taken from a path is its last segment.
//   2. What the producer writes, the receiver accepts; what the receiver rejects, the
//      producer never writes. The last suite runs both directions.
//
// SAFETY: HOME/USERPROFILE are redirected to a throwaway directory BEFORE any tracker
// module is required, and the redirect is asserted. A real ~/.vibehub - and any daemon
// running against it on this machine - is never read or written. No vendor is installed,
// no IDE is launched, no network call is made.

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, it } from "node:test";

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "hook-producer-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.HOMEDRIVE = sandbox.slice(0, 2);
process.env.HOMEPATH = sandbox.slice(2);

const { ATTESTED_PATH, CONFIG_DIR, CONFIG_PATH } = require("../src/paths") as typeof import("../src/paths");
if (!CONFIG_DIR.startsWith(sandbox)) {
  throw new Error(`refusing to run: the tracker resolves ${CONFIG_DIR}, not the sandbox ${sandbox}`);
}
const { projectHookEvent, hookEventsFor, isHookableTool, HOOKABLE_TOOLS } =
  require("../src/hooks/payload") as typeof import("../src/hooks/payload");
const { appendAttestedRecord, runHookEvent, MAX_HOOK_STDIN_BYTES } =
  require("../src/hooks/inbox") as typeof import("../src/hooks/inbox");
const { projectAttestedRecord } = require("../src/adapters/attested") as typeof import("../src/adapters/attested");

const CANARY = "NEVER_EXPORT_PROMPTS_CODE_OR_TOOL_OUTPUT";
const NOW = Date.parse("2026-06-09T12:00:00.000Z");
const NOW_ISO = "2026-06-09T12:00:00.000Z";
const WINDOW = 5 * 60_000;
/** A zoned stamp 30 s old: a real instant, inside the window. */
const FRESH_ZONED = new Date(NOW - 30_000).toISOString();

/** Every base field Cursor documents, each one poisoned. */
const cursorPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  hook_event_name: "stop",
  status: "completed",
  loop_count: 0,
  model: "claude-opus-5",
  conversation_id: `conv-${CANARY}`,
  generation_id: `gen-${CANARY}`,
  cursor_version: "2.4.1",
  workspace_roots: [`/Users/someone/${CANARY}/demo-project`],
  user_email: `${CANARY}@example.invalid`,
  transcript_path: `/Users/someone/.cursor/transcripts/${CANARY}.jsonl`,
  prompt: CANARY,
  attachments: [{ type: "file", file_path: `/Users/someone/${CANARY}.ts` }],
  ...overrides,
});

const windsurfPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  agent_action_name: "post_cascade_response",
  trajectory_id: `traj-${CANARY}`,
  execution_id: `exec-${CANARY}`,
  timestamp: FRESH_ZONED,
  model_name: "claude-opus-5",
  cwd: `/Users/someone/${CANARY}/demo-project`,
  tool_info: { Response: `# heading\n${CANARY}`, command: CANARY },
  ...overrides,
});

const payloadFor = (tool: string, overrides: Record<string, unknown> = {}): Record<string, unknown> =>
  tool === "cursor" ? cursorPayload(overrides) : windsurfPayload(overrides);
const eventKey = (tool: string): string => tool === "cursor" ? "hook_event_name" : "agent_action_name";
const modelKey = (tool: string): string => tool === "cursor" ? "model" : "model_name";
const pathKey = (tool: string): string => tool === "cursor" ? "workspace_roots" : "cwd";
const pathValue = (tool: string, path: unknown): unknown => tool === "cursor" ? [path] : path;

const writeConfig = (attested?: { enabled: boolean; tools: string[] }): void => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({
    apiUrl: "https://tracker-fixture.invalid",
    deviceToken: "SYNTHETIC_ONLY_NOT_A_CREDENTIAL",
    projectAliases: {},
    ...(attested ? { attestedMetadata: attested } : {}),
  }));
};
const readInbox = (): string[] => {
  try { return readFileSync(ATTESTED_PATH, "utf8").split("\n").filter(Boolean); }
  catch { return []; }
};
const feed = (value: string): Readable => Readable.from([Buffer.from(value, "utf8")]);

/**
 * A pipe that never ends - what an IDE hands a hook when stdin is inherited or held open
 * for the session. `consumed` records whether anything ever tried to read it, which is how
 * "an unlisted tool is inert" is proved rather than asserted.
 */
class OpenPipe extends Readable {
  consumed = false;
  _read(): void { this.consumed = true; }
}

describe("hook producer: the record is exactly six fields, and five of them are ours", () => {
  for (const tool of HOOKABLE_TOOLS) {
    it(`${tool}: writes v/tool/recordId/occurredAt/model/projectHint and nothing else`, () => {
      const record = projectHookEvent(tool, payloadFor(tool), NOW);
      assert.ok(record);
      assert.deepEqual(Object.keys(record),
        ["v", "tool", "recordId", "occurredAt", "model", "projectHint"]);
      assert.equal(record.v, 1);
      assert.equal(record.tool, tool);
      assert.equal(record.model, "claude-opus-5");
      assert.equal(record.projectHint, "demo-project");
    });
    it(`${tool}: omits measured, token counts and estimated in every polarity`, () => {
      // A payload that tries hard to be measured. None of it has a way in: the producer
      // has no code path that writes any of these keys.
      const record = projectHookEvent(tool, payloadFor(tool, {
        measured: true, estimated: true, tokensInputDelta: 4000, tokensOutputDelta: 900,
        usage: { input_tokens: 4000 }, token_count: 4900, tokens: 4900,
      }), NOW);
      assert.ok(record);
      for (const key of ["measured", "estimated", "tokensInputDelta", "tokensOutputDelta", "usage", "tokens"]) {
        assert.equal(Object.hasOwn(record, key), false, `record must not carry ${key}`);
      }
    });
    it(`${tool}: takes its tool id from argv, never from the payload`, () => {
      const other = tool === "cursor" ? "windsurf" : "cursor";
      const record = projectHookEvent(tool, payloadFor(tool, { tool: other, v: 99 }), NOW);
      assert.equal(record?.tool, tool);
      assert.equal(record?.v, 1);
    });
    it(`${tool}: carries no vendor string at all`, () => {
      const line = JSON.stringify(projectHookEvent(tool, payloadFor(tool), NOW));
      assert.ok(!line.includes(CANARY), `a vendor field leaked into the record: ${line}`);
      // Not just the canary: no vendor VALUE, no full path, no id, no version.
      for (const value of ["2.4.1", "completed", "post_cascade_response", "stop", "conv-",
        "exec-", "traj-", "gen-", "/Users/someone", "example.invalid"]) {
        assert.ok(!line.includes(value), `record carries vendor value ${value}`);
      }
    });
  }
});

describe("hook producer: only the subscribed events, and not one more", () => {
  it("Cursor: afterAgentResponse and stop - turn completions only", () => {
    assert.deepEqual(hookEventsFor("cursor"), ["afterAgentResponse", "stop"]);
  });
  it("Windsurf: pre_user_prompt and post_cascade_response", () => {
    assert.deepEqual(hookEventsFor("windsurf"),
      ["pre_user_prompt", "post_cascade_response"]);
  });
  for (const tool of HOOKABLE_TOOLS) {
    it(`${tool}: every subscribed event produces a record`, () => {
      for (const event of hookEventsFor(tool)) {
        assert.ok(projectHookEvent(tool, payloadFor(tool, { [eventKey(tool)]: event }), NOW),
          `${event} should produce a record`);
      }
    });
    it(`${tool}: everything else produces nothing`, () => {
      for (const event of [
        // Windsurf's transcript variant writes the whole conversation to disk.
        "post_cascade_response_with_transcript",
        // Cursor's beforeSubmitPrompt payload IS the prompt the user just typed.
        "beforeSubmitPrompt",
        // F7: a session boundary is not a turn, and sessionEnd can fire hours after the
        // last model call. Retired from the subscribed set and refused on arrival.
        "sessionStart", "sessionEnd",
        // The other vendor's names, file/command/MCP events, and junk.
        "pre_user_prompt", "post_cascade_response", "afterAgentResponse", "stop",
        "pre_write_code", "post_run_command", "afterFileEdit", "beforeShellExecution",
        "preToolUse", "afterAgentThought", "workspaceOpen", "", "STOP", 7, null, undefined,
      ].filter((event) => !hookEventsFor(tool).includes(event as string))) {
        assert.equal(projectHookEvent(tool, payloadFor(tool, { [eventKey(tool)]: event }), NOW), null,
          `${String(event)} must not produce a record`);
      }
    });
  }
});

describe("hook producer: dating follows the vendor, never a repair", () => {
  it("Cursor is stamped now, because Cursor publishes no timestamp", () => {
    assert.equal(projectHookEvent("cursor", cursorPayload(), NOW)?.occurredAt, NOW_ISO);
    // Even if a payload grows one, Cursor's row does not read it: an unspecified field
    // is not a contract, and `now` is a real observation.
    assert.equal(projectHookEvent("cursor", cursorPayload({ timestamp: FRESH_ZONED }), NOW)?.occurredAt, NOW_ISO);
  });
  it("Windsurf uses its own stamp when it is a fresh, zoned instant", () => {
    assert.equal(projectHookEvent("windsurf", windsurfPayload(), NOW)?.occurredAt, FRESH_ZONED);
    assert.equal(projectHookEvent("windsurf", windsurfPayload({ timestamp: "2026-06-09T13:59:30.000+02:00" }), NOW)
      ?.occurredAt, "2026-06-09T11:59:30.000Z");
  });
  it("Windsurf falls back to now for a zoneless, stale, future or malformed stamp", () => {
    for (const timestamp of [
      "2026-06-09T11:59:30.000000",            // the zoneless local shape - never repaired
      "2026-06-09 11:59:30",
      new Date(NOW - 10 * 60_000).toISOString(), // stale: outside the active window
      new Date(NOW + 10 * 60_000).toISOString(), // future beyond the skew bound
      NOW, "", CANARY, null, undefined, {},
    ]) {
      assert.equal(projectHookEvent("windsurf", windsurfPayload({ timestamp }), NOW)?.occurredAt, NOW_ISO,
        `${String(timestamp)} must fall back to now`);
    }
  });
});

describe("hook producer: the model is allowlisted, the allowlist is not widened", () => {
  for (const tool of HOOKABLE_TOOLS) {
    it(`${tool}: keeps a reviewed id`, () => {
      assert.equal(projectHookEvent(tool, payloadFor(tool, { [modelKey(tool)]: "gpt-5-codex" }), NOW)?.model, "gpt-5-codex");
      assert.equal(projectHookEvent(tool, payloadFor(tool, { [modelKey(tool)]: "claude-fable-5-1" }), NOW)?.model, "claude-fable-5-1");
    });
    it(`${tool}: nulls a vendor display id rather than adding it`, () => {
      // These are what the vendors actually show. They are NOT provider API ids, and no
      // entry is added on a hook tool's behalf - the turn is reported with no model.
      for (const model of ["claude-4.5-sonnet", "auto", "gpt-5-high", "swe-1.5", "grok-4.6",
        CANARY, "", 42, null, undefined, {}]) {
        const record = projectHookEvent(tool, payloadFor(tool, { [modelKey(tool)]: model }), NOW);
        assert.equal(record?.model, null, `${String(model)} must not be reported`);
        if (typeof model === "string" && model.length > 3) {
          assert.ok(!JSON.stringify(record).includes(model));
        }
      }
    });
  }
});

describe("hook producer: the project hint is a basename or nothing", () => {
  for (const tool of HOOKABLE_TOOLS) {
    it(`${tool}: takes the last segment and never the path`, () => {
      const record = projectHookEvent(tool, payloadFor(tool,
        { [pathKey(tool)]: pathValue(tool, "/Users/someone/secrets/Client Work 2026") }), NOW);
      assert.equal(record?.projectHint, "Client Work 2026");
      assert.ok(!JSON.stringify(record).includes("/Users/someone"));
      assert.ok(!JSON.stringify(record).includes("secrets"));
    });
    it(`${tool}: accepts a Windows path the same way`, () => {
      assert.equal(projectHookEvent(tool, payloadFor(tool,
        { [pathKey(tool)]: pathValue(tool, "C:\\Users\\someone\\Projects\\vibehub") }), NOW)?.projectHint, "vibehub");
    });
    it(`${tool}: omits the hint entirely when there is no usable path`, () => {
      for (const path of ["", "relative/path", "../escape", "/", "/Users/someone/..",
        "/Users/someone/pro\u0000ject", "/Users/someone/-leading-dash", 42, null, undefined, {}, []]) {
        const record = projectHookEvent(tool, payloadFor(tool, { [pathKey(tool)]: pathValue(tool, path) }), NOW);
        assert.ok(record, `${String(path)} should still produce a record`);
        assert.equal(Object.hasOwn(record, "projectHint"), false,
          `${String(path)} must not produce a hint`);
      }
    });
  }
  it("Cursor reads the first workspace root and ignores the rest", () => {
    const record = projectHookEvent("cursor", cursorPayload({
      workspace_roots: [42, "/Users/someone/first-root", "/Users/someone/second-root"],
    }), NOW);
    assert.equal(record?.projectHint, "first-root");
  });
});

describe("hook producer: record ids are fresh and random", () => {
  it("never repeats, not even for a byte-identical payload", () => {
    const ids = new Set(Array.from({ length: 50 },
      () => projectHookEvent("cursor", cursorPayload(), NOW)?.recordId));
    assert.equal(ids.size, 50);
  });
  it("is a plain UUID - no digest of a vendor id, and nothing derived from one", () => {
    const record = projectHookEvent("windsurf", windsurfPayload(), NOW);
    assert.match(record?.recordId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The receiver's own bound on the field.
    assert.ok((record?.recordId.length ?? 0) <= 128);
    assert.ok(!/[^A-Za-z0-9._-]/.test(record?.recordId ?? ""));
  });
});

describe("hook producer: refuses what it cannot honestly record", () => {
  it("refuses an unknown tool, a non-object payload and a broken clock", () => {
    for (const tool of ["claude-code", "codex", "quadcode", "chatgpt", "", null, 7]) {
      assert.equal(projectHookEvent(tool, cursorPayload(), NOW), null);
    }
    for (const payload of [null, undefined, "{}", 7, [], [cursorPayload()]]) {
      assert.equal(projectHookEvent("cursor", payload, NOW), null);
    }
    for (const clock of [Number.NaN, Infinity, -Infinity]) {
      assert.equal(projectHookEvent("cursor", cursorPayload(), clock), null);
    }
    assert.equal(isHookableTool("cursor"), true);
    assert.equal(isHookableTool("claude-code"), false);
  });
});

describe("hook producer: the tool tables say what each id may do", () => {
  const { ATTESTED_TOOLS, NATIVE_TOOLS, SUPPORTED_TOOLS, TOKENLESS_TOOLS, isAttestedTool, isNativeTool,
    isSupportedTool, isTokenlessTool } = require("../src/privacy") as typeof import("../src/privacy");

  it("makes both hook tools receiver-only, supported and tokenless", () => {
    for (const tool of HOOKABLE_TOOLS) {
      assert.equal(isSupportedTool(tool), true, `${tool} must be reportable`);
      assert.equal(isAttestedTool(tool), true, `${tool} must be receiver-eligible`);
      // The decisive one: no adapter in this repository may collect them. Their only
      // path in is a record the user's own IDE hook wrote.
      assert.equal(isNativeTool(tool), false, `${tool} must have no native adapter`);
      assert.equal(isTokenlessTool(tool), true, `${tool} reports no token count anywhere`);
    }
  });

  it("leaves the measuring tools exactly as they were", () => {
    for (const tool of ["claude-code", "codex"]) {
      assert.equal(isNativeTool(tool), true);
      assert.equal(isAttestedTool(tool), false);
      assert.equal(isTokenlessTool(tool), false);
    }
    assert.deepEqual([...NATIVE_TOOLS], ["claude-code", "codex", "quadcode"]);
    assert.deepEqual([...SUPPORTED_TOOLS], [...NATIVE_TOOLS, "cursor", "windsurf"]);
    assert.deepEqual([...ATTESTED_TOOLS], ["quadcode", ...HOOKABLE_TOOLS]);
    assert.deepEqual([...TOKENLESS_TOOLS], ["quadcode", ...HOOKABLE_TOOLS]);
    assert.equal(isSupportedTool("chatgpt"), false);
  });
});

describe("hook producer: the inbox is append-only, bounded and consent-gated", () => {
  afterEach(() => { rmSync(CONFIG_DIR, { recursive: true, force: true }); });

  it("writes one line per event, at 0600, and appends rather than rewrites", async () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    assert.equal(await runHookEvent("cursor", feed(JSON.stringify(cursorPayload())), NOW), true);
    assert.equal(await runHookEvent("cursor",
      feed(JSON.stringify(cursorPayload({ hook_event_name: "afterAgentResponse" }))), NOW), true);
    const lines = readInbox();
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.ok(!line.includes(CANARY));
      assert.equal(JSON.parse(line).tool, "cursor");
      assert.equal(Object.hasOwn(JSON.parse(line), "measured"), false);
    }
    if (process.platform !== "win32") {
      assert.equal(statSync(ATTESTED_PATH).mode & 0o777, 0o600);
    }
  });

  it("writes nothing at all without consent for that exact tool", async () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    assert.equal(await runHookEvent("windsurf", feed(JSON.stringify(windsurfPayload())), NOW), false);
    writeConfig({ enabled: false, tools: ["cursor"] });
    assert.equal(await runHookEvent("cursor", feed(JSON.stringify(cursorPayload())), NOW), false);
    writeConfig();
    assert.equal(await runHookEvent("cursor", feed(JSON.stringify(cursorPayload())), NOW), false);
    rmSync(CONFIG_PATH, { force: true });
    assert.equal(await runHookEvent("cursor", feed(JSON.stringify(cursorPayload())), NOW), false);
    assert.deepEqual(readInbox(), []);
  });

  it("drops an unparseable, empty or oversized payload without writing or throwing", async () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    const oversized = JSON.stringify({ ...cursorPayload(), prompt: CANARY.repeat(Math.ceil(MAX_HOOK_STDIN_BYTES / CANARY.length)) });
    for (const raw of ["", "   ", "{not json", "null", "[]", "\"a string\"",
      JSON.stringify({ ...cursorPayload(), hook_event_name: "beforeSubmitPrompt" }),
      JSON.stringify({ ...cursorPayload(), hook_event_name: "sessionEnd" }), oversized]) {
      assert.equal(await runHookEvent("cursor", feed(raw), NOW), false);
    }
    assert.deepEqual(readInbox(), []);
  });

  it("refuses a record that is not a well-formed v1 line", () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    assert.equal(appendAttestedRecord({ tool: "cursor", model: "x".repeat(4096) } as never), false);
    assert.deepEqual(readInbox(), []);
  });

  // A hook runs inside the user's editor. It must not hold that editor's process open, and
  // it must not be the reason a turn feels slow - so the stdin read finishes on the first
  // complete JSON value rather than on EOF, and has a deadline even then.
  it("finishes on the first complete payload without waiting for the pipe to close", async () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    const pipe = new OpenPipe();
    const started = Date.now();
    const running = runHookEvent("cursor", pipe, NOW, 5_000);
    pipe.push(JSON.stringify(cursorPayload()));
    assert.equal(await running, true);
    // The pipe is still open; only the deadline could have ended this, and it did not.
    assert.ok(Date.now() - started < 2_000, "waited for EOF on an open pipe");
    assert.equal(readInbox().length, 1);
  });

  it("gives up on a pipe that never sends anything, and writes nothing", async () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    const started = Date.now();
    assert.equal(await runHookEvent("cursor", new OpenPipe(), NOW, 150), false);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 140, `returned before the deadline (${elapsed}ms)`);
    assert.ok(elapsed < 5_000, `hung past the deadline (${elapsed}ms)`);
    assert.deepEqual(readInbox(), []);
  });

  it("reassembles a payload split across chunks on a pipe that stays open", async () => {
    writeConfig({ enabled: true, tools: ["windsurf"] });
    const pipe = new OpenPipe();
    const raw = JSON.stringify(windsurfPayload());
    const running = runHookEvent("windsurf", pipe, NOW, 5_000);
    pipe.push(raw.slice(0, 20));
    pipe.push(raw.slice(20, 60));
    pipe.push(raw.slice(60));
    assert.equal(await running, true);
    assert.equal(readInbox().length, 1);
  });

  it("abandons an oversized stream rather than parsing a truncated prefix", async () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    const pipe = new OpenPipe();
    const running = runHookEvent("cursor", pipe, NOW, 5_000);
    // A whole Cascade response or a long prompt: over the cap, and never completed.
    pipe.push(`{"hook_event_name":"stop","prompt":"${CANARY.repeat(Math.ceil(MAX_HOOK_STDIN_BYTES / CANARY.length))}`);
    assert.equal(await running, false);
    assert.deepEqual(readInbox(), []);
  });

  it("an unlisted tool never even reads stdin", async () => {
    writeConfig({ enabled: true, tools: ["cursor"] });
    for (const tool of ["claude-code", "codex", "quadcode", "chatgpt", "vscode", "", null, 7]) {
      const pipe = new OpenPipe();
      assert.equal(await runHookEvent(tool, pipe, NOW, 5_000), false);
      assert.equal(pipe.consumed, false, `${String(tool)} caused stdin to be read`);
    }
    assert.deepEqual(readInbox(), []);
  });

  it("a withdrawn consent stops the payload being read at all", async () => {
    writeConfig({ enabled: false, tools: ["cursor"] });
    const pipe = new OpenPipe();
    assert.equal(await runHookEvent("cursor", pipe, NOW, 5_000), false);
    assert.equal(pipe.consumed, false, "a payload was read after consent was withdrawn");
    assert.deepEqual(readInbox(), []);
  });
});

describe("hook producer: what it writes, the receiver accepts", () => {
  for (const tool of HOOKABLE_TOOLS) {
    it(`${tool}: round-trips into an activity observation with unknown usage`, () => {
      const record = projectHookEvent(tool, payloadFor(tool), NOW);
      const observation = projectAttestedRecord(JSON.parse(JSON.stringify(record)), NOW, WINDOW, [tool]);
      assert.ok(observation, "the receiver rejected a record this producer wrote");
      assert.equal(observation.tool, tool);
      assert.equal(observation.model, "claude-opus-5");
      assert.equal(observation.projectHint, "demo-project");
      assert.equal(observation.confidence, "activity");
      assert.equal(observation.cwd, null);
      assert.equal(observation.lastActivityAt, tool === "cursor" ? NOW : Date.parse(FRESH_ZONED));
      // Unknown usage, expressed as absence rather than as a zero measurement.
      assert.equal(observation.tokensInputDelta, 0);
      assert.equal(observation.tokensOutputDelta, 0);
      assert.deepEqual(observation.usage, []);
    });
    it(`${tool}: every subscribed event round-trips, with or without a hint`, () => {
      for (const event of hookEventsFor(tool)) {
        const bare = projectHookEvent(tool, { [eventKey(tool)]: event }, NOW);
        assert.equal(Object.hasOwn(bare ?? {}, "projectHint"), false);
        const observation = projectAttestedRecord(JSON.parse(JSON.stringify(bare)), NOW, WINDOW, [tool]);
        assert.equal(observation?.tool, tool);
        assert.equal(observation?.model, null);
        assert.equal(observation?.projectHint, null);
      }
    });
    it(`${tool}: a record is refused unless the user consented to that tool`, () => {
      const record = JSON.parse(JSON.stringify(projectHookEvent(tool, payloadFor(tool), NOW)));
      assert.equal(projectAttestedRecord(record, NOW, WINDOW, []), null);
      assert.equal(projectAttestedRecord(record, NOW, WINDOW, ["quadcode"]), null);
    });
  }

  it("the receiver rejects a stale or zoneless record instead of repairing it", () => {
    // The producer cannot emit either shape - but a file another process wrote can, and
    // the receiver is what has to hold the line.
    const record = JSON.parse(JSON.stringify(projectHookEvent("cursor", cursorPayload(), NOW)));
    assert.ok(projectAttestedRecord({ ...record }, NOW, WINDOW, ["cursor"]));
    for (const occurredAt of ["2026-06-09T12:00:00.000000", "2026-06-09 12:00:00", NOW_ISO.replace("Z", ""),
      new Date(NOW - 10 * 60_000).toISOString(), new Date(NOW + 10 * 60_000).toISOString(), NOW, ""]) {
      assert.equal(projectAttestedRecord({ ...record, occurredAt }, NOW, WINDOW, ["cursor"]), null,
        `${String(occurredAt)} must be rejected, not repaired`);
    }
  });

  it("the receiver still refuses a hand-written record that claims tokens", () => {
    const record = JSON.parse(JSON.stringify(projectHookEvent("cursor", cursorPayload(), NOW)));
    // Counts with no measured claim: refused outright, so an absent count can never be
    // read back as a real zero.
    assert.equal(projectAttestedRecord({ ...record, tokensInputDelta: 10, tokensOutputDelta: 2 },
      NOW, WINDOW, ["cursor"]), null);
    // `estimated` in any polarity: refused.
    assert.equal(projectAttestedRecord({ ...record, estimated: false }, NOW, WINDOW, ["cursor"]), null);
    // And a measured claim is accepted as a record but contributes NO usage, because
    // cursor is tokenless in every source this project reads.
    const measured = projectAttestedRecord({ ...record, measured: true, tokensInputDelta: 10, tokensOutputDelta: 2 },
      NOW, WINDOW, ["cursor"]);
    assert.equal(measured?.tokensInputDelta, 0);
    assert.deepEqual(measured?.usage, []);
  });
});

process.on("exit", () => { rmSync(sandbox, { recursive: true, force: true }); });
