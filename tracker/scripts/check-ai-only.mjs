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
const bundleFile = path.resolve(tracker, "../web/public/tracker/vibehub-tracker.cjs");
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
  "adapters/claudeCode", "adapters/codex", "adapters/jsonlTail", "adapters/processes", "adapters/quadcode", "queue"];
const within = (root, file) => { const rel = path.relative(root, file); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const dump = (value) => JSON.stringify(value, (_key, v) => v instanceof Map || v instanceof Set ||
  Object.prototype.toString.call(v) === "[object Map]" || Object.prototype.toString.call(v) === "[object Set]" ? [...v] : typeof v === "bigint" ? String(v) : v);
const plain = (v) => JSON.parse(JSON.stringify(v));
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
  const env = { HOME: home, USERPROFILE: home };
  const rootClaude = path.join(home, ".claude/projects");
  const rootCodex = path.join(home, ".codex/sessions");
  const own = path.join(home, ".vibehub");
  const deny = (name) => { violations.push(name); throw new Error(`Forbidden collector operation: ${name}`); };
  const allowed = (file, op) => {
    if (typeof file !== "string" && !Buffer.isBuffer(file)) return deny(`${op}: non-path`);
    const full = path.resolve(String(file));
    const ownFile = within(own, full) && path.dirname(full) === own &&
      /^(?:config\.json|status\.json|tracker\.pid|stop\.request|\.(?:config\.json|status\.json|tracker\.pid|stop\.request)\.[a-f0-9-]+\.tmp)$/.test(path.basename(full));
    const ai = within(rootClaude, full) || within(rootCodex, full);
    const metadataRoot = [home, own, path.join(home, ".claude"), path.join(home, ".codex")].includes(full);
    if (!(ownFile || ai || metadataRoot)) deny(`${op}: ${path.relative(home, full)}`);
    if (["openSync", "readFileSync", "opendirSync"].includes(op) && !ownFile && !ai) deny(`${op}: root enumeration/content`);
    if (["openSync", "readFileSync", "opendirSync"].includes(op) && fs.existsSync(full)) {
      const real = fs.realpathSync(full);
      if (!(within(own, real) || within(rootClaude, real) || within(rootCodex, real))) deny(`${op}: linked escape`);
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
    dispose: () => { state.detector.clear(); timers.clear(); for (const fd of fds.keys()) fs.closeSync(fd); fs.rmSync(home, { recursive: true, force: true }); },
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
  for (const file of [".cursor/logs/session.jsonl", ".quadcode/chats/session.jsonl", ".bash_history", "Library/Application Support/Chrome/History",
    "AppData/Roaming/Code/logs/session.jsonl", "UNRELATED_NEVER_OPEN/private-project/.git/config", ".config/quadcode/settings.json"]) h.seed(file, CANARY);
  await h.tick(); assert.equal(h.posts().length, 0); assert.equal(h.status().status, "idle");
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
  for (const bad of [{ ...payload, tool: "chatgpt" }, { ...payload, eventType: "git_commit" }, { ...payload, projectAlias: "../../secret" },
    { ...payload, usage: [{ tool: "cursor", model: "gpt-4.1", tokensInputDelta: 1, tokensOutputDelta: 1 }] }]) assert.equal((await h.api.postHeartbeat(config.apiUrl, config.deviceToken, bad)).ok, false);
  assert.equal(h.requests.length, n);
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
if (!bundleMode) {
  test("retired process/Quadcode exports are inert and never invoke discovery", async (h) => {
    assert.deepEqual(plain(await new h.api.ProcessAdapter(1000).poll()), []); assert.deepEqual(plain(await new h.api.QuadcodeAdapter(1000).poll()), []);
    assert.equal(h.api.estimateTokens(CANARY), 0); assert.equal(h.api.isRealWindowTitle(CANARY), false);
    assert.equal(h.api.projectFromTitle(CANARY, ["Cursor"]), null);
  });
  test("legacy offline queue is not opened, retried, rewritten, deleted or sent", async (h) => {
    const text = JSON.stringify([{ apiUrl: "https://unrelated.invalid", deviceToken: CANARY, payload: { prompt: CANARY } }]);
    const file = h.seed(".vibehub/queue.json", text); await h.api.flushOfflineQueue(); await h.api.flushQueue(async () => { throw new Error("must not replay"); });
    assert.equal(fs.readFileSync(file, "utf8"), text); assert.equal(h.requests.length, 0);
  });
} else test("served bundle preserves CLI command registrations without executing install/start/status/stop", async (h) => {
  assert.deepEqual(plain(h.api.commands), ["login", "set", "start", "status", "stop", "logout", "run-loop"]);
});

try {
  typecheck();
  const source = ["detector.ts", ...["processes", "quadcode", "claudeCode", "codex", "jsonlTail"].map((n) => `adapters/${n}.ts`)]
    .map((file) => fs.readFileSync(path.join(tracker, "src", file), "utf8")).join("\n");
  const forbidden = /Get-CimInstance|Win32_Process|GetForegroundWindow|GetWindowText|GetLastInputInfo|CGWindowList|CGEventSource|osascript|ioreg|tasklist|wmic|xprintidle|xprop|xdotool|git rev-parse|file_versions/;
  assert.ok(!forbidden.test(source), "retired host/content probes must not remain in collector sources");
  if (bundleMode) { const bytes = fs.readFileSync(bundleFile); assert.ok(!forbidden.test(bytes.toString("utf8"))); console.log(`BUNDLE_SHA256 ${crypto.createHash("sha256").update(bytes).digest("hex")}`); }
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
  fs.rmSync(runRoot, { recursive: true, force: true });
  for (const key of Object.keys(originalEnv)) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }
}
