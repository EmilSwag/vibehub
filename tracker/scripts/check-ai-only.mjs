#!/usr/bin/env node
/** Synthetic-only collector checks. Never invokes the CLI parser, daemon, shell or a live account. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { TextDecoder, TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const tracker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(tracker, "../..");
const require = createRequire(path.join(tracker, "package.json"));
const ts = require("typescript");
const bundleMode = process.argv.includes("--bundle");
/**
 * Which bundle `--bundle` verifies.
 *
 * The SERVED artifact is the one the one-command installer downloads, and writing it is a
 * `web/**` change. So this mode prefers an ISOLATED artifact built inside `tracker/` by
 * `npm run bundle:check` (into the already-ignored `dist/`), which lets the bundle gates
 * run from this package alone. The served path stays the fallback, unchanged, so a
 * checkout without the local artifact behaves exactly as before, and
 * `--bundle-file <path>` / `VIBEHUB_BUNDLE_FILE` can name either explicitly.
 *
 * Whichever is chosen must be FRESH: a bundle older than the newest source it claims to
 * contain is a stale artifact, and verifying one would report on code that is not in it.
 */
const SERVED_BUNDLE = path.resolve(tracker, "../web/public/tracker/vibehub-tracker.cjs");
const LOCAL_BUNDLE = path.resolve(tracker, "dist/bundle/vibehub-tracker.cjs");
const bundleFlag = process.argv.indexOf("--bundle-file");
const bundleFile = bundleFlag >= 0 && process.argv[bundleFlag + 1]
  ? path.resolve(process.argv[bundleFlag + 1])
  : process.env.VIBEHUB_BUNDLE_FILE
    ? path.resolve(process.env.VIBEHUB_BUNDLE_FILE)
    : fs.existsSync(LOCAL_BUNDLE) ? LOCAL_BUNDLE : SERVED_BUNDLE;

function assertFreshBundle() {
  if (!fs.existsSync(bundleFile)) {
    throw new Error(`No bundle at ${bundleFile}. Build one with \`npm run bundle:check\` (isolated, inside tracker/).`);
  }
  const built = fs.statSync(bundleFile).mtimeMs;
  const newest = (function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && full.endsWith(".ts") ? [fs.statSync(full).mtimeMs] : [];
    });
  })(path.join(tracker, "src")).concat(fs.statSync(path.join(tracker, "package.json")).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0);
  if (built < newest) {
    throw new Error(`Stale bundle: ${path.relative(workspace, bundleFile)} predates tracker sources. ` +
      "Rebuild it (`npm run bundle:check`) and re-run, or point --bundle-file at a fresh one.");
  }
  console.log(`BUNDLE_FILE ${path.relative(workspace, bundleFile)} (built ${new Date(built).toISOString()})`);
}
const tempParent = path.join(workspace, ".temp/vibehub-ai-only");
fs.mkdirSync(tempParent, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(tempParent, "check-"));
const originalEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = runRoot; process.env.USERPROFILE = runRoot;
const CANARY = "NEVER_EXPORT_PROMPTS_CODE_OR_TOOL_OUTPUT";
const DATE = Date.parse("2026-06-09T12:00:00.000Z");
// Test contract only: the production bundler inlines this numeric bound.
const MAX_APPEND_BYTES = 1024 * 1024;
const config = { apiUrl: "https://tracker-fixture.invalid", deviceToken: "SYNTHETIC_ONLY_NOT_A_CREDENTIAL", projectAliases: {} };
const results = [];
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true };
const sourceModules = ["privacy", "config", "paths", "projectAlias", "statusFile", "detector", "heartbeat",
  "adapters/claudeCode", "adapters/codex", "adapters/jsonlTail", "adapters/processes", "adapters/quadcode",
  "adapters/attested", "queue"];
const ATTESTED_INBOX = "attested.jsonl";
const within = (root, file) => { const rel = path.relative(root, file); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const dump = (value) => JSON.stringify(value, (_key, v) => v instanceof Map || v instanceof Set ||
  Object.prototype.toString.call(v) === "[object Map]" || Object.prototype.toString.call(v) === "[object Set]" ? [...v] : typeof v === "bigint" ? String(v) : v);
const plain = (v) => JSON.parse(JSON.stringify(v));
// Quadcode writes a LOCAL ISO stamp with no zone. Fixtures must reproduce that exactly,
// including the six-digit fraction, or they would be testing a shape that never occurs.
const localStamp = (ms) => {
  const d = new Date(ms), p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}000`;
};
const sourceCache = new Map();

function typecheck() {
  const file = ts.readConfigFile(path.join(tracker, "tsconfig.json"), ts.sys.readFile);
  if (file.error) throw new Error(ts.flattenDiagnosticMessageText(file.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(file.config, ts.sys, tracker);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, configFilePath: path.join(tracker, "tsconfig.json"), noEmit: true });
  const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => tracker, getNewLine: () => "\n",
  }));
  console.log("PASS source typecheck (no emit)");
}

function createHarness() {
  const home = fs.mkdtempSync(path.join(runRoot, "home-"));
  let now = DATE;
  const requests = [], io = [], violations = [], logs = [], timers = new Map(), fds = new Map();
  let timerId = 1;
  let attestedSeq = 0;
  const env = { HOME: home, USERPROFILE: home };
  const rootClaude = path.join(home, ".claude/projects");
  const rootCodex = path.join(home, ".codex/sessions");
  // Round 4: Quadcode is collected natively, so its app-data root joins the allowlist
  // DELIBERATELY and narrowly. This mirrors `adapters/quadcode.ts quadcodeRoot()` move
  // for move, including the env base: APPDATA / XDG_CONFIG_HOME name the base when set,
  // and a base outside HOME yields null - no root, so every read is denied. Computed per
  // call so a fixture can change the env mid-test and see the same answer the adapter does.
  const quadcodeRootNow = () => {
    if (process.platform === "darwin") return path.join(home, "Library/Application Support/QuadcodeAI");
    const windows = process.platform === "win32";
    const override = env[windows ? "APPDATA" : "XDG_CONFIG_HOME"];
    const base = windows ? path.join(home, "AppData/Roaming") : path.join(home, ".config");
    if (!override) return path.join(base, "QuadcodeAI");
    if (!path.isAbsolute(override) || !within(home, override)) return null;
    return path.join(override, "QuadcodeAI");
  };
  const rootQuadcode = quadcodeRootNow();
  const own = path.join(home, ".vibehub");
  const deny = (name) => { violations.push(name); throw new Error(`Forbidden collector operation: ${name}`); };
  const allowed = (file, op) => {
    if (typeof file !== "string" && !Buffer.isBuffer(file)) return deny(`${op}: non-path`);
    const full = path.resolve(String(file));
    const ownFile = within(own, full) && path.dirname(full) === own &&
      /^(?:config\.json|status\.json|tracker\.pid|stop\.request|attested\.jsonl|\.(?:config\.json|status\.json|tracker\.pid|stop\.request)\.[a-f0-9-]+\.tmp)$/.test(path.basename(full));
    // The opt-in receiver inbox belongs to a separate producer: we may look at it and
    // open it for reading, and nothing more. Creating, writing, renaming, chmod-ing or
    // deleting it would make this tracker a producer of its own evidence.
    if (path.basename(full) === ATTESTED_INBOX && !["existsSync", "lstatSync", "realpathSync", "openSync"].includes(op)) {
      deny(`${op}: receiver inbox is read-only`);
    }
    const liveQuadcode = quadcodeRootNow();
    const ai = within(rootClaude, full) || within(rootCodex, full) ||
      (liveQuadcode !== null && within(liveQuadcode, full));
    const metadataRoot = [home, own, path.join(home, ".claude"), path.join(home, ".codex")].includes(full);
    if (!(ownFile || ai || metadataRoot)) deny(`${op}: ${path.relative(home, full)}`);
    if (["openSync", "readFileSync", "opendirSync"].includes(op) && !ownFile && !ai) deny(`${op}: root enumeration/content`);
    if (["openSync", "readFileSync", "opendirSync"].includes(op) && fs.existsSync(full)) {
      const real = fs.realpathSync(full);
      if (!(within(own, real) || within(rootClaude, real) || within(rootCodex, real) ||
            (liveQuadcode !== null && within(liveQuadcode, real)))) deny(`${op}: linked escape`);
    }
    io.push({ op, path: path.relative(home, full) });
    return full;
  };
  const facade = {
    constants: fs.constants,
    existsSync: (p) => fs.existsSync(allowed(p, "existsSync")),
    lstatSync: (p, ...a) => fs.lstatSync(allowed(p, "lstatSync"), ...a),
    realpathSync: (p, ...a) => fs.realpathSync(allowed(p, "realpathSync"), ...a),
    opendirSync: (p, ...a) => fs.opendirSync(allowed(p, "opendirSync"), ...a),
    openSync: (p, ...a) => { const full = allowed(p, "openSync"); const fd = fs.openSync(full, ...a); fds.set(fd, full); return fd; },
    fstatSync: (fd, ...a) => { if (!fds.has(fd)) deny("fstatSync: unknown fd"); return fs.fstatSync(fd, ...a); },
    readSync: (fd, ...a) => { if (!fds.has(fd)) deny("readSync: unknown fd"); io.push({ op: "readSync", path: path.relative(home, fds.get(fd)), bytes: a[2] }); return fs.readSync(fd, ...a); },
    closeSync: (fd) => { if (!fds.has(fd)) deny("closeSync: unknown fd"); fds.delete(fd); return fs.closeSync(fd); },
    mkdirSync: (p, ...a) => { const full = allowed(p, "mkdirSync"); if (full !== own) deny("mkdirSync: non-state"); return fs.mkdirSync(full, ...a); },
    chmodSync: (p, ...a) => { const full = allowed(p, "chmodSync"); if (!within(own, full)) deny("chmodSync: AI source"); return fs.chmodSync(full, ...a); },
    writeFileSync: (p, ...a) => { const full = allowed(p, "writeFileSync"); if (!within(own, full)) deny("writeFileSync: AI source"); return fs.writeFileSync(full, ...a); },
    renameSync: (a, b) => { a = allowed(a, "renameSync"); b = allowed(b, "renameSync"); if (!within(own, a) || !within(own, b)) deny("renameSync: AI source"); return fs.renameSync(a, b); },
    unlinkSync: (p) => { const full = allowed(p, "unlinkSync"); if (!within(own, full)) deny("unlinkSync: AI source"); return fs.unlinkSync(full); },
  };
  const guardedFs = new Proxy(facade, { get: (target, key) => key in target ? target[key] : key === "__esModule" ? false : (..._args) => deny(`fs.${String(key)}`) });
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const setTimer = (fn, ms, interval = false) => { const id = timerId++; timers.set(id, { fn, at: now + ms, ms, interval }); return id; };
  const sink = { write: (text) => { logs.push(String(text)); return true; }, isTTY: false, columns: 80, on() {}, once() {}, removeListener() {} };
  const fakeProcess = { env, platform: process.platform, pid: 424242, argv: ["node", bundleFile], execPath: "node-fixture-only",
    version: "v22.0.0", versions: { node: "22.0.0" }, stdout: sink, stderr: sink, stdin: sink,
    cwd: () => deny("process.cwd"), kill: () => deny("process.kill"), exit: () => deny("process.exit"),
    on() {}, once() {}, removeListener() {}, nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)) };
  const child = new Proxy({}, { get: (_target, key) => (..._args) => deny(`child_process.${String(key)}`) });
  const osStub = new Proxy({ homedir: () => home }, { get: (target, key) => key in target ? target[key] : key === "__esModule" ? false : (..._args) => deny(`os.${String(key)}`) });
  const accepted = (request) => ({ ok: true, status: 200, body: { cancel: async () => {} },
    json: async () => ({ connected: request.method === "POST", lastSeenAt: new Date(now).toISOString(), protocol: "connection-v1" }) });
  let responder = async (request) => accepted(request);
  const fetchStub = async (url, options = {}) => {
    assert.match(String(url), /^https:\/\/tracker-fixture\.invalid\/api\/v1\/tracker\/(?:connection|heartbeat)$/);
    assert.equal(options.redirect, "error");
    const request = { url: String(url), method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined,
      token: options.headers?.Authorization, signal: options.signal };
    if (request.url.endsWith("/connection")) {
      assert.ok(["POST", "DELETE"].includes(request.method));
      assert.equal(Object.hasOwn(options, "body"), false);
      assert.ok(Object.keys(options.headers ?? {}).every(key => key.toLowerCase() !== "content-type"));
    }
    requests.push(request);
    return responder(request);
  };
  const builtin = (id) => {
    const name = id.replace(/^node:/, "");
    if (name === "fs") return guardedFs;
    if (name === "os") return osStub;
    if (name === "path") return path;
    if (name === "crypto") return { createHash: crypto.createHash, randomUUID: crypto.randomUUID };
    if (name === "util") return { TextDecoder, TextEncoder, inspect: () => "[fixture]" };
    if (name === "events") return { EventEmitter };
    if (name === "console") return { Console: class { constructor() { deny("console redirection / daemon startup"); } } };
    if (name === "process") return fakeProcess;
    if (name === "child_process") return child;
    if (name === "tty") return { isatty: () => false };
    return deny(`require(${id})`);
  };
  const context = vm.createContext({ Buffer, TextDecoder, TextEncoder, URL, AbortController, AbortSignal, Date: Clock,
    process: fakeProcess, fetch: fetchStub, queueMicrotask,
    console: Object.fromEntries(["log", "warn", "error", "debug"].map((key) => [key, (...v) => logs.push(v.map(String).join(" "))])),
    setTimeout: (fn, ms) => setTimer(fn, ms), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => setTimer(fn, ms, true), clearInterval: (id) => timers.delete(id) });
  const modules = new Map();
  function loadSource(name) {
    const file = path.resolve(tracker, "src", `${name}.ts`);
    if (!within(path.join(tracker, "src"), file)) return deny("source-module escape");
    if (modules.has(file)) return modules.get(file).exports;
    let code = sourceCache.get(file);
    if (!code) { code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions, fileName: file }).outputText; sourceCache.set(file, code); }
    const module = { exports: {} }; modules.set(file, module);
    const localRequire = (id) => id.startsWith(".") ? loadSource(path.relative(path.join(tracker, "src"), path.resolve(path.dirname(file), id))) : builtin(id);
    new vm.Script(`(function(require,module,exports,__filename,__dirname){${code}\n})`, { filename: file })
      .runInContext(context)(localRequire, module, module.exports, file, path.dirname(file));
    return module.exports;
  }
  let api;
  if (!bundleMode) api = Object.assign({}, ...sourceModules.map(loadSource));
  else {
    const code = fs.readFileSync(bundleFile, "utf8");
    const ast = ts.createSourceFile(bundleFile, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const bootstrap = ast.statements.filter((s) => ts.isExpressionStatement(s) && /^program\d*\.parseAsync\(\)\.catch\(/.test(s.getText(ast)));
    assert.equal(bootstrap.length, 1, "must identify exactly one CLI bootstrap; never run it");
    const programName = /^program\d*/.exec(bootstrap[0].getText(ast))[0];
    const start = bootstrap[0].getFullStart(), end = bootstrap[0].end;
    const exposed = ["Detector", "ClaudeCodeAdapter", "CodexAdapter", "JsonlTailer", "pollAdapter", "createLoopState", "tick", "clearCollectedState",
      "postHeartbeat", "runLoop", "readConfig", "writeConfig", "readStatus", "writeStatus", "resolveProjectAlias", "projectHeartbeat", "projectConfig",
      "COLLECTION_POLICY"];
    context.require = builtin; context.module = { exports: {} }; context.exports = context.module.exports;
    context.__filename = bundleFile; context.__dirname = path.dirname(bundleFile);
    new vm.Script(`${code.slice(0, start)}\n${code.slice(end)}\nglobalThis.__checked = {${exposed.join(",")}, commands: ${programName}.commands.map(c=>c.name())};`, { filename: bundleFile }).runInContext(context);
    api = context.__checked;
  }
  const seed = (relative, data = "") => { const file = path.join(home, relative); assert.ok(within(home, file)); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); return file; };
  const writeConfig = (value = config) => seed(".vibehub/config.json", value);
  writeConfig();
  const state = api.createLoopState(config);
  const h = { home, api, state, requests, io, logs, violations, env, seed, writeConfig,
    now: () => now, time: (ms) => { now += ms; }, iso: () => new Date(now).toISOString(),
    append: (file, ...records) => fs.appendFileSync(file, records.map((r) => typeof r === "string" ? r : JSON.stringify(r)).join("\n") + "\n"),
    claudeFile: (id = "one") => seed(`.claude/projects/-fixture-project/${id}.jsonl`),
    codexFile: (id = "one") => seed(`.codex/sessions/2026/06/09/rollout-${id}.jsonl`),
    // Native Quadcode fixtures: the documented tree
    // `<root>/apps/<Project>/.quadcodeai/.data/chats/<section>.files/chat_N.jsonl`.
    quadcodeFile: (project = "fixture-project", section = "sec", n = 1) =>
      seed(`${path.relative(home, quadcodeRootNow() ?? rootQuadcode)}/apps/${project}/.quadcodeai/.data/chats/${section}.files/chat_${n}.jsonl`),
    // A completed assistant turn. `message` carries the canary: it must never leave.
    quadcodeLlm: (overrides = {}) => ({ name: "Agent", method: "LLM", message: CANARY,
      timestamp: localStamp(now), is_status_message: false, variation_index: 0,
      variations: [{ model_name: "claude-fable-5-1", cluster_node_info: { id: 1 },
        meta_info: { stop_reason: "end_turn", max_tokens: true } }], ...overrides }),
    quadcodeUser: (overrides = {}) => ({ name: "PO", method: "USER", message: CANARY,
      timestamp: localStamp(now), is_status_message: false, variations: [], ...overrides }),
    // Opt-in receiver fixtures. `attestedInbox()` creates the producer's file empty,
    // so the first tick primes at EOF exactly as a real install would.
    attestedInbox: () => seed(`.vibehub/${ATTESTED_INBOX}`, ""),
    attested: (overrides = {}) => ({ v: 1, tool: "quadcode", recordId: `rec-${++attestedSeq}`,
      occurredAt: h.iso(), model: "claude-fable-5-1", projectHint: "vibehub",
      measured: true, tokensInputDelta: 40, tokensOutputDelta: 10, ...overrides }),
    optIn: (tools = ["quadcode"]) => writeConfig({ ...config, attestedMetadata: { enabled: true, tools } }),
    optOut: () => writeConfig(config),
    claude: (overrides = {}) => ({ type: "assistant", timestamp: h.iso(), cwd: path.join(home, "UNRELATED_NEVER_OPEN", "private-project"),
      message: { id: "msg_one", role: "assistant", model: "claude-sonnet-4-5-20250929", content: [{ type: "text", text: CANARY }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 6 } }, ...overrides }),
    context: (project = "private-project", model = "gpt-5.1-codex") => ({ type: "turn_context", timestamp: h.iso(), payload: { cwd: path.join(home, "UNRELATED_NEVER_OPEN", project), model, instructions: CANARY } }),
    counts: (input = 100, output = 20) => ({ type: "event_msg", timestamp: h.iso(), payload: { type: "token_count", text: CANARY,
      info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: 80 }, last_token_usage: { input_tokens: 999999, output_tokens: 999999 } } } }),
    posts: () => requests.filter((r) => r.url.endsWith("/heartbeat")).map((r) => r.body),
    beats: () => h.posts().filter((r) => r.eventType === "heartbeat"),
    tick: async () => api.tick(api.readConfig() ?? config, state),
    status: () => JSON.parse(fs.readFileSync(path.join(home, ".vibehub/status.json"), "utf8")),
    respond: (fn) => { responder = fn; },
    drain: async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); },
    advance: async (ms) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); if (timer.interval) timers.set(id, { ...timer, at: now + timer.ms }); timer.fn(); } await h.drain(); },
    clean: () => { assert.deepEqual(violations, []); assert.equal(fds.size, 0); assert.ok(!dump(state).includes(CANARY)); assert.ok(!logs.join("\n").includes(CANARY));
      for (const post of h.posts()) { const text = JSON.stringify(post); assert.ok(!text.includes(CANARY)); assert.ok(!text.includes("UNRELATED_NEVER_OPEN")); assert.ok(!text.includes(config.deviceToken)); } },
    dispose: () => { state.detector.clear(); timers.clear(); for (const fd of fds.keys()) fs.closeSync(fd); try { fs.rmSync(home, { recursive: true, force: true }); } catch {} },
  };
  return h;
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("empty sources stay AI-idle while bodyless daemon verification remains alive", async (h) => {
  const legacyQueue = h.seed(".vibehub/queue.json", CANARY);
  await h.tick(); h.time(30000); await h.tick();
  assert.equal(fs.readFileSync(legacyQueue, "utf8"), CANARY);
  assert.equal(h.requests.length, 2); assert.equal(h.posts().length, 0);
  assert.equal(h.status().status, "idle"); assert.equal(h.status().connected, true);
  assert.equal(h.status().tool, null); assert.equal(h.status().projectAlias, null);
});
test("browser/history/editor/Quadcode/git fixtures are never scanned or inferred as activity", async (h) => {
  // `.cursor/hooks.json` and `.codeium/windsurf/hooks.json` are in this list deliberately:
  // the hook PRODUCER writes them, on an explicit `hooks install`, in its own process. The
  // collector must never read them - it learns about those tools only from the inbox.
  for (const file of [".cursor/logs/session.jsonl", ".cursor/hooks.json", ".codeium/windsurf/hooks.json",
    ".quadcode/chats/session.jsonl", ".bash_history", "Library/Application Support/Chrome/History",
    "AppData/Roaming/Code/logs/session.jsonl", "UNRELATED_NEVER_OPEN/private-project/.git/config", ".config/quadcode/settings.json"]) h.seed(file, CANARY);
  await h.tick(); assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
  // Stated as its own assertion rather than left to the allowlist: the daemon must never
  // read a vendor's hook configuration, with or without consent. It learns about those
  // tools from the inbox and from nothing else.
  h.optIn(["cursor", "windsurf"]); await h.tick(); h.time(30000); await h.tick();
  assert.ok(h.io.every((i) => !i.path.includes("hooks.json")), "the collector touched a vendor hook file");
  assert.ok(h.io.every((i) => !i.path.startsWith(".cursor") && !i.path.startsWith(".codeium")));
});
test("Quadcode first sight primes EOF: a turn that completed before the daemon is not replayed", async (h) => {
  const file = h.quadcodeFile();
  h.append(file, h.quadcodeLlm());
  await h.tick(); await h.tick();
  assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
});
test("Quadcode: an appended LLM record is activity with a model and NO token fields", async (h) => {
  const file = h.quadcodeFile(); await h.tick();
  h.append(file, h.quadcodeLlm()); await h.tick();
  const beat = h.beats().at(-1);
  assert.equal(beat.tool, "quadcode");
  assert.equal(beat.model, "claude-fable-5-1");
  assert.equal(beat.projectAlias, "unknown");
  // Unknown usage is ABSENT, never a zero that would read as "measured nothing".
  assert.deepEqual(beat.usage, []);
  assert.equal(Object.hasOwn(beat, "tokensInputDelta"), false);
  assert.equal(Object.hasOwn(beat, "tokensOutputDelta"), false);
  assert.equal(h.status().tool, "quadcode");
});
test("Quadcode: user turns, status lines and unparseable records are not activity", async (h) => {
  const file = h.quadcodeFile(); await h.tick();
  h.append(file, h.quadcodeUser(), h.quadcodeLlm({ is_status_message: true }),
    h.quadcodeLlm({ timestamp: "not-a-time" }), h.quadcodeLlm({ timestamp: h.iso() }), "{invalid-json");
  await h.tick();
  assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
});
test("Quadcode: a turn whose start is older than a day is ignored however fresh the append", async (h) => {
  const file = h.quadcodeFile(); await h.tick();
  h.append(file, h.quadcodeLlm({ timestamp: localStamp(h.now() - 25 * 60 * 60 * 1000) }));
  await h.tick();
  assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
});
test("Quadcode: an unreviewed model id stays null and is never invented from the tool", async (h) => {
  const file = h.quadcodeFile(); await h.tick();
  h.append(file, h.quadcodeLlm({ variations: [{ model_name: "grok-4.6" }] })); await h.tick();
  const beat = h.beats().at(-1);
  assert.equal(beat.tool, "quadcode"); assert.equal(beat.model, null);
});
test("Quadcode: chat bodies and speaker names never leave, and unrelated subtrees stay unread", async (h) => {
  h.seed(".quadcode/chats/session.jsonl", CANARY);
  const file = h.quadcodeFile(); await h.tick();
  h.append(file, h.quadcodeLlm()); await h.tick();
  assert.ok(h.io.every((i) => !i.path.includes("UNRELATED_NEVER_OPEN")));
  assert.ok(!JSON.stringify(h.posts()).includes("Agent"));
});
test("Quadcode honours a custom in-home app-data base instead of ignoring it", async (h) => {
  // The PO layout puts the root under %APPDATA% / $XDG_CONFIG_HOME. A machine that
  // moved its app data must still be found, not silently skipped.
  if (process.platform !== "darwin") h.env[process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME"] = path.join(h.home, "CustomAppData");
  const file = h.quadcodeFile(); await h.tick();
  h.append(file, h.quadcodeLlm()); await h.tick();
  const beat = h.beats().at(-1);
  assert.equal(beat.tool, "quadcode"); assert.equal(beat.model, "claude-fable-5-1");
});
test("an app-data base outside HOME fails closed: no root, no reads, no activity", async (h) => {
  const file = h.quadcodeFile(); await h.tick();
  // Exactly the sandbox hazard: HOME is redirected but the inherited base still names
  // a real profile. The source must become unavailable, never follow it.
  if (process.platform === "darwin") return;
  h.env[process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME"] = path.join(h.home, "..", "ELSEWHERE_NEVER_OPEN");
  h.append(file, h.quadcodeLlm()); await h.tick();
  assert.equal(h.posts().length, 0);
  assert.ok(h.io.every((i) => !i.path.includes("ELSEWHERE_NEVER_OPEN")));
});
test("a relative app-data base fails closed too", async (h) => {
  const file = h.quadcodeFile(); await h.tick();
  if (process.platform === "darwin") return;
  h.env[process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME"] = "relative/app/data";
  h.append(file, h.quadcodeLlm()); await h.tick();
  assert.equal(h.posts().length, 0);
});
test("Quadcode usage cannot be attributed even by a well-formed adapter", async (h) => {
  const d = new h.api.Detector(300000);
  d.adapters = [{ name: "quadcode", poll: async () => [{ tool: "quadcode", cwd: null, projectHint: "vibehub",
    model: "claude-fable-5-1", confidence: "activity", observedAt: h.now(), lastActivityAt: h.now(),
    tokensInputDelta: 7, tokensOutputDelta: 3,
    usage: [{ model: "claude-fable-5-1", tokensInputDelta: 7, tokensOutputDelta: 3 }] }] }];
  assert.equal(await d.detect(h.now()), null);
});
test("first sight primes EOF without replaying historical AI records", async (h) => {
  const file = h.claudeFile(); h.append(file, h.claude()); await h.tick(); await h.tick();
  assert.equal(h.posts().length, 0);
  assert.ok(h.io.filter((i) => i.op === "readSync" && i.path.endsWith(".jsonl")).every((i) => i.bytes === 1));
});
test("Claude measured input/cache/output counts and session events work without exposing bodies", async (h) => {
  const file = h.claudeFile(); await h.tick(); h.append(file, h.claude()); await h.tick();
  assert.deepEqual(h.posts().map((p) => p.eventType), ["session_start", "heartbeat"]);
  const beat = h.beats().at(-1); assert.equal(beat.tokensInputDelta, 20); assert.equal(beat.tokensOutputDelta, 5);
  assert.equal(beat.projectAlias, "unknown"); assert.equal(beat.model, "claude-sonnet-4-5-20250929");
  assert.equal(h.status().status, "active"); assert.ok(!JSON.stringify(h.status()).includes("private-project"));
});
test("Claude streaming receipt duplicates produce only increasing numeric deltas", async (h) => {
  const file = h.claudeFile(); await h.tick(); const record = h.claude(); h.append(file, record); await h.tick();
  h.append(file, record); await h.tick(); assert.equal(h.beats().at(-1).tokensInputDelta, 0);
  record.message.usage.output_tokens = 8; h.append(file, record); await h.tick();
  assert.equal(h.beats().at(-1).tokensInputDelta, 0); assert.equal(h.beats().at(-1).tokensOutputDelta, 3);
});
test("Codex baseline is not replayed and cached input is not counted twice", async (h) => {
  const file = h.codexFile(); await h.tick(); h.append(file, h.context(), h.counts()); await h.tick();
  assert.equal(h.posts().length, 0); h.append(file, h.counts(160, 32)); await h.tick();
  const beat = h.beats().at(-1); assert.equal(beat.tokensInputDelta, 60); assert.equal(beat.tokensOutputDelta, 12);
  assert.equal(beat.tool, "codex"); assert.equal(beat.model, "gpt-5.1-codex");
  h.append(file, h.counts(160, 32)); await h.tick(); assert.equal(h.beats().at(-1).tokensInputDelta, 0);
});
test("Codex metadata/messages/context alone and unbound counters do not fabricate activity", async (h) => {
  const file = h.codexFile(); await h.tick();
  h.append(file, { type: "session_meta", timestamp: h.iso(), payload: { model: "gpt-5.1-codex", content: CANARY } },
    { type: "response_item", timestamp: h.iso(), payload: { type: "message", role: "assistant", content: CANARY, usage: { input_tokens: 100 } } }, h.counts(), h.counts(150, 25));
  await h.tick(); assert.equal(h.posts().length, 0); h.append(file, h.context()); await h.tick(); assert.equal(h.posts().length, 0);
});
test("stale/future/malformed/non-assistant records and non-integer token counters stay idle", async (h) => {
  const file = h.claudeFile(); await h.tick();
  const badCount = h.claude(); badCount.message.usage.input_tokens = "100";
  const fractional = h.claude(); fractional.message.usage.output_tokens = 1.5;
  const synthetic = h.claude(); synthetic.message.model = "<synthetic>";
  h.append(file, h.claude({ timestamp: new Date(h.now() - 600000).toISOString() }), h.claude({ timestamp: new Date(h.now() + 600000).toISOString() }),
    h.claude({ type: "user" }), h.claude({ timestamp: "not-a-time" }), badCount, fractional, synthetic, "{invalid-json", { content: CANARY });
  await h.tick(); assert.equal(h.posts().length, 0);
});
// Ported from the retired scripts/local-attribution-check.js (finding F3). That script
// drove the same flow through a fake CLAUDE_CONFIG_DIR, which the root rule now refuses by
// design, so its whole run was red. These are the assertions it made that nothing else
// covers, rewritten against the real root this harness already uses.
test("one file, two models: each message's tokens are booked under its own model", async (h) => {
  const file = h.claudeFile(); await h.tick();
  const first = h.claude();
  const second = h.claude({ message: { ...h.claude().message, id: "msg_two", model: "claude-opus-5",
    usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  h.append(file, first, second); await h.tick();
  const beat = h.beats().at(-1);
  const byModel = Object.fromEntries(beat.usage.map((u) => [u.model, [u.tokensInputDelta, u.tokensOutputDelta]]));
  assert.deepEqual(byModel["claude-sonnet-4-5-20250929"], [20, 5]);
  assert.deepEqual(byModel["claude-opus-5"], [500, 200]);
  // The legacy top-level sums must equal the per-model totals, or an older server would
  // book a different number from a newer one reading `usage`.
  assert.equal(beat.tokensInputDelta, 520);
  assert.equal(beat.tokensOutputDelta, 205);
  assert.equal(beat.usage.every((u) => u.tool === undefined || u.tool === "claude-code"), true);
});
test("a <synthetic> record contributes no usage at all, and the literal never travels", async (h) => {
  // The retired script expected these tokens under `model: null`. They are not booked at
  // all any more: `claudeCode.ts` refuses the record outright, which is strictly more
  // conservative. Pinned in its current form so a later change has to be deliberate.
  const file = h.claudeFile(); await h.tick();
  const synthetic = h.claude();
  synthetic.message.id = "msg_synthetic";
  synthetic.message.model = "<synthetic>";
  h.append(file, h.claude(), synthetic); await h.tick();
  const beat = h.beats().at(-1);
  assert.deepEqual(beat.usage.map((u) => u.model), ["claude-sonnet-4-5-20250929"]);
  assert.equal(beat.tokensInputDelta, 20);
  assert.equal(beat.model, "claude-sonnet-4-5-20250929");
  assert.ok(!JSON.stringify(h.posts()).includes("<synthetic>"));
});
test("within one tool, presence follows the newest model that burned tokens", async (h) => {
  // The retired script asserted a presence-MODEL hysteresis (a one-off side call must not
  // switch the session). No such rule exists in the tree today - `detector.ts` keeps tool
  // and project, not model - so what actually happens is pinned here instead, and the
  // divergence from tracker/README.md is recorded as F8 rather than quietly "fixed".
  const file = h.claudeFile(); await h.tick();
  h.append(file, h.claude()); await h.tick();
  assert.equal(h.beats().at(-1).model, "claude-sonnet-4-5-20250929");
  const side = h.claude({ message: { ...h.claude().message, id: "msg_side_1", model: "claude-opus-5",
    usage: { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  h.append(file, side); await h.tick();
  const beat = h.beats().at(-1);
  assert.equal(beat.model, "claude-opus-5");
  assert.equal(h.status().model, "claude-opus-5");
  // Whatever presence says, the tokens are attributed to the model that spent them.
  assert.deepEqual(beat.usage.map((u) => [u.model, u.tokensInputDelta]), [["claude-opus-5", 40]]);
  assert.equal(beat.tool, "claude-code");
  // And the model change RESTARTS the session: session_end, then a new session_start.
  // That is exactly the churn the retired script's hysteresis was written to prevent, so
  // it is pinned here as the current contract and raised as F8, not silently changed.
  const kinds = h.posts().map((p) => p.eventType);
  assert.equal(kinds.filter((k) => k === "session_start").length, 2);
  assert.ok(kinds.lastIndexOf("session_end") < kinds.lastIndexOf("session_start"));
});
test("Detector: tokens break hysteresis, and a quiet current project is kept", async (h) => {
  const observation = (tool, projectHint, tokens) => ({ tool, cwd: null, projectHint,
    model: tool === "codex" ? "gpt-5.1-codex" : "claude-opus-5", confidence: "activity",
    observedAt: h.now(), lastActivityAt: h.now(), tokensInputDelta: tokens, tokensOutputDelta: 0,
    usage: tokens ? [{ model: tool === "codex" ? "gpt-5.1-codex" : "claude-opus-5", tokensInputDelta: tokens, tokensOutputDelta: 0 }] : [] });
  const d = new h.api.Detector(300000);
  // A current session on one tool loses to another tool that actually burned tokens.
  d.adapters = [{ name: "claude-code", poll: async () => [observation("claude-code", "alpha", 0)] },
    { name: "codex", poll: async () => [observation("codex", "beta", 7)] }];
  assert.equal((await d.detect(h.now(), { tool: "claude-code", cwd: null, projectHint: "alpha" })).tool, "codex");
  // Same tool, two projects, nobody burning: the project already open is kept.
  const quiet = new h.api.Detector(300000);
  quiet.adapters = [{ name: "claude-code", poll: async () => [
    observation("claude-code", "alpha", 0), observation("claude-code", "beta", 0)] }];
  assert.equal((await quiet.detect(h.now(), { tool: "claude-code", cwd: null, projectHint: "alpha" })).projectHint, "alpha");
});
test("unknown or malicious model IDs remain null, never invented or copied", async (h) => {
  const file = h.claudeFile(); await h.tick(); const record = h.claude(); record.message.model = CANARY;
  h.append(file, record); await h.tick(); assert.equal(h.beats().at(-1).model, null); assert.equal(h.beats().at(-1).usage[0].model, null);
  assert.equal(h.beats().at(-1).tokensInputDelta, 20);
});
test("safe explicit project alias works without inspecting the log-provided directory", async (h) => {
  h.writeConfig({ ...config, projectAliases: { "private-project": "Demo" } });
  const file = h.claudeFile(); await h.tick(); h.append(file, h.claude()); await h.tick();
  assert.equal(h.beats().at(-1).projectAlias, "Demo");
  assert.ok(h.io.every((i) => !i.path.includes("UNRELATED_NEVER_OPEN")));
});
test("hidden projects lose ALL presence/tools/usage and never drain into later visible sessions", async (h) => {
  h.writeConfig({ ...config, projectAliases: { "PRIVATE-PROJECT": "hidden" } });
  const a = h.claudeFile(), b = h.codexFile(); await h.tick(); h.append(a, h.claude()); h.append(b, h.context(), h.counts(), h.counts(200, 40));
  await h.tick(); assert.equal(h.posts().length, 0); assert.equal(h.state.pendingUsage.size, 0);
  assert.deepEqual(h.status().sources, []); h.writeConfig(); await h.tick(); assert.equal(h.posts().length, 0);
  const fresh = h.claude(); fresh.message.id = "msg_fresh"; h.append(a, fresh); await h.tick(); assert.equal(h.beats().at(-1).tokensInputDelta, 20);
});
test("mixed-project Claude/Codex files fail closed before attribution", async (h) => {
  h.writeConfig({ ...config, projectAliases: { secret: "hidden" } }); const a = h.claudeFile(), b = h.codexFile(); await h.tick();
  const other = h.claude({ cwd: path.join(h.home, "UNRELATED_NEVER_OPEN/secret") }); other.message.id = "msg_other";
  h.append(a, h.claude(), other); h.append(b, h.context(), h.counts(), h.counts(200, 40), h.context("secret"), h.counts(300, 60));
  await h.tick(); assert.equal(h.posts().length, 0);
});
test("activity expires on supported-record time, not file mtime or an open editor", async (h) => {
  const file = h.claudeFile(); await h.tick(); h.append(file, h.claude()); await h.tick(); h.time(300001);
  h.append(file, { type: "progress", timestamp: h.iso(), message: CANARY }); await h.tick();
  assert.equal(h.posts().at(-1).eventType, "session_end"); assert.equal(h.status().status, "idle");
  const n = h.posts().length; h.time(30000); await h.tick(); assert.equal(h.posts().length, n); assert.equal(h.status().connected, true);
});
test("unrelated/custom AI roots are unavailable with no override-path reads", async (h) => {
  const file = h.claudeFile(); h.env.CLAUDE_CONFIG_DIR = path.join(h.home, "UNRELATED_NEVER_OPEN");
  h.env.CODEX_HOME = h.env.CLAUDE_CONFIG_DIR; await h.tick(); h.append(file, h.claude()); await h.tick(); assert.equal(h.posts().length, 0);
});
test("linked roots and files cannot escape into unrelated synthetic files", async (h) => {
  const target = h.seed("UNRELATED_NEVER_OPEN/secret.jsonl", JSON.stringify(h.claude()) + "\n");
  const file = h.claudeFile(); fs.unlinkSync(file); fs.symlinkSync(target, file, "file");
  await h.tick(); await h.tick(); assert.equal(h.posts().length, 0);
  const rooted = h.seed("UNRELATED_NEVER_OPEN/sessions/-fixture-project/root.jsonl", JSON.stringify(h.claude()) + "\n");
  const root = path.join(h.home, ".claude/projects"); fs.rmSync(root, { recursive: true, force: true });
  fs.symlinkSync(path.dirname(path.dirname(rooted)), root, process.platform === "win32" ? "junction" : "dir");
  await h.tick(); await h.tick(); assert.equal(h.posts().length, 0);
});
test("hard-linked AI files are unavailable rather than reading their unrelated target", async (h) => {
  const target = h.seed("UNRELATED_NEVER_OPEN/secret.jsonl", JSON.stringify(h.claude()) + "\n");
  const file = h.claudeFile(); fs.unlinkSync(file); fs.linkSync(target, file);
  await h.tick(); await h.tick(); assert.equal(h.posts().length, 0);
  assert.equal(h.io.filter((i) => i.op === "openSync" && i.path.endsWith(".jsonl")).length, 0);
});
test("partial JSONL content is not retained and completes safely on a later append", async (h) => {
  const file = h.claudeFile(); await h.tick(); const text = JSON.stringify(h.claude());
  fs.appendFileSync(file, text.slice(0, -10)); await h.tick(); assert.equal(h.posts().length, 0); assert.ok(!dump(h.state).includes(CANARY));
  fs.appendFileSync(file, text.slice(-10) + "\n"); await h.tick(); assert.equal(h.beats().at(-1).tokensInputDelta, 20);
});
test("oversized appends are skipped, bounded, and do not become raw cached fragments", async (h) => {
  const file = h.claudeFile(); await h.tick(); fs.appendFileSync(file, CANARY.repeat(Math.ceil((MAX_APPEND_BYTES + 1) / CANARY.length)) + "\n");
  await h.tick(); assert.equal(h.posts().length, 0); assert.ok(!dump(h.state).includes(CANARY));
  h.append(file, h.claude()); await h.tick(); assert.equal(h.beats().at(-1).tokensInputDelta, 20);
  assert.ok(h.io.filter((i) => i.op === "readSync").every((i) => i.bytes <= MAX_APPEND_BYTES));
});
test("rotation re-primes instead of replaying replaced logs", async (h) => {
  const file = h.claudeFile(); await h.tick(); h.append(file, h.claude()); await h.tick();
  fs.renameSync(file, `${file}.retired`); const old = h.claude(); old.message.id = "msg_rotated_old"; fs.writeFileSync(file, JSON.stringify(old) + "\n");
  const count = h.beats().length; await h.tick(); assert.equal(h.beats().length, count);
  const fresh = h.claude(); fresh.message.id = "msg_rotated_new"; h.append(file, fresh); await h.tick(); assert.equal(h.beats().at(-1).tokensInputDelta, 20);
});
test("missing/invalid config pauses collection and resume does not replay the gap", async (h) => {
  const file = h.claudeFile(); await h.tick(); fs.unlinkSync(path.join(h.home, ".vibehub/config.json"));
  const before = h.io.length, requests = h.requests.length; h.append(file, h.claude()); await h.tick();
  assert.equal(h.requests.length, requests); assert.ok(!h.io.slice(before).some((i) => i.path.startsWith(".claude")));
  h.seed(".vibehub/config.json", "{broken"); await h.tick(); assert.equal(h.requests.length, requests);
  h.writeConfig(); await h.tick(); assert.equal(h.posts().length, 0);
});
test("rejected/offline verification performs no AI source reads and clears collected state", async (h) => {
  h.claudeFile(); h.respond(async () => ({ ok: false, status: 401 })); await h.tick();
  assert.equal(h.status().authRejected, true); assert.equal(h.status().connected, false);
  assert.ok(!h.io.some((i) => i.path.startsWith(".claude"))); assert.equal(h.posts().length, 0);
  h.respond(async () => { throw new Error(CANARY); }); await h.tick(); assert.equal(h.posts().length, 0);
});
test("account rotation during verification fences late work and cross-account evidence", async (h) => {
  h.claudeFile(); let release; h.respond(() => new Promise((resolve) => { release = resolve; }));
  const pending = h.tick(); await h.drain(); h.writeConfig({ ...config, deviceToken: "DIFFERENT_SYNTHETIC_ACCOUNT" });
  release({ ok: true, status: 200, json: async () => ({ connected: true, lastSeenAt: h.iso(), protocol: "connection-v1" }) }); await pending;
  assert.equal(h.posts().length, 0); assert.ok(!h.io.some((i) => i.path.startsWith(".claude"))); assert.equal(h.state.activeSession, null);
});
test("cancelled late adapter results cannot publish or restore state", async (h) => {
  let release; h.state.detector.adapters = [{ name: "fixture", poll: () => new Promise((resolve) => { release = resolve; }) }];
  const pending = h.tick(); await h.drain(); h.api.clearCollectedState(h.state); release([]); await pending;
  assert.equal(h.posts().length, 0); assert.equal(h.state.activeSession, null); assert.equal(h.state.pendingUsage.size, 0);
});
test("hung adapter times out, stays non-overlapping, and drops its late result", async (h) => {
  let calls = 0, release; const adapter = { name: "fixture", poll: () => { calls++; return new Promise((resolve) => { release = resolve; }); } };
  const pending = h.api.pollAdapter(adapter, 10, h.now()); await h.drain(); await h.advance(11); assert.deepEqual(plain(await pending), []);
  assert.deepEqual(plain(await h.api.pollAdapter(adapter, 10, h.now())), []); assert.equal(calls, 1); release([]); await h.drain();
});
test("presence-only editor observations cannot invent AI usage, requests or model identity", async (h) => {
  const d = new h.api.Detector(300000); d.adapters = [{ name: "fixture", poll: async () => [
    { tool: "cursor", cwd: null, projectHint: null, model: "gpt-4.1", confidence: "presence", observedAt: h.now(), lastActivityAt: h.now(), tokensInputDelta: 0, tokensOutputDelta: 0, usage: [] },
    { tool: "claude-code", cwd: null, projectHint: null, model: null, confidence: "presence", observedAt: h.now(), lastActivityAt: h.now(), tokensInputDelta: 0, tokensOutputDelta: 0, usage: [] }] }];
  assert.equal(await d.detect(h.now()), null);
});
test("final heartbeat allowlist drops canary fields and rejects unrelated tools/event types", async (h) => {
  const payload = { eventType: "heartbeat", projectAlias: "Demo", tool: "claude-code", model: CANARY, occurredAt: h.iso(), prompt: CANARY,
    cwd: CANARY, tokensInputDelta: 9999, usage: [{ tool: "claude-code", model: CANARY, tokensInputDelta: 2, tokensOutputDelta: 3, content: CANARY }],
    tools: [{ tool: "claude-code", model: CANARY, projectAlias: "Demo", windowTitle: CANARY }] };
  assert.equal((await h.api.postHeartbeat(config.apiUrl, config.deviceToken, payload)).ok, true);
  const post = h.posts().at(-1); assert.equal(post.tokensInputDelta, 2); assert.equal(post.tokensOutputDelta, 3); assert.equal(post.model, null);
  assert.ok(!JSON.stringify(post).includes(CANARY)); const n = h.requests.length;
  // Round 5, deliberate: `cursor` and `windsurf` are now supported ids, so this case no
  // longer fails for being unknown - it fails because they are TOKENLESS. A usage entry
  // claiming counts for a tool that reports none is rejected outright rather than zeroed,
  // and the whole heartbeat goes with it. `chatgpt` still has no source at all.
  for (const bad of [{ ...payload, tool: "chatgpt" }, { ...payload, eventType: "git_commit" }, { ...payload, projectAlias: "../../secret" },
    { ...payload, usage: [{ tool: "cursor", model: "gpt-4.1", tokensInputDelta: 1, tokensOutputDelta: 1 }] },
    { ...payload, usage: [{ tool: "windsurf", model: "claude-opus-5", tokensInputDelta: 0, tokensOutputDelta: 0 }] },
    { ...payload, tool: "cursor", usage: [{ tool: "cursor", model: null, tokensInputDelta: 1, tokensOutputDelta: 1 }] }]) {
    assert.equal((await h.api.postHeartbeat(config.apiUrl, config.deviceToken, bad)).ok, false);
  }
  assert.equal(h.requests.length, n);
  // ...while a hook tool's presence, with no usage claimed, is a first-class heartbeat.
  assert.equal((await h.api.postHeartbeat(config.apiUrl, config.deviceToken,
    { eventType: "heartbeat", projectAlias: "Demo", tool: "windsurf", model: CANARY, occurredAt: h.iso(), usage: [] })).ok, true);
  const hookBeat = h.posts().at(-1);
  assert.equal(hookBeat.tool, "windsurf"); assert.equal(hookBeat.model, null);
  assert.equal(Object.hasOwn(hookBeat, "tokensInputDelta"), false);
});
test("legacy/unbound local status is not trusted or forwarded", async (h) => {
  h.seed(".vibehub/status.json", { status: "active", tool: "cursor", projectAlias: CANARY, model: CANARY, sources: [{ tool: CANARY }] });
  assert.equal(h.api.readStatus().status, "offline"); assert.equal(h.api.readStatus().tool, null);
  await h.tick(); assert.ok(!JSON.stringify(h.status()).includes(CANARY));
});
test("only a fresh connection-v1 receipt proves idle transport; malformed or old servers pause", async (h) => {
  h.claudeFile();
  const good = { connected: true, lastSeenAt: h.iso(), protocol: "connection-v1" };
  for (const receipt of [null, {}, { username: CANARY }, { ...good, protocol: "unknown" }, { ...good, connected: false },
    { ...good, lastSeenAt: h.now() }, { ...good, lastSeenAt: new Date(h.now() - 120000).toISOString() },
    { ...good, lastSeenAt: new Date(h.now() + 120000).toISOString() }]) {
    h.respond(async () => ({ ok: true, status: 200, json: async () => receipt }));
    await h.tick(); assert.equal(h.status().connected, false); assert.equal(h.status().status, "offline");
  }
  h.respond(async () => ({ ok: false, status: 404 })); await h.tick();
  assert.equal(h.status().connected, false); assert.equal(h.posts().length, 0);
  assert.ok(!h.io.some(i => i.path.startsWith(".claude")));
  h.respond(async () => ({ ok: true, status: 200, json: async () => ({ ...good, prompt: CANARY, profile: CANARY }) }));
  await h.tick(); assert.equal(h.status().connected, true); assert.equal(h.status().status, "idle");
  assert.equal(h.status().lastConnectionSeenAt, h.iso()); assert.ok(!JSON.stringify(h.status()).includes(CANARY));
});
test("clean isolated loop stop retires only the bodyless connection and never creates AI activity", async (h) => {
  const loop = h.api.runLoop(config, { loadConfig: h.api.readConfig });
  await h.drain(); assert.equal(h.status().status, "idle"); assert.equal(h.status().connected, true);
  await loop.stop(); assert.equal(h.status().status, "offline"); assert.equal(h.posts().length, 0);
  assert.deepEqual(h.requests.map(r => r.method), ["POST", "DELETE"]);
  assert.ok(h.requests.every(r => r.url.endsWith("/connection") && r.body === undefined));
});
test("a connection acknowledgment arriving during stop cannot revive the collector", async (h) => {
  h.claudeFile(); let release;
  h.respond(request => request.method === "POST" ? new Promise(resolve => { release = resolve; })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ connected: false, lastSeenAt: h.iso(), protocol: "connection-v1" }) }));
  const loop = h.api.runLoop(config, { loadConfig: h.api.readConfig }); await h.drain();
  const stopping = loop.stop(); release({ ok: true, status: 200, json: async () => ({ connected: true, lastSeenAt: h.iso(), protocol: "connection-v1" }) });
  await stopping; assert.equal(h.status().status, "offline"); assert.equal(h.status().connected, false);
  assert.equal(h.posts().length, 0); assert.ok(!h.io.some(i => i.path.startsWith(".claude")));
  assert.deepEqual(h.requests.map(r => r.method), ["POST", "DELETE"]);
});
const inboxPath = (h) => path.join(h.home, ".vibehub", ATTESTED_INBOX);
const INBOX_READ_OPS = ["existsSync", "lstatSync", "realpathSync", "openSync", "readSync"];

test("the opt-in receiver is off by default and its inbox is never opened", async (h) => {
  const inbox = h.attestedInbox(); h.append(inbox, h.attested());
  await h.tick(); h.time(30000); await h.tick();
  assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
  assert.equal(h.status().attestedReceiver, false);
  assert.ok(!h.io.some((i) => i.path.endsWith(ATTESTED_INBOX)));
});
test("a consented receiver reports dated, measured metadata as real activity", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  h.append(inbox, h.attested()); await h.tick();
  const beat = h.beats().at(-1);
  assert.equal(beat.tool, "quadcode"); assert.equal(beat.model, "claude-fable-5-1");
  assert.equal(beat.projectAlias, "unknown");
  // Round 4: activity and model still arrive, but `quadcode` is now a TOKENLESS tool,
  // so even a producer's measured claim is not attributed. The only consentable
  // receiver tool is tokenless today, which means the receiver contributes activity
  // and model only — the measured path stays implemented and stays unreachable until
  // a tool with a real counter is added to ATTESTED_TOOLS.
  assert.deepEqual(beat.usage, []);
  assert.equal(Object.hasOwn(beat, "tokensInputDelta"), false);
  assert.equal(Object.hasOwn(beat, "tokensOutputDelta"), false);
  assert.equal(h.status().attestedReceiver, true);
});
test("a local timestamp with no timezone is rejected, never repaired with a host offset", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  // Exactly the shape Quadcode's own chat records carry: ISO text, no zone at all.
  h.append(inbox, h.attested({ occurredAt: new Date(h.now()).toISOString().replace("Z", "") }),
    h.attested({ occurredAt: h.now() }), h.attested({ occurredAt: "2026-06-09 12:00:00" }));
  await h.tick(); assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
});
test("a derived count cannot enter the receiver under any spelling", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  h.append(inbox, h.attested({ estimated: true }), h.attested({ estimated: false }),
    h.attested({ measured: "yes" }), h.attested({ measured: false }),
    h.attested({ measured: true, tokensInputDelta: 1.5 }), h.attested({ measured: true, tokensOutputDelta: -1 }));
  await h.tick(); assert.equal(h.posts().length, 0);
});
test("unmeasured receiver usage stays unknown instead of becoming a zero", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  const { tokensInputDelta, tokensOutputDelta, ...noCounts } = h.attested();
  h.append(inbox, { ...noCounts, measured: false }); await h.tick();
  const beat = h.beats().at(-1);
  assert.equal(beat.tool, "quadcode"); assert.equal(beat.model, "claude-fable-5-1");
  assert.deepEqual(beat.usage, []);
  // Unknown is now ABSENT on the wire rather than 0: a zero would be booked by an
  // older server as a measurement that came back empty.
  assert.equal(Object.hasOwn(beat, "tokensInputDelta"), false);
  assert.equal(Object.hasOwn(beat, "tokensOutputDelta"), false);
});
test("an unknown model from the receiver stays null and is never invented", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  h.append(inbox, h.attested({ model: "grok-4.6" })); await h.tick();
  const beat = h.beats().at(-1);
  assert.equal(beat.tool, "quadcode"); assert.equal(beat.model, null);
  assert.deepEqual(beat.usage, []);
});
test("the receiver never replays history and counts a repeated record id once", async (h) => {
  const inbox = h.attestedInbox();
  h.append(inbox, h.attested({ recordId: "written-before-we-looked" }));
  h.optIn(); await h.tick();
  assert.equal(h.posts().length, 0);
  const once = h.attested({ recordId: "counted-once" });
  h.append(inbox, once); await h.tick();
  assert.equal(h.beats().at(-1).tool, "quadcode");
  const beats = h.beats().length;
  h.append(inbox, once); await h.tick();
  assert.equal(h.beats().length, beats);
  assert.equal(h.posts().at(-1).eventType, "session_end");
});
test("the receiver cannot assert activity for a natively supported tool", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  h.append(inbox, h.attested({ tool: "claude-code" }), h.attested({ tool: "codex" }));
  await h.tick(); assert.equal(h.posts().length, 0);
});
test("a receiver-eligible tool the user did not consent to is still refused", async (h) => {
  // Round 5: `cursor` and `windsurf` are receiver-eligible ids, which is NOT the same as
  // consented. Consent is per tool, so a producer writing records for a second tool
  // cannot ride in on the first tool's switch.
  const inbox = h.attestedInbox(); h.optIn(["quadcode"]); await h.tick();
  h.append(inbox, h.attested({ tool: "cursor" }), h.attested({ tool: "windsurf" }));
  await h.tick(); assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
});
for (const tool of ["cursor", "windsurf"]) {
  test(`a consented ${tool} hook record is activity with a model and NO tokens`, async (h) => {
    const inbox = h.attestedInbox(); h.optIn([tool]); await h.tick();
    // Exactly what src/hooks/payload.ts writes: v, tool, recordId, occurredAt, model and
    // an optional folder-basename projectHint. No `measured`, no counts, no `estimated` -
    // absence is what makes the usage unknown rather than a measured zero.
    const { measured, tokensInputDelta, tokensOutputDelta, ...hook } = h.attested({ tool });
    assert.deepEqual(Object.keys(hook), ["v", "tool", "recordId", "occurredAt", "model", "projectHint"]);
    h.append(inbox, hook); await h.tick();
    const beat = h.beats().at(-1);
    assert.equal(beat.tool, tool);
    assert.equal(beat.model, "claude-fable-5-1");
    assert.equal(beat.projectAlias, "unknown");
    assert.deepEqual(beat.usage, []);
    assert.equal(Object.hasOwn(beat, "tokensInputDelta"), false);
    assert.equal(Object.hasOwn(beat, "tokensOutputDelta"), false);
    assert.equal(h.status().tool, tool);
    assert.equal(h.status().attestedReceiver, true);
  });
  test(`a producer cannot book ${tool} tokens by claiming it measured them`, async (h) => {
    // Neither vendor's hook system reports a token count, so a measured claim for one of
    // them is wrong by construction. The turn still counts as activity: the record is
    // accepted, and only its counts are refused.
    const inbox = h.attestedInbox(); h.optIn([tool]); await h.tick();
    h.append(inbox, h.attested({ tool, measured: true, tokensInputDelta: 4000, tokensOutputDelta: 900 }));
    await h.tick();
    const beat = h.beats().at(-1);
    assert.equal(beat.tool, tool);
    assert.deepEqual(beat.usage, []);
    assert.equal(Object.hasOwn(beat, "tokensInputDelta"), false);
    assert.equal(Object.hasOwn(beat, "tokensOutputDelta"), false);
  });
}
test("consent for a natively supported tool is malformed config, not a wider receiver", async (h) => {
  h.attestedInbox(); h.optIn(["claude-code"]);
  await h.tick(); assert.equal(h.posts().length, 0); assert.equal(h.status().status, "offline");
});
test("withdrawing consent removes the receiver and stops reading its inbox", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  h.append(inbox, h.attested()); await h.tick();
  assert.equal(h.beats().at(-1).tool, "quadcode");
  h.optOut();
  const before = h.io.length, posts = h.posts().length;
  h.append(inbox, h.attested()); await h.tick();
  // Withdrawal fences collected state exactly as an account change does: the open
  // session is DROPPED, not closed with a session_end built from evidence the user
  // has just revoked. Nothing is sent at all; the server's own idle timeout closes it.
  assert.equal(h.posts().length, posts);
  assert.equal(h.state.activeSession, null);
  assert.equal(h.status().attestedReceiver, false);
  assert.ok(!h.io.slice(before).some((i) => i.path.endsWith(ATTESTED_INBOX)));
});
test("the receiver inbox is read-only: never written, rotated, chmod-ed or deleted", async (h) => {
  const inbox = h.attestedInbox(); h.optIn(); await h.tick();
  h.append(inbox, h.attested()); await h.tick(); await h.tick();
  const touched = h.io.filter((i) => i.path.endsWith(ATTESTED_INBOX));
  assert.ok(touched.length > 0);
  assert.ok(touched.every((i) => INBOX_READ_OPS.includes(i.op)));
  assert.equal(inboxPath(h), inbox);
});
test("a native adapter cannot emit a receiver-only tool id", async (h) => {
  const d = new h.api.Detector(300000);
  d.adapters = [{ name: "fixture", poll: async () => [{ tool: "quadcode", cwd: null, projectHint: null,
    model: "claude-opus-5", confidence: "activity", observedAt: h.now(), lastActivityAt: h.now(),
    tokensInputDelta: 5, tokensOutputDelta: 5,
    usage: [{ model: "claude-opus-5", tokensInputDelta: 5, tokensOutputDelta: 5 }] }] }];
  assert.equal(await d.detect(h.now()), null);
});

if (!bundleMode) {
  test("retired process exports stay inert; Quadcode discovers nothing without its tree", async (h) => {
    // Round 4: the Quadcode adapter is no longer a stub, so this no longer asserts
    // inertness-by-deletion. It asserts the live adapter finds nothing when the
    // documented tree is absent — and that the retired CONTENT helpers are still
    // dead, because a chat body must never become a token count or a window title.
    assert.deepEqual(plain(await new h.api.ProcessAdapter(1000).poll()), []);
    assert.deepEqual(plain(await new h.api.QuadcodeAdapter(1000).poll()), []);
    assert.equal(h.api.estimateTokens(CANARY), 0); assert.equal(h.api.stripToolResults(CANARY), "");
    assert.equal(h.api.isRealWindowTitle(CANARY), false);
    assert.equal(h.api.projectFromTitle(CANARY, ["Cursor"]), null);
  });
  // Ported from the retired scripts/local-title-model-check.ts (finding F2). That script
  // still expected the window-title parser to RESOLVE a project; the parser was retired and
  // its helpers are inert, so the useful half of it is this: no title, however realistic,
  // may ever become a project or be called real. Nothing here enables a probe - both
  // helpers are the retired stubs, and these assertions are what keeps them that way.
  test("no window title, real-looking or OS-generated, can become a project", async (h) => {
    for (const title of ["● index.ts - vibehub - Cursor", "myrepo - Cursor",
      "app.ts - deephold - Visual Studio Code", "Quadcode.ai", "Grok", "OleMainThreadWndName",
      "OleDdeWndName", "MSCTFIME UI", "Default IME", "", " ", CANARY]) {
      assert.equal(h.api.isRealWindowTitle(title), false, `${title} must not be a real title`);
      for (const suffixes of [["Cursor"], ["Visual Studio Code"], []]) {
        assert.equal(h.api.projectFromTitle(title, suffixes), null, `${title} must not yield a project`);
      }
    }
  });
  test("Quadcode QUADCODE_HOME may name the real root, and nothing else", async (h) => {
    const file = h.quadcodeFile(); await h.tick();
    h.env.QUADCODE_HOME = path.join(h.home, "UNRELATED_NEVER_OPEN");
    h.append(file, h.quadcodeLlm()); await h.tick();
    assert.equal(h.posts().length, 0);
    assert.ok(h.io.every((i) => !i.path.includes("UNRELATED_NEVER_OPEN")));
  });
  test("legacy offline queue is not opened, retried, rewritten, deleted or sent", async (h) => {
    const text = JSON.stringify([{ apiUrl: "https://unrelated.invalid", deviceToken: CANARY, payload: { prompt: CANARY } }]);
    const file = h.seed(".vibehub/queue.json", text); await h.api.flushOfflineQueue(); await h.api.flushQueue(async () => { throw new Error("must not replay"); });
    assert.equal(fs.readFileSync(file, "utf8"), text); assert.equal(h.requests.length, 0);
  });
} else test("served bundle preserves CLI command registrations without executing install/start/status/stop", async (h) => {
  // `serve` is the supervisor entry point (lane B, mac app). It was missing here only
  // because the served CJS predated it; regenerating the bundle surfaced the gap.
  //
  // Round 5 adds `hook` (the Cursor/Windsurf producer a vendor spawns) and `hooks` (how a
  // person turns it on). A bundle without them is STALE, not broken: the fix is
  // `npm --prefix vibehub/tracker run bundle`, whose output lands in web/public/tracker/.
  //
  // `autostart` (enable | disable | status) joins them: the one place that writes an OS
  // login entry. It reads and writes nothing but that file and the preference in
  // config.json, so it collects nothing and this gate has no more to say about it than
  // that it is registered - which is exactly what this case is for.
  assert.deepEqual(plain(h.api.commands),
    ["login", "set", "start", "autostart", "status", "stop", "logout", "uninstall", "run-loop", "serve", "hook", "hooks"],
    "served bundle is out of date - re-run `npm run bundle` in tracker/");
});

try {
  typecheck();
  // The producer's own sources are scanned by the same forbidden-probe regex as the
  // collector's. It runs outside the daemon and outside this harness's fs facade, so its
  // only guarantee that it never learned to look at processes, windows or the OS is this
  // one - and it is the newest code in the tree, which is exactly why it is included.
  const source = ["detector.ts", ...["processes", "quadcode", "claudeCode", "codex", "jsonlTail", "attested"].map((n) => `adapters/${n}.ts`),
    ...["payload", "inbox", "install"].map((n) => `hooks/${n}.ts`)]
    .map((file) => fs.readFileSync(path.join(tracker, "src", file), "utf8")).join("\n");
  const forbidden = /Get-CimInstance|Win32_Process|GetForegroundWindow|GetWindowText|GetLastInputInfo|CGWindowList|CGEventSource|osascript|ioreg|tasklist|wmic|xprintidle|xprop|xdotool|git rev-parse|file_versions/;
  assert.ok(!forbidden.test(source), "retired host/content probes must not remain in collector sources");
  // Round 5 - the producer/collector separation, enforced statically rather than trusted.
  // `src/hooks/**` writes ~/.vibehub/attested.jsonl and a vendor's own hooks.json; the
  // collector may do neither. Every case above runs against collector modules only, so
  // this assertion is what keeps that boundary honest: if a collector module ever imports
  // the producer, the daemon could write its own evidence and the harness would never see
  // it. index.ts is the CLI entry point and is allowed to reach both sides.
  const collectorSources = (function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "hooks" ? [] : walk(full);
      return entry.isFile() && full.endsWith(".ts") && path.relative(path.join(tracker, "src"), full) !== "index.ts" ? [full] : [];
    });
  })(path.join(tracker, "src"));
  for (const file of collectorSources) {
    assert.ok(!/["']\.{1,2}\/hooks\//.test(fs.readFileSync(file, "utf8")),
      `collector module must not import the hook producer: ${path.relative(tracker, file)}`);
  }
  console.log(`PASS producer isolation (${collectorSources.length} collector modules import no ./hooks/)`);
  if (bundleMode) {
    assertFreshBundle();
    const bytes = fs.readFileSync(bundleFile);
    assert.ok(!forbidden.test(bytes.toString("utf8")));
    console.log(`BUNDLE_SHA256 ${crypto.createHash("sha256").update(bytes).digest("hex")}`);
  }
  for (const { name, fn } of cases) {
    let h;
    try { h = createHarness(); await fn(h); h.clean(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false }); console.error(`FAIL ${name}\n${error.stack ?? error}`); }
    finally { h?.dispose(); }
  }
  const failed = results.filter((r) => !r.passed).length;
  console.log(`AI_ONLY_${bundleMode ? "BUNDLE" : "SOURCE"}: ${results.length - failed}/${results.length} passed; ${failed} failed. Synthetic HOME only; no CLI startup, native shell, process discovery or live network.`);
  if (failed) process.exitCode = 1;
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
finally {
  try { fs.rmSync(runRoot, { recursive: true, force: true }); } catch {}
  for (const key of Object.keys(originalEnv)) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }
}
