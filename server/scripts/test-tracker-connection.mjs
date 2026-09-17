#!/usr/bin/env node
/**
 * Fixture-only connection-v1 regressions. Run from the workspace root:
 *   node vibehub/server/scripts/test-tracker-connection.mjs
 *
 * No application startup, sockets, database/client initialization, schema lookup,
 * environment loading, personal files, tracker, subprocesses or generated output.
 * Only the exact source allowlist below is read. TypeScript.transpileModule works
 * on those strings, with compiler filesystem access disabled. Every application
 * import is resolved by a closed VM loader: DB, hub, auth services, Express,
 * upload filesystem and all other side effects are stubbed BEFORE evaluation.
 * This proves source behavior under fixtures, not an HTTP/DB/replica deployment.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
const compilerIo = [];
for (const method of ["readFile", "writeFile", "readDirectory", "getDirectories", "fileExists", "directoryExists", "createDirectory", "realpath"]) {
  ts.sys[method] = () => {
    compilerIo.push(method);
    throw new Error(`Compiler filesystem access forbidden: ${method}`);
  };
}
const EXECUTABLE = new Set([
  "src/lib/trackerConnection.ts", "src/lib/http-error.ts", "src/lib/json-field.ts",
  "src/lib/sessions.ts", "src/lib/tracker-me.ts", "src/lib/__checks__/trackerMe.check.ts",
  "src/services/trackerConnection.ts", "src/middleware/auth.ts", "src/routes/tracker.ts",
  "src/routes/users.ts", "src/jobs/session-rollup.ts",
]);
const SOURCES = new Map([...EXECUTABLE, "src/index.ts", "src/ws/hub.ts"].map((name) => [
  name, readFileSync(new URL(`../${name}`, import.meta.url), "utf8"),
]));
const compiled = new Map();
function compile(name, source = SOURCES.get(name)) {
  assert.ok(EXECUTABLE.has(name), `Not executable: ${name}`);
  const key = `${name}\0${source}`;
  if (!compiled.has(key)) {
    const result = ts.transpileModule(source, {
      fileName: name, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        esModuleInterop: true, isolatedModules: true, noResolve: true, noLib: true },
    });
    const errors = result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? [];
    assert.deepEqual(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")), [], name);
    compiled.set(key, result.outputText);
  }
  return compiled.get(key);
}

const BASE = Date.UTC(2026, 8, 16, 12);
const TTL = 90_000;
const RETENTION = 86_400_000;
const RAW_A = "fixture-bearer-A-DO-NOT-STORE";
const RAW_A2 = "fixture-bearer-A2-DO-NOT-STORE";
const RAW_B = "fixture-bearer-B-DO-NOT-STORE";
const A = "fixture-owner-a";
const B = "fixture-owner-b";
const D1 = "fixture-device-a1";
const D2 = "fixture-device-a2";
const DB = "fixture-device-b1";
const RealDate = Date;
const date = (at = BASE) => new RealDate(at);
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function clone(value) {
  if (value instanceof RealDate) return new RealDate(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}
let assertions = 0;
const eq = (actual, expected, label) => { assertions++; assert.deepEqual(plain(actual), plain(expected), label); };
const ok = (condition, label) => { assertions++; assert.ok(condition, label); };
const throws = (fn, predicate, label) => { assertions++; assert.throws(fn, predicate, label); };
const rejects = async (fn, predicate, label) => { assertions++; await assert.rejects(fn, predicate, label); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Fixture promise did not settle")), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
function fieldMatches(actual, expected) {
  if (expected instanceof RealDate) return actual instanceof RealDate && actual.getTime() === expected.getTime();
  if (!expected || typeof expected !== "object") return actual === expected;
  return Object.entries(expected).every(([key, value]) => {
    if (key === "not") return !fieldMatches(actual, value);
    if (key === "in") return value.some((item) => fieldMatches(actual, item));
    if (key === "notIn") return !value.some((item) => fieldMatches(actual, item));
    if (key === "gte") return actual != null && actual >= value;
    if (key === "lt") return actual != null && actual < value;
    throw new Error(`Unsupported fixture predicate: ${key}`);
  });
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (key === "userId_date_model_tool" || key === "userId_date") return matches(row, value);
    return fieldMatches(row[key], value);
  });
}
function fixtureRows() {
  return {
    user: [A, B].map((id, index) => ({ id, username: index ? "fixture-bob" : "fixture-alice",
      displayName: "Fictional user", avatarUrl: null })),
    authSession: [A, B].map((userId, index) => ({ id: `cookie-session-${index}`, userId,
      revokedAt: null, expiresAt: date(BASE + 7 * RETENTION) })),
    trackerToken: [[D1, A, RAW_A], [D2, A, RAW_A2], [DB, B, RAW_B]].map(([id, userId, raw]) => ({
      id, userId, tokenHash: `fixture-hash:${raw}`, label: id, revokedAt: null,
      lastUsedAt: null, lastRejectedAt: null, createdAt: date(BASE - 1000),
    })),
    session: [], dailyStat: [], activityEvent: [], userStreak: [], githubCommitDay: [],
  };
}
let activeHarnesses = [];
function harness({ allowAiWrites = false, tables = fixtureRows(), overrides = new Map() } = {}) {
  const h = { clock: BASE, tables: clone(tables), calls: [], writes: [], events: [], logs: [],
    violations: [], virtualMkdirs: [], loaded: [], hooks: {}, allowExpectedViolations: false };
  activeHarnesses.push(h);
  const forbidden = (label) => {
    h.violations.push(label);
    throw new Error(`Fixture isolation blocked: ${label}`);
  };
  class ClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [h.clock])); }
    static now() { return h.clock; }
    static [Symbol.hasInstance](value) { return value instanceof RealDate; }
  }
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === "object" && "increment" in value
        ? (row[key] ?? 0) + value.increment : clone(value);
    }
  };
  const project = (row, args) => {
    if (!row) return null;
    const result = args.select
      ? Object.fromEntries(Object.keys(args.select).filter((key) => args.select[key]).map((key) => [key, clone(row[key])]))
      : clone(row);
    if (args.include?.user) result.user = clone(h.tables.user.find((user) => user.id === row.userId));
    return result;
  };
  async function query(model, operation, args = {}) {
    const key = `${model}.${operation}`;
    h.calls.push({ key, args: clone(args) });
    await h.hooks[`before:${key}`]?.(args);
    const rows = h.tables[model];
    if (!rows) return forbidden(`DB model ${model}`);
    let result;
    if (["findUnique", "findUniqueOrThrow", "findFirst", "findMany"].includes(operation)) {
      let selected = rows.filter((row) => matches(row, args.where));
      if (args.orderBy) {
        const [field, direction] = Object.entries(args.orderBy)[0];
        selected = [...selected].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === "desc" ? -1 : 1));
      }
      if (args.take !== undefined) selected = selected.slice(0, args.take);
      if (operation === "findMany") result = selected.map((row) => project(row, args));
      else result = project(selected[0], args);
      if (operation === "findUniqueOrThrow" && !result) throw new Error("Fixture row not found");
    } else {
      const tokenWrite = model === "trackerToken" && ["create", "update", "updateMany"].includes(operation);
      const aiWrite = allowAiWrites && ["session", "dailyStat", "activityEvent", "userStreak"].includes(model)
        && ["create", "update", "upsert"].includes(operation);
      h.writes.push({ key, args: clone(args) });
      if (!tokenWrite && !aiWrite) return forbidden(`DB write ${key}`);
      if (tokenWrite && operation !== "create" && Object.keys(args.data).some((field) => !["lastUsedAt", "lastRejectedAt", "revokedAt"].includes(field))) {
        return forbidden(`Non-bookkeeping token write ${key}`);
      }
      const selected = rows.filter((row) => matches(row, args.where));
      if (operation === "create" || (operation === "upsert" && selected.length === 0)) {
        const row = { id: `fixture-created-${model}-${rows.length}`, ...clone(args.create ?? args.data) };
        if (model === "trackerToken") Object.assign(row, { lastUsedAt: null, lastRejectedAt: null, revokedAt: null, createdAt: date(h.clock) });
        if (model === "session") Object.assign(row, { endedAt: null, coTools: row.coTools ?? null });
        rows.push(row);
        result = project(row, args);
      } else if (operation === "updateMany") {
        for (const row of selected) apply(row, args.data);
        result = { count: selected.length };
      } else {
        if (!selected[0]) throw new Error("Fixture update target missing");
        apply(selected[0], args.update ?? args.data);
        result = project(selected[0], args);
      }
    }
    await h.hooks[`after:${key}`]?.(args, result);
    return result;
  }
  const models = new Map();
  const prisma = new Proxy({}, { get(_target, model) {
    if (model === "$transaction") return async (fn) => typeof fn === "function" ? fn(prisma) : Promise.all(fn);
    if (typeof model !== "string" || model.startsWith("$")) return () => forbidden(`DB ${String(model)}`);
    if (!models.has(model)) models.set(model, new Proxy({}, { get(_object, operation) {
      return (args) => query(model, operation, args);
    } }));
    return models.get(model);
  } });
  const Router = () => {
    const router = { routes: [] };
    for (const method of ["get", "post", "put", "patch", "delete"]) router[method] = (route, ...handlers) => router.routes.push({ method, route, handlers });
    return router;
  };
  const multer = Object.assign(() => ({ single: () => () => forbidden("avatar middleware execution") }), { diskStorage: () => ({}) });
  let minted = 0;
  const stubs = new Map([
    ["express", { Router }], ["multer", multer], ["src/db.ts", { prisma }],
    ["node:path", path.posix], ["node:crypto", { randomBytes: () => forbidden("avatar random bytes") }],
    ["node:fs", { mkdirSync: (target) => {
      assert.equal(target, "/fixture-only/uploads/avatars");
      h.virtualMkdirs.push(target);
    }, rm: () => forbidden("avatar filesystem deletion") }],
    ["src/env.ts", { env: { uploadDir: "/fixture-only/uploads", sessionIdleTimeoutMs: 600_000, databaseProvider: "fixture" } }],
    ["src/auth/jwt.ts", { SESSION_COOKIE: "fixture_session", verifySessionToken: (value) => {
      if (value === "cookie-a") return { sub: A, jti: "cookie-session-0" };
      if (value === "cookie-b") return { sub: B, jti: "cookie-session-1" };
      return null;
    } }],
    ["src/lib/crypto.ts", { hashToken: (raw) => `fixture-hash:${raw}`, generateRawToken: () => `fixture-minted-${++minted}` }],
    ["src/lib/friends.ts", { friendIdsOf: async () => [] }],
    ["src/lib/level.ts", { computeLevel: async () => ({ level: 1 }), computeLevels: async () => new Map() }],
    ["src/lib/github.ts", { fetchOwnRepos: () => forbidden("GitHub"), getFreshGithubToken: () => forbidden("GitHub token"),
      GithubAuthError: class extends Error {}, NoGithubTokenError: class extends Error {} }],
    ["src/lib/links.ts", { detectIcon: () => forbidden("link mutation"), detectLabel: () => forbidden("link mutation") }],
    ["src/lib/serializers.ts", { toMeUser: () => forbidden("profile mutation"), toPublicLink: () => forbidden("link serialization"), toPublicUser: () => forbidden("public profile") }],
    ["src/lib/schemas.ts", { heartbeatSchema: { parse: clone }, createTrackerTokenSchema: { parse: clone } }],
    ["src/ws/hub.ts", { emitPresenceUpdate: async (userId, presence) => {
      await h.hooks.emit?.(userId, presence);
      h.events.push({ userId, presence: clone(presence) });
    } }],
  ]);
  const context = vm.createContext({ Date: ClockDate, Object,
    console: Object.fromEntries(["log", "warn", "error"].map((key) => [key, (...args) => h.logs.push(args.map(String).join(" "))])),
    fetch: () => forbidden("network fetch"), setInterval: () => forbidden("job start"),
    setTimeout: () => forbidden("application timer"), WebSocket: () => forbidden("WebSocket"),
  }, { codeGeneration: { strings: false, wasm: false } });
  const cache = new Map();
  function load(name) {
    if (stubs.has(name)) return stubs.get(name);
    if (!EXECUTABLE.has(name)) return forbidden(`module ${name}`);
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} };
    cache.set(name, module);
    h.loaded.push(name);
    const wrapper = new vm.Script(`(function(require,module,exports){\n${compile(name, overrides.get(name) ?? SOURCES.get(name))}\n})`, { filename: name });
    const fn = wrapper.runInContext(context, { timeout: 1000 });
    fn((specifier) => {
      const target = specifier.startsWith(".") ? `${path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier))}.ts` : specifier;
      return load(target);
    }, module, module.exports);
    return module.exports;
  }
  h.load = load;
  h.prisma = prisma;
  h.connection = load("src/lib/trackerConnection.ts");
  h.store = h.connection.trackerConnections;
  h.presence = load("src/lib/sessions.ts").presenceFor;
  h.service = load("src/services/trackerConnection.ts");
  h.job = load("src/jobs/session-rollup.ts");
  h.tracker = load("src/routes/tracker.ts").default;
  h.users = load("src/routes/users.ts").default;
  h.request = (router, method, route, options = {}) => {
    const entry = router.routes.find((item) => item.method === method && item.route === route);
    assert.ok(entry, `Missing registered route: ${method} ${route}`);
    const headers = { ...(options.raw ? { authorization: `Bearer ${options.raw}` } : {}), ...options.headers };
    const req = { body: options.body, params: options.params ?? {}, query: options.query ?? {},
      cookies: { fixture_session: options.cookie }, ip: "fixture-IP-DO-NOT-STORE",
      ...options.forged, header: (name) => headers[name.toLowerCase()] };
    return new Promise((resolve, reject) => {
      let index = 0;
      const result = { status: 200, body: undefined, headers: {} };
      const res = { status: (code) => { result.status = code; return res; },
        setHeader: (name, value) => { result.headers[name.toLowerCase()] = value; },
        json: (body) => { result.body = plain(body); resolve(result); return res; },
        end: () => { resolve(result); return res; } };
      const next = (error) => {
        if (error) {
          try { load("src/lib/http-error.ts").errorHandler(error, req, res, () => {}); } catch (failure) { reject(failure); }
          return;
        }
        const handler = entry.handlers[index++];
        if (!handler) { reject(new Error("Fixture route ended without a response")); return; }
        try { handler(req, res, next); } catch (failure) { next(failure); }
      };
      next();
    });
  };
  h.post = (raw = RAW_A, body, extra = {}) => h.request(h.tracker, "post", "/tracker/connection", { raw, body, ...extra });
  h.stop = (raw = RAW_A, body, extra = {}) => h.request(h.tracker, "delete", "/tracker/connection", { raw, body, ...extra });
  h.verify = (raw = RAW_A) => h.request(h.tracker, "get", "/tracker/verify", { raw });
  h.menu = (raw = RAW_A) => h.request(h.tracker, "get", "/tracker/me", { raw });
  h.browser = (cookie = "cookie-a") => h.request(h.users, "get", "/users/me/tracker", { cookie });
  h.revoke = (id = D1, cookie = "cookie-a") => h.request(h.users, "delete", "/users/me/tracker-tokens/:id", { cookie, params: { id } });
  return h;
}
function seedSession(h, overrides = {}) {
  const row = { id: "fixture-ai-session", userId: A, projectAlias: "fixture-ai-project", tool: "claude-code",
    model: "fixture-model", status: "ACTIVE", startedAt: date(h.clock - 20_000), lastHeartbeatAt: date(h.clock),
    endedAt: null, tokensInput: 17, tokensOutput: 23, coTools: null, ...overrides };
  h.tables.session.push(row);
  return row;
}
const withoutUsageWrites = (h, from = 0) => eq(h.writes.slice(from).filter((item) => !item.key.startsWith("trackerToken.")), [], "No AI/history/Git/streak writes");
const snapshot = (connected, lastSeenAt = null) => ({ connected, lastSeenAt });
const receipt = (connected, at = null) => ({ connected, lastSeenAt: at === null ? null : date(at).toISOString(), protocol: "connection-v1" });
const cases = [];
const test = (name, run) => cases.push({ name, run });

// Scenarios follow. All clocks, accounts, tokens and AI rows are fictional.
test("registered POST/DELETE use tracker auth; API mount and friend fan-out stay unchanged", async () => {
  const h = harness();
  const auth = h.load("src/middleware/auth.ts").requireTrackerToken;
  eq(h.tracker.routes.filter((r) => r.route === "/tracker/connection").map((r) => r.method), ["post", "delete"]);
  for (const route of h.tracker.routes.filter((r) => r.route === "/tracker/connection")) ok(route.handlers[0] === auth);
  ok(SOURCES.get("src/index.ts").includes('app.use("/api/v1", trackerRoutes)'));
  ok(SOURCES.get("src/ws/hub.ts").includes("new Set(await friendIdsOf(userId))"));
  ok(SOURCES.get("src/ws/hub.ts").includes("recipients.add(userId)"));
  eq(h.virtualMkdirs, ["/fixture-only/uploads/avatars"]);
  eq(h.store.size, { devices: 0, owners: 0, pending: 0 });
});

test("missing, malformed, unknown and cookie-only credentials never create liveness", async () => {
  const h = harness();
  for (const call of [h.post, h.stop]) {
    for (const headers of [{}, { authorization: "Basic fixture" }, { authorization: "Bearer " }, { authorization: "Bearer nonexistent" }]) {
      const result = await call(null, undefined, { headers, cookie: "cookie-a", forged: { trackerUserId: A, trackerTokenId: D1 } });
      eq(result.status, 401);
    }
  }
  eq((await h.browser("bad-cookie")).status, 401);
  eq(h.store.size.devices, 0);
  eq(h.events, []);
  eq(h.writes, []);
});

test("undefined and empty JSON objects return the exact server receipt", async () => {
  const h = harness();
  for (const body of [undefined, {}, Object.create(null)]) {
    const result = await h.post(RAW_A, body);
    eq(result.status, 200);
    eq(result.body, receipt(true, h.clock));
    eq(result.headers["cache-control"], "no-store");
    h.clock += 30_000;
  }
  eq(h.store.size.devices, 1);
  withoutUsageWrites(h);
  ok(h.writes.every((write) => Object.keys(write.args.data).join() === "lastUsedAt"));
});

test("both methods reject every nonempty/nonobject body without changing the receipt", async () => {
  const h = harness();
  await h.post();
  h.clock += 1000;
  const hidden = Object.defineProperty({}, "hidden", { value: undefined });
  const bodies = [null, [], [1], "", "{}", 0, 1, true, false, date(),
    { tool: "CANARY" }, { model: null }, { project: "CANARY" }, { lastSeenAt: undefined },
    { occurredAt: date().toISOString() }, { tokens: 0 }, { connected: true },
    { protocol: "connection-v1" }, { __proto__: null, extra: 1 }, hidden,
    { [Symbol("hidden")]: 1 }, Object.create({ inherited: true })];
  for (const call of [h.post, h.stop]) for (const body of bodies) {
    eq((await call(RAW_A, body)).status, 400);
    eq(h.store.snapshot(A, D1), snapshot(true, date(BASE)));
  }
  eq(h.events.length, 1);
  withoutUsageWrites(h);
});

test("unparsed text/form/framed bodies cannot masquerade as empty requests", async () => {
  const h = harness();
  const bad = [
    [{}, { "content-type": "text/plain", "content-length": "7" }],
    [{}, { "content-type": "application/x-www-form-urlencoded", "content-length": "7" }],
    [{}, { "transfer-encoding": "chunked" }],
    [undefined, { "content-type": "application/json", "content-length": "2" }],
    [{}, { "content-type": "application/json-extra", "content-length": "2" }],
  ];
  for (const call of [h.post, h.stop]) for (const [body, headers] of bad) eq((await call(RAW_A, body, { headers })).status, 400);
  eq(h.store.size.devices, 0);
  for (const headers of [{ "content-type": "application/json; charset=utf-8", "content-length": "2" },
    { "content-type": "application/json", "transfer-encoding": "chunked" }]) eq((await h.post(RAW_A, {}, { headers })).status, 200);
  withoutUsageWrites(h);
});

test("store retains only bounded owner/device identities, timestamps and flags", async () => {
  const h = harness();
  const result = await h.post(RAW_A, {}, { query: { tool: "QUERY-CANARY", timestamp: "QUERY-CANARY" } });
  eq(result.body, receipt(true, BASE));
  // White-box keys ensure request/body/IP/token/model/project data cannot hide in the cache.
  const owners = [...h.store.owners];
  eq(owners.map(([id]) => id), [A]);
  eq([...owners[0][1].devices.keys()], [D1]);
  eq(Object.keys(owners[0][1]).sort(), ["changedAt", "devices", "pending", "revision"]);
  const device = owners[0][1].devices.get(D1);
  eq(Object.keys(device).sort(), ["lastSeenAt", "live", "revokedAt"]);
  eq(device, { lastSeenAt: BASE, live: true, revokedAt: null });
  const dump = JSON.stringify(owners, (_key, value) => value instanceof Map || Object.prototype.toString.call(value) === "[object Map]" ? [...value] : value);
  for (const canary of [RAW_A, "fixture-hash:", "QUERY-CANARY", "fixture-IP-DO-NOT-STORE"]) ok(!dump.includes(canary));
  withoutUsageWrites(h);
});

test("verify, status reads, token mint/list and copying a fixture string never connect", async () => {
  const h = harness();
  eq((await h.verify()).body, { username: "fixture-alice" });
  const minted = await h.request(h.users, "post", "/users/me/tracker-tokens", { cookie: "cookie-a", body: { label: "fixture-new", replaceUnused: true } });
  eq(minted.status, 200);
  const beforeCopy = h.calls.length;
  const copied = String(minted.body.token);
  ok(copied.startsWith("fixture-minted-"));
  eq(h.calls.length, beforeCopy); // No frontend behavior is claimed by this server test.
  eq((await h.request(h.users, "get", "/users/me/tracker-tokens", { cookie: "cookie-a" })).status, 200);
  for (let i = 0; i < 4; i++) {
    h.clock += 30_000;
    eq((await h.verify()).status, 200);
    const menu = await h.menu();
    const browser = await h.browser();
    eq(menu.status, 200);
    eq(menu.body.tracker.connected, false);
    eq(menu.body.tracker.lastSeenAt, null);
    ok(menu.body.tracker.devices.every((item) => item.lastSeenAt === null));
    eq(browser.body.connected, false);
    eq(browser.body.lastSeenAt, null);
    eq(browser.body.presence, { status: "offline", activity: null, tools: [], lastSeenAt: null });
  }
  eq(h.store.size.devices, 0);
  eq(h.events, []);
  withoutUsageWrites(h);
});

test("idle transport has no AI details, sources, elapsed time or tokens on either status surface", async () => {
  const h = harness();
  await h.post();
  h.clock += 30_000;
  await h.verify();
  const browser = (await h.browser()).body;
  const menu = (await h.menu()).body;
  eq(browser.connected, true);
  eq(browser.lastSeenAt, date(BASE).toISOString());
  eq(browser.presence, { status: "idle", activity: null, tools: [], lastSeenAt: date(BASE).toISOString() });
  eq(browser.tools, []);
  eq(browser.sources, []);
  eq(menu.tracker.connected, true);
  eq(menu.tracker.lastSeenAt, date(BASE).toISOString());
  eq(menu.presence, { status: "idle", activity: null, lastSeenAt: date(BASE).toISOString() });
  eq(menu.today, { tokens: 0, activeSeconds: 0, sessionStartedAt: null });
  eq(browser.devices.find((item) => item.id === D1).lastSeenAt, date(BASE).toISOString());
  eq(browser.devices.find((item) => item.id === D2).lastSeenAt, null);
  eq(menu.tracker.devices.find((item) => item.name === D1).lastSeenAt, date(BASE).toISOString());
  eq(menu.tracker.devices.find((item) => item.name === D2).lastSeenAt, null);
  eq(h.events[0], {
    userId: A,
    presence: { username: "fixture-alice", status: "idle", activity: null, tools: [], lastSeenAt: date(BASE).toISOString() },
  });
  withoutUsageWrites(h);
});

test("TTL is exactly 90 seconds; repeated HTTP reads neither renew nor consume expiry", async () => {
  const h = harness();
  await h.post();
  h.clock = BASE + TTL - 1;
  eq((await h.browser()).body.connected, true);
  h.clock += 1;
  for (let i = 0; i < 5; i++) {
    eq((await h.browser()).body.connected, false);
    eq((await h.menu()).body.tracker.connected, false);
    eq(h.store.snapshot(A, D1), snapshot(false, date(BASE)));
  }
  h.store.sweep();
  eq(h.store.notifications().map((item) => item.userId), [A]);
  await h.browser();
  eq(h.store.notifications().map((item) => item.userId), [A]);
  eq(await h.job.sweepSessions(), { idled: 0, ended: 0 });
  eq(h.events.at(-1).presence, {
    username: "fixture-alice", status: "offline", activity: null, tools: [], lastSeenAt: date(BASE).toISOString(),
  });
  eq(h.events.length, 2);
  await h.job.sweepSessions();
  eq(h.events.length, 2);
  withoutUsageWrites(h);
});

test("DELETE preserves the last accepted device receipt; repeat stop and reconnect are truthful", async () => {
  const h = harness();
  eq((await h.stop()).body, receipt(false));
  eq(h.store.size.devices, 0);
  await h.post();
  h.clock += 30_000;
  await h.post();
  h.clock += 5000;
  for (let i = 0; i < 2; i++) {
    const stopped = await h.stop();
    eq(stopped.body, receipt(false, BASE + 30_000));
    eq(stopped.headers["cache-control"], "no-store");
  }
  eq((await h.browser()).body.connected, false);
  eq((await h.browser()).body.lastSeenAt, date(BASE + 30_000).toISOString());
  eq((await h.post()).body, receipt(true, h.clock));
  eq((await h.browser()).body.presence.status, "idle");
  withoutUsageWrites(h);
});

test("two devices and two accounts isolate receipt, disconnect and expiry", async () => {
  const h = harness();
  await h.post();
  await h.post(RAW_B);
  h.clock += 60_000;
  await h.post(RAW_A2);
  eq((await h.stop()).body, receipt(false, BASE));
  eq((await h.browser()).body.connected, true);
  eq((await h.browser("cookie-b")).body.connected, true);
  eq(h.store.snapshot(A, DB), snapshot(false));
  h.clock = BASE + TTL;
  await h.job.sweepSessions();
  eq((await h.browser()).body.connected, true);
  eq((await h.browser("cookie-b")).body.connected, false);
  eq((await h.stop(RAW_A2)).body, receipt(false, BASE + 60_000));
  eq((await h.browser()).body.connected, false);
  eq(h.store.forUser(B).lastSeenAt, date(BASE));
  withoutUsageWrites(h);
});

test("genuine Session active/idle history survives transport ticks, stop and revoke", async () => {
  const h = harness();
  const row = seedSession(h);
  const original = clone(row);
  await h.post();
  eq((await h.browser()).body.presence.status, "active");
  eq((await h.menu()).body.today.activeSeconds, 20);
  h.clock += 120_001;
  await h.post();
  const idle = (await h.browser()).body;
  eq(idle.presence.status, "idle");
  eq(idle.presence.activity.tool, "claude-code");
  eq((await h.menu()).body.today.activeSeconds, 20);
  await h.stop();
  await h.revoke();
  eq((await h.browser()).body.presence.status, "idle");
  eq(row, original);
  h.clock = BASE + 600_001;
  await h.post(RAW_A2);
  eq((await h.browser()).body.presence, {
    status: "idle", activity: null, tools: [], lastSeenAt: date(BASE + 600_001).toISOString(),
  });
  eq((await h.menu(RAW_A2)).body.today.activeSeconds, 20);
  eq(row, original);
  withoutUsageWrites(h);
});

test("legacy AI-only presence works without ever registering transport liveness", async () => {
  const h = harness();
  seedSession(h);
  eq((await h.browser()).body.presence.status, "active");
  eq((await h.menu()).body.tracker.lastSeenAt, date(BASE).toISOString());
  h.clock += 120_001;
  eq((await h.browser()).body.presence.status, "idle");
  h.clock = BASE + 600_001;
  eq((await h.browser()).body.presence.status, "offline");
  eq(h.store.size.devices, 0);
  withoutUsageWrites(h);
});

test("ended AI history stays intact while transport alone is idle", async () => {
  const h = harness();
  const row = seedSession(h, { status: "ENDED", endedAt: date(BASE) });
  const original = clone(row);
  h.clock += 5000;
  await h.post();
  eq((await h.browser()).body.presence, {
    status: "idle", activity: null, tools: [], lastSeenAt: date(BASE + 5000).toISOString(),
  });
  await h.stop();
  eq((await h.browser()).body.connected, false);
  eq(row, original);
  withoutUsageWrites(h);
});

test("browser revoke enforces ownership and retires only its device", async () => {
  const h = harness();
  await h.post();
  await h.post(RAW_A2);
  await h.post(RAW_B);
  const writes = h.writes.length;
  eq((await h.revoke(DB)).status, 404);
  eq((await h.revoke("nonexistent")).status, 404);
  eq(h.writes.length, writes);
  eq((await h.revoke()).status, 204);
  eq(h.store.snapshot(A, D1), snapshot(false, date(BASE)));
  eq(h.store.snapshot(A, D2).connected, true);
  eq(h.store.snapshot(B, DB).connected, true);
  eq((await h.browser()).body.connected, true);
  eq((await h.revoke(D2)).status, 204);
  eq((await h.browser()).body.connected, false);
  eq(h.events.at(-1).presence.status, "offline");
  eq((await h.verify()).status, 401);
  eq((await h.post()).status, 401);
  eq((await h.stop()).status, 401);
  eq(h.store.snapshot(A, D1).lastSeenAt, date(BASE));
  withoutUsageWrites(h);
});

test("rejected revoked-token auth retires transport and throttles rejection bookkeeping", async () => {
  const h = harness();
  await h.post();
  h.tables.trackerToken.find((item) => item.id === D1).revokedAt = date(BASE);
  h.clock += 1000;
  eq((await h.menu()).status, 401);
  eq(h.store.snapshot(A, D1), snapshot(false, date(BASE)));
  eq(h.events.at(-1).presence.status, "offline");
  const rejectedWrites = () => h.writes.filter((write) => "lastRejectedAt" in (write.args.data ?? {})).length;
  eq(rejectedWrites(), 1);
  eq((await h.verify()).status, 401);
  eq(rejectedWrites(), 1);
  h.clock += 60_001;
  eq((await h.post()).status, 401);
  eq(rejectedWrites(), 2);
  withoutUsageWrites(h);
});

test("a revoked credential without prior POST gets only a tombstone, never a receipt", async () => {
  const h = harness();
  h.tables.trackerToken[0].revokedAt = date(BASE);
  eq((await h.post()).status, 401);
  eq(h.store.snapshot(A, D1), snapshot(false));
  eq((await h.browser()).body.lastSeenAt, null);
  eq((await h.browser()).body.connected, false);
  withoutUsageWrites(h);
});

test("revocation during auth lookup fails the conditional bookkeeping write", async () => {
  const h = harness();
  h.hooks["before:trackerToken.updateMany"] = () => { h.tables.trackerToken[0].revokedAt = date(h.clock); };
  eq((await h.post()).status, 401);
  eq(h.store.snapshot(A, D1), snapshot(false));
  eq(h.tables.trackerToken[0].lastUsedAt, null);
  withoutUsageWrites(h);
});

test("revocation after conditional auth but before handler is fenced by the tombstone", async () => {
  const h = harness();
  const entered = deferred();
  const release = deferred();
  h.hooks["after:trackerToken.updateMany"] = async () => { entered.resolve(); await release.promise; };
  const pending = h.post();
  await bounded(entered.promise);
  eq((await h.revoke()).status, 204);
  release.resolve();
  eq((await pending).status, 401);
  eq(h.store.snapshot(A, D1), snapshot(false));
  withoutUsageWrites(h);
});

test("slow and backwards-clock auth decisions cannot create fresh liveness", async () => {
  for (const delta of [30_000, 30_001, -1]) {
    const h = harness();
    h.hooks["after:trackerToken.updateMany"] = () => { h.clock += delta; };
    eq((await h.post()).status, 401);
    eq(h.store.size.devices, 0);
    withoutUsageWrites(h);
  }
});

test("authentication read/write failures never yield a successful receipt", async () => {
  for (const key of ["before:trackerToken.findUnique", "before:trackerToken.updateMany"]) {
    const h = harness();
    h.hooks[key] = () => { throw new Error("fixture auth unavailable"); };
    eq((await h.post()).status, 500);
    eq(h.store.size.devices, 0);
    eq(h.events, []);
    withoutUsageWrites(h);
  }
});

test("notification failure does not reject accepted POST and is retried by the job", async () => {
  const h = harness();
  h.hooks.emit = () => { throw new Error("fixture fan-out unavailable"); };
  eq((await h.post()).body, receipt(true, BASE));
  eq(h.events, []);
  eq(h.store.size.pending, 1);
  await h.browser();
  eq(h.store.size.pending, 1);
  delete h.hooks.emit;
  await h.job.sweepSessions();
  eq(h.events.at(-1).presence.status, "idle");
  eq(h.store.size.pending, 0);
  h.clock += TTL;
  h.hooks.emit = () => { throw new Error("fixture expiry fan-out unavailable"); };
  await h.job.sweepSessions();
  eq(h.store.size.pending, 1);
  eq((await h.browser()).body.connected, false);
  delete h.hooks.emit;
  await h.job.sweepSessions();
  eq(h.events.at(-1).presence.status, "offline");
  eq(h.store.size.pending, 0);
  withoutUsageWrites(h);
});

test("concurrent disconnect supersedes a pending connection notification", async () => {
  const h = harness();
  const entered = deferred();
  const release = deferred();
  h.hooks["before:user.findUnique"] = async () => { entered.resolve(); await release.promise; };
  const post = h.post();
  await bounded(entered.promise);
  h.clock += 1000;
  eq((await h.stop()).body, receipt(false, BASE));
  release.resolve();
  eq((await post).body, receipt(true, BASE)); // Receipt is the earlier accepted operation, not a new timestamp.
  eq(h.store.snapshot(A, D1), snapshot(false, date(BASE)));
  eq(h.events.map((event) => event.presence.status), ["offline"]);
  eq(h.store.size.pending, 0);
  withoutUsageWrites(h);
});

test("transport expiry notifies even if the subsequent Session rollup query fails", async () => {
  const h = harness();
  await h.post();
  h.clock += TTL;
  h.hooks["before:session.findMany"] = () => { throw new Error("fixture rollup query unavailable"); };
  await rejects(() => h.job.sweepSessions(), /fixture rollup query unavailable/);
  eq(h.events.at(-1).presence.status, "offline");
  eq(h.store.size.pending, 0);
  withoutUsageWrites(h);
});

test("legitimate rollup credits only actual AI heartbeat elapsed, never connection time", async () => {
  const h = harness({ allowAiWrites: true });
  seedSession(h);
  h.clock += 120_001;
  await h.post();
  withoutUsageWrites(h);
  eq(await h.job.sweepSessions(), { idled: 1, ended: 0 });
  eq(h.tables.session[0].status, "IDLE");
  h.clock = BASE + 600_001;
  const before = h.writes.length;
  await h.post();
  withoutUsageWrites(h, before);
  eq(await h.job.sweepSessions(), { idled: 0, ended: 1 });
  eq(h.tables.session[0].lastHeartbeatAt, date(BASE));
  eq(h.tables.session[0].endedAt, date(BASE));
  eq(h.tables.dailyStat.length, 1);
  eq(h.tables.dailyStat[0].activeSeconds, 20);
  eq(h.tables.dailyStat[0].tokensInput + h.tables.dailyStat[0].tokensOutput, 40);
  eq(h.tables.userStreak.length, 1);
  eq(h.tables.activityEvent, []);
  eq(h.tables.githubCommitDay, []);
  eq((await h.browser()).body.presence, {
    status: "idle", activity: null, tools: [], lastSeenAt: date(BASE + 600_001).toISOString(),
  });
  const finished = clone(h.tables.dailyStat);
  await h.job.sweepSessions();
  eq(h.tables.dailyStat, finished);
});

test("real AI heartbeat and session_end keep their existing independent accounting", async () => {
  const h = harness({ allowAiWrites: true });
  const ai = (eventType, extra = {}) => h.request(h.tracker, "post", "/tracker/heartbeat", { raw: RAW_A,
    body: { eventType, projectAlias: "fixture-project", tool: "claude-code", model: "fixture-model",
      occurredAt: date(h.clock).toISOString(), tokensInputDelta: 3, tokensOutputDelta: 2, ...extra } });
  eq((await ai("session_start")).status, 200);
  eq(h.tables.session.length, 1);
  eq(h.store.size.devices, 0);
  h.clock += 10_000;
  eq((await ai("heartbeat")).status, 200);
  const before = h.writes.length;
  h.clock += 30_000;
  await h.post();
  await h.stop();
  withoutUsageWrites(h, before);
  eq(h.tables.session[0].lastHeartbeatAt, date(BASE + 10_000));
  eq((await ai("session_end", { occurredAt: date(BASE + 10_000).toISOString() })).status, 200);
  eq(h.tables.dailyStat[0].activeSeconds, 10);
  eq(h.tables.dailyStat[0].tokensInput + h.tables.dailyStat[0].tokensOutput, 10);
  eq(h.tables.activityEvent.length, 3);
  eq(h.tables.githubCommitDay, []);
});

test("account lastSeenAt is max(real AI heartbeat, accepted connection), never auth time", async () => {
  const h = harness();
  const row = seedSession(h, { lastHeartbeatAt: date(BASE - 5000) });
  eq((await h.menu()).body.tracker.lastSeenAt, date(BASE - 5000).toISOString());
  await h.post();
  h.clock += 5000;
  row.lastHeartbeatAt = date(h.clock);
  eq((await h.browser()).body.lastSeenAt, date(h.clock).toISOString());
  eq((await h.menu()).body.tracker.lastSeenAt, date(h.clock).toISOString());
  h.clock += 5000;
  await h.verify();
  eq((await h.menu()).body.tracker.lastSeenAt, date(BASE + 5000).toISOString());
  eq((await h.menu()).body.tracker.devices.find((d) => d.name === D1).lastSeenAt, date(BASE).toISOString());
  await h.post();
  eq((await h.browser()).body.lastSeenAt, date(h.clock).toISOString());
  withoutUsageWrites(h);
});

test("missing, invalid and future timestamps fail closed without a fake Date.now fallback", async () => {
  const h = harness();
  const bad = [undefined, null, "", date().toISOString(), BASE, NaN, new RealDate(NaN), date(BASE + 1), date(-1), {}];
  for (const value of bad) {
    eq(h.connection.trackerTimestamp(value), null);
    eq(h.connection.latestTrackerLastSeenAt(A, value), null);
  }
  eq(h.connection.trackerTimestamp(date(0)), 0);
  await h.post();
  for (const value of bad) eq(h.connection.latestTrackerLastSeenAt(A, value), date(BASE));
  const device = h.store.owners.get(A).devices.get(D1);
  for (const value of [undefined, null, NaN, Infinity, "not-a-time", BASE + 1]) {
    device.lastSeenAt = value; // Corrupt a fixture record, never a persisted row.
    eq(h.store.snapshot(A, D1), snapshot(false));
  }
  withoutUsageWrites(h);
});

test("invalid Session timestamps cannot manufacture active presence or AI details", async () => {
  const h = harness();
  const row = seedSession(h);
  const invalid = [undefined, null, "not-a-date", date(NaN), date(BASE + 1)];
  for (const value of invalid) {
    row.lastHeartbeatAt = value;
    eq(await h.presence(A, "fixture-alice"), {
      username: "fixture-alice", status: "offline", activity: null, tools: [], lastSeenAt: null,
    });
  }
  await h.post();
  row.lastHeartbeatAt = date(BASE);
  for (const value of invalid) {
    row.startedAt = value;
    eq(await h.presence(A, "fixture-alice"), {
      username: "fixture-alice", status: "idle", activity: null, tools: [], lastSeenAt: date(BASE).toISOString(),
    });
  }
  row.startedAt = date(BASE - 1000);
  row.lastHeartbeatAt = date(BASE - 2000);
  eq((await h.presence(A, "fixture-alice")).activity, null);
  withoutUsageWrites(h);
});

test("presenceFor().lastSeenAt is max(heartbeat incl. ENDED, receipt), null when neither exist, rejects future timestamps, and ignores verify", async () => {
  const h = harness();
  eq((await h.presence(A, "fixture-alice")).lastSeenAt, null);

  // An ENDED session's heartbeat still counts toward "last online", even though it
  // contributes no activity/status (that query has no status filter, unlike presence).
  const ended = seedSession(h, {
    status: "ENDED", startedAt: date(BASE - 70_000), lastHeartbeatAt: date(BASE - 60_000), endedAt: date(BASE - 50_000),
  });
  eq(await h.presence(A, "fixture-alice"), {
    username: "fixture-alice", status: "offline", activity: null, tools: [], lastSeenAt: date(BASE - 60_000).toISOString(),
  });

  // Receipt (BASE) outranks the older ended heartbeat (BASE-60000).
  await h.post();
  eq((await h.presence(A, "fixture-alice")).lastSeenAt, date(BASE).toISOString());

  // Advance the clock so a heartbeat between the receipt and "now" can outrank it.
  h.clock += 20_000;
  ended.lastHeartbeatAt = date(BASE + 10_000);
  eq((await h.presence(A, "fixture-alice")).lastSeenAt, date(BASE + 10_000).toISOString());

  // A fresher receipt outranks the heartbeat again.
  await h.post();
  eq((await h.presence(A, "fixture-alice")).lastSeenAt, date(h.clock).toISOString());

  // A future-dated heartbeat is rejected outright, never adopted as "last online".
  ended.lastHeartbeatAt = date(h.clock + 5000);
  eq((await h.presence(A, "fixture-alice")).lastSeenAt, date(h.clock).toISOString());
  ended.lastHeartbeatAt = date(BASE - 60_000);

  // /tracker/verify only bumps TrackerToken.lastUsedAt — never presence lastSeenAt.
  const before = (await h.presence(A, "fixture-alice")).lastSeenAt;
  await h.verify();
  eq((await h.presence(A, "fixture-alice")).lastSeenAt, before);

  withoutUsageWrites(h);
});

test("menu-bar serializer tolerates missing/invalid dates and ignores legacy verification metadata", async () => {
  const h = harness();
  const build = h.load("src/lib/tracker-me.ts").buildTrackerMePayload;
  for (const value of [undefined, null, date(NaN), "not-a-date"]) {
    const payload = build({ user: h.tables.user[0], level: 1,
      presence: { username: "fixture-alice", status: "offline", activity: null, tools: [], lastSeenAt: null },
      today: { tokens: 0, activeSeconds: 0, sessionStartedAt: value }, lastSeenAt: value,
      devices: [{ label: "fixture", lastSeenAt: value, lastUsedAt: date(BASE) }], friends: [] });
    eq(payload.tracker, { connected: false, lastSeenAt: null, devices: [{ name: "fixture", lastSeenAt: null }] });
    eq(payload.today.sessionStartedAt, null);
  }
});

test("opaque composite identities cannot collide or cross owner boundaries", async () => {
  const h = harness();
  const store = new h.connection.TrackerConnectionStore({ now: () => h.clock });
  store.receive("a:b", "c");
  store.receive("a", "b:c");
  store.receive(A, "same-device");
  h.clock += 1;
  store.receive(B, "same-device");
  store.retire(A, "same-device");
  eq(store.snapshot(A, "same-device"), snapshot(false, date(BASE)));
  eq(store.snapshot(B, "same-device"), snapshot(true, date(BASE + 1)));
  eq(store.snapshot("a:b", "c").connected, true);
  eq(store.snapshot("a", "b:c").connected, true);
  const before = store.size;
  for (const id of [undefined, null, 0, "", " ", "bad\nkey", "x".repeat(257)]) {
    throws(() => store.receive(id, D1), (err) => err.reason === "identity");
    throws(() => store.retire(A, id, true), (err) => err.reason === "identity");
  }
  eq(store.size, before);
});

test("invalid server clocks and backwards receipts fail closed without allocating", async () => {
  const h = harness();
  const Store = h.connection.TrackerConnectionStore;
  for (const now of [undefined, null, NaN, Infinity, -1, 0.1, 8_640_000_000_000_001]) {
    const store = new Store({ now: () => now });
    throws(() => store.receive(A, D1), (err) => err.reason === "clock");
    throws(() => store.retire(A, D1), (err) => err.reason === "clock");
    eq(store.snapshot(A, D1), snapshot(false));
    store.sweep();
    eq(store.size.devices, 0);
  }
  const store = new Store({ now: () => h.clock });
  store.receive(A, D1);
  h.clock -= 1;
  throws(() => store.receive(A, D1), (err) => err.reason === "clock");
  eq(store.snapshot(A, D1), snapshot(false));
  h.clock = BASE;
  eq(store.snapshot(A, D1), snapshot(true, date(BASE)));
});

test("cache caps at 32 devices per owner and 10000 globally without live eviction", async () => {
  const h = harness();
  eq(h.connection.MAX_TRACKER_CONNECTIONS, 10_000);
  eq(h.connection.MAX_TRACKER_CONNECTIONS_PER_USER, 32);
  const local = new h.connection.TrackerConnectionStore({ now: () => h.clock });
  for (let i = 0; i < 32; i++) local.receive(A, `d-${i}`);
  throws(() => local.receive(A, "overflow"), (err) => err.reason === "capacity");
  local.receive(B, D1);
  eq(local.size.devices, 33);
  const global = new h.connection.TrackerConnectionStore({ now: () => h.clock });
  for (let i = 0; i < 10_000; i++) global.receive(`owner-${i}`, D1);
  throws(() => global.receive("overflow", D1), (err) => err.reason === "capacity");
  h.clock += 30_000;
  eq(global.receive("owner-0", D1), snapshot(true, date(h.clock)));
  eq(global.size, { devices: 10_000, owners: 10_000, pending: 10_000 });
  eq(global.snapshot("owner-9999", D1).connected, true);
});

test("capacity errors are HTTP 503 and never claim an accepted connection", async () => {
  const h = harness();
  for (let i = 0; i < 32; i++) h.store.receive(A, `existing-${i}`);
  const result = await h.post();
  eq(result.status, 503);
  ok(!("connected" in result.body));
  eq(h.store.snapshot(A, D1), snapshot(false));
  eq(h.store.size.devices, 32);
  eq(h.events, []);
  withoutUsageWrites(h);
  for (const limit of [0, -1, NaN, Infinity, 1.1, 10_001]) {
    throws(() => new h.connection.TrackerConnectionStore({ maxDevices: limit }), (err) => err.reason === "capacity");
    throws(() => new h.connection.TrackerConnectionStore({ maxDevicesPerUser: limit }), (err) => err.reason === "capacity");
  }
});

test("receipts and revocation tombstones expire within bounded 24-hour retention", async () => {
  const h = harness();
  await h.post();
  h.clock += TTL;
  await h.job.sweepSessions();
  h.clock = BASE + RETENTION - 1;
  eq(h.store.snapshot(A, D1), snapshot(false, date(BASE)));
  h.clock += 1;
  eq(h.store.snapshot(A, D1), snapshot(false));
  eq((await h.stop()).body, receipt(false));
  await h.job.sweepSessions();
  eq(h.store.size, { devices: 0, owners: 0, pending: 0 });
  const store = new h.connection.TrackerConnectionStore({ now: () => h.clock });
  store.receive(A, D1);
  store.retire(A, D1, true);
  throws(() => store.receive(A, D1), (err) => err.reason === "revoked");
  h.clock += RETENTION;
  store.sweep();
  eq(store.snapshot(A, D1), snapshot(false));
  eq(store.size.devices, 0);
  for (const note of store.notifications()) store.acknowledge(note.userId, note.revision);
  eq(store.size.owners, 0);
  withoutUsageWrites(h);
});

test("failed fan-out owner queue is bounded even after receipt eviction and churn", async () => {
  const h = harness();
  const store = new h.connection.TrackerConnectionStore({ now: () => h.clock, maxDevices: 2 });
  store.receive(A, D1);
  store.receive(B, D1);
  h.clock += RETENTION;
  store.sweep();
  eq(store.size, { devices: 0, owners: 2, pending: 2 });
  throws(() => store.receive("third-owner", D1), (err) => err.reason === "capacity");
  store.acknowledge(A, store.notification(A));
  store.receive("third-owner", D1);
  eq(store.size, { devices: 1, owners: 2, pending: 2 });
  h.clock += RETENTION;
  store.sweep();
  eq(store.size.owners, 1);
  h.clock += RETENTION;
  store.sweep();
  eq(store.size, { devices: 0, owners: 0, pending: 0 });
});

test("saturated revocation fences new receipts without evicting another device", async () => {
  const h = harness();
  const store = new h.connection.TrackerConnectionStore({ now: () => h.clock, maxDevices: 1 });
  store.receive(A, D1);
  h.clock += RETENTION - 10_000;
  store.retire(B, DB, true); // No space for this in-flight credential's tombstone.
  eq(store.snapshot(A, D1).lastSeenAt, date(BASE));
  h.clock += 10_000;
  store.sweep();
  for (const note of store.notifications()) store.acknowledge(note.userId, note.revision);
  eq(store.size.devices, 0);
  throws(() => store.receive(B, DB), (err) => err.reason === "capacity");
  h.clock += 20_000;
  eq(store.receive("freshly-authenticated-owner", "fresh-device").connected, true);
});

test("stale notification acknowledgements cannot erase newer stop/reconnect state", async () => {
  const h = harness();
  h.store.receive(A, D1);
  const first = h.store.notification(A);
  h.store.retire(A, D1);
  h.store.acknowledge(A, first);
  ok(h.store.notification(A) !== null);
  const stopped = h.store.notification(A);
  h.store.receive(A, D1);
  h.store.acknowledge(A, stopped);
  ok(h.store.notification(A) !== null);
  h.store.acknowledge(A, h.store.notification(A));
  eq(h.store.notification(A), null);
});

test("new API VM loses transient liveness, preserves actual AI history and needs a fresh POST", async () => {
  const before = harness();
  await before.post();
  seedSession(before, { status: "ENDED", endedAt: date(BASE), lastHeartbeatAt: date(BASE - 1000) });
  const saved = clone(before.tables);
  const after = harness({ tables: saved });
  eq(after.store.size.devices, 0);
  eq((await after.browser()).body.connected, false);
  eq((await after.menu()).body.tracker.lastSeenAt, date(BASE - 1000).toISOString());
  eq(after.tables.session, saved.session);
  eq((await after.post()).body, receipt(true, BASE));
  eq((await after.browser()).body.presence, {
    status: "idle", activity: null, tools: [], lastSeenAt: date(BASE).toISOString(),
  });
  eq(after.tables.session, saved.session);
  withoutUsageWrites(before);
  withoutUsageWrites(after);
});

test("new API VM with verification bookkeeping only starts fully disconnected", async () => {
  const before = harness();
  await before.post();
  const after = harness({ tables: before.tables });
  await after.verify();
  eq((await after.menu()).body.tracker.lastSeenAt, null);
  eq((await after.browser()).body.lastSeenAt, null);
  eq((await after.browser()).body.connected, false);
  eq(after.store.size.devices, 0);
});

let existingTrackerMeChecks = 0;
test("existing pure menu-bar checks still pass with receipt-based device timestamps", async () => {
  const h = harness();
  h.load("src/lib/__checks__/trackerMe.check.ts");
  const summary = h.logs.map((line) => line.match(/(\d+) passed, (\d+) failed/)).find(Boolean);
  ok(summary, "Existing pure check summary must be observed, not assumed");
  eq(Number(summary[2]), 0);
  existingTrackerMeChecks = Number(summary[1]);
  ok(existingTrackerMeChecks > 0);
});

test("isolation negative controls reject startup, network, timers and every fake usage write", async () => {
  const h = harness();
  h.allowExpectedViolations = true;
  for (const name of ["src/index.ts", "@prisma/client", "node:http", "node:child_process", "unlisted-source.ts"]) {
    throws(() => h.load(name), /Fixture isolation blocked/);
  }
  throws(() => h.job.startSessionRollupJob(), /Fixture isolation blocked: job start/);
  for (const model of ["session", "dailyStat", "activityEvent", "userStreak", "githubCommitDay"]) {
    await rejects(() => h.prisma[model].create({ data: {} }), /Fixture isolation blocked: DB write/);
  }
  eq(h.tables.session, []);
  eq(h.tables.dailyStat, []);
  eq(h.tables.activityEvent, []);
  eq(h.tables.userStreak, []);
  eq(h.tables.githubCommitDay, []);
});

test("in-memory mutation controls catch verification-as-liveness and fabricated Session writes", async () => {
  const originalRoute = SOURCES.get("src/routes/tracker.ts");
  const badRoute = originalRoute.replace("const user = await prisma.user.findUniqueOrThrow({",
    "trackerConnections.receive(req.trackerUserId!, req.trackerTokenId!);\n    const user = await prisma.user.findUniqueOrThrow({");
  ok(badRoute !== originalRoute);
  const verifyBug = harness({ overrides: new Map([["src/routes/tracker.ts", badRoute]]) });
  eq((await verifyBug.verify()).status, 200);
  throws(() => assert.equal(verifyBug.store.forUser(A).connected, false), (err) => err.code === "ERR_ASSERTION");
  const originalService = SOURCES.get("src/services/trackerConnection.ts");
  const badService = originalService.replace("const receipt = { connected: true as const",
    "await prisma.session.create({ data: {} });\n  const receipt = { connected: true as const");
  ok(badService !== originalService);
  const writeBug = harness({ overrides: new Map([["src/services/trackerConnection.ts", badService]]) });
  writeBug.allowExpectedViolations = true;
  eq((await writeBug.post()).status, 500);
  eq(writeBug.violations, ["DB write session.create"]);
  eq(writeBug.tables.session, []);
});

test("authenticated owner binding cannot borrow another account's device, AI Session or totals", async () => {
  const h = harness();
  seedSession(h, { userId: B });
  const before = clone(h.tables.session);
  const result = await h.post(RAW_A, {}, { forged: { trackerUserId: B, trackerTokenId: DB }, query: { userId: B, deviceId: DB } });
  eq(result.body, receipt(true, BASE));
  eq(h.store.snapshot(A, D1).connected, true);
  eq(h.store.snapshot(B, DB), snapshot(false));
  eq((await h.browser()).body.presence, {
    status: "idle", activity: null, tools: [], lastSeenAt: date(BASE).toISOString(),
  });
  eq((await h.menu()).body.today.tokens, 0);
  eq((await h.menu()).body.today.activeSeconds, 0);
  eq((await h.browser("cookie-b")).body.presence.status, "active");
  eq((await h.menu(RAW_B)).body.today.tokens, 40);
  eq(h.tables.session, before);
  withoutUsageWrites(h);
});

test("v2 usage deltas remain independent and are not counted twice at Session close", async () => {
  const h = harness({ allowAiWrites: true });
  const ai = (eventType, usage) => h.request(h.tracker, "post", "/tracker/heartbeat", { raw: RAW_A,
    body: { eventType, projectAlias: "fixture-project", tool: "claude-code", model: "fixture-model",
      occurredAt: date(h.clock).toISOString(), tokensInputDelta: 999, tokensOutputDelta: 999, usage } });
  const usage = [{ tool: "claude-code", model: "fixture-model", tokensInputDelta: 2, tokensOutputDelta: 3 }];
  eq((await ai("session_start", usage)).status, 200);
  eq(h.tables.session[0].tokensInput + h.tables.session[0].tokensOutput, 0);
  eq(h.tables.dailyStat[0].tokensInput + h.tables.dailyStat[0].tokensOutput, 5);
  h.clock += 10_000;
  eq((await ai("heartbeat", [])).status, 200);
  const before = h.writes.length;
  await h.post();
  await h.stop();
  withoutUsageWrites(h, before);
  eq((await ai("session_end")).status, 200);
  eq(h.tables.dailyStat[0].activeSeconds, 10);
  eq(h.tables.dailyStat[0].tokensInput + h.tables.dailyStat[0].tokensOutput, 5);
  eq(h.tables.userStreak.length, 1);
  eq(h.tables.githubCommitDay, []);
});

// Deliberately no server build/type-program/import resolution: a normal build
// reaches generated Prisma types and is NOT permitted in this lane.
for (const name of EXECUTABLE) compile(name);
const outcomes = [];
for (const entry of cases) {
  activeHarnesses = [];
  try {
    await bounded(entry.run());
    for (const h of activeHarnesses) if (!h.allowExpectedViolations) eq(h.violations, [], `${entry.name}: isolation`);
    outcomes.push({ name: entry.name, passed: true });
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    outcomes.push({ name: entry.name, passed: false });
    console.error(`FAIL ${entry.name}\n${error.stack ?? error}`);
  }
}
// Read only those same approved strings again: a parallel source edit invalidates
// this result rather than silently claiming to test a different working tree.
for (const [name, source] of SOURCES) eq(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"), source, `${name} changed during fixtures`);
eq(compilerIo, [], "Transpiler must never touch compiler filesystem APIs");
const failed = outcomes.filter((item) => !item.passed).length;
console.log("CONNECTION_TEST_RESULT " + JSON.stringify({
  cases: outcomes.length, passed: outcomes.length - failed, failed, assertions, existingTrackerMeChecks,
  transpiledSources: EXECUTABLE.size, compilerFilesystemCalls: compilerIo.length,
  sourceSha256: Object.fromEntries([...SOURCES].map(([name, source]) => [name, createHash("sha256").update(source).digest("hex")])),
}));
process.exitCode = failed ? 1 : 0;
