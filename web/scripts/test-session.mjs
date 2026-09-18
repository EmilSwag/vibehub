#!/usr/bin/env node
// Synthetic session/connect regressions. No server, browser, tracker, real storage,
// credentials or network. Bundle named client modules in memory with fake origins.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const API = 'https://session-fixture.invalid';
const original = new Map(['window', 'fetch', 'WebSocket', 'setTimeout', 'clearTimeout'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
const install = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}
let local = new MemoryStorage();
let session = new MemoryStorage();
let fixtureWindow = { localStorage: local, sessionStorage: session };
install('window', fixtureWindow);
let calls = [];
let respond = () => { throw new Error('Unexpected synthetic request'); };
install('fetch', async (input, init = {}) => {
  const url = new URL(String(input));
  assert.equal(url.origin, API, 'Only the synthetic origin is accepted; no request is forwarded');
  calls.push({ path: url.pathname, init });
  return respond(url.pathname, init);
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let passed = 0;
let failed = 0;
let assertions = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const rejects = async (promise, expected) => { await assert.rejects(promise, expected); assertions++; };
const test = async (name, run) => {
  try { await run(); passed++; console.log(`ok   ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error?.message ?? error}`); }
};
const sockets = [];
class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  sent = [];
  constructor(url) { super(); assert.equal(url, 'wss://session-fixture.invalid'); sockets.push(this); }
  send(value) { this.sent.push(value); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  frame(value) { const e = new Event('message'); Object.defineProperty(e, 'data', { value: JSON.stringify(value) }); this.dispatchEvent(e); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
install('WebSocket', FakeSocket);
let clock = 0;
let nextTimer = 0;
const timers = new Map();
const fakeTimers = () => {
  clock = 0;
  timers.clear();
  install('setTimeout', (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { at: clock + Number(delay), callback }); return id; });
  install('clearTimeout', id => timers.delete(id));
};
const advance = async ms => {
  const end = clock + ms;
  let runs = 0;
  for (;;) {
    const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    if (++runs > 100) throw new Error('Unexpected timer loop');
    clock = due[1].at;
    timers.delete(due[0]);
    due[1].callback();
    await flush();
  }
  clock = end;
  await flush();
};

try {
  const compiled = await build({
    stdin: { contents: 'export * as auth from "./src/lib/authSession"; export { authApi, usersApi, ApiError } from "./src/lib/api"; export * as connect from "./src/lib/connectToken"; export { VibeHubSocket } from "./src/lib/ws";', resolveDir: root, sourcefile: 'synthetic-session-entry.ts', loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_WS_URL': JSON.stringify('wss://session-fixture.invalid') },
  });
  const { auth, authApi, usersApi, connect, VibeHubSocket } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const fresh = () => { calls = []; return auth.beginAuthenticatedSession(); };
  // A representative sessionAuth-guarded call. `authApi.me()` is deliberately NOT
  // guarded (its 401 / `{ user: null }` is the normal guest answer), so the guarded
  // contract is exercised through a profile read instead.
  const guarded = () => usersApi.get('fixture-user');

  await test('new login retires old work and clears only private cached instructions', async () => {
    local.setItem('vh-connect-token:old', 'synthetic-old-key'); local.setItem('theme', 'dark');
    session.setItem('vh.onboarding.step:old', '3'); session.setItem('vh-connect-celebrated:old', '1');
    const old = auth.authGeneration(); const current = fresh();
    eq(auth.isCurrentAuth(old), false); eq(auth.isCurrentAuth(current), true);
    eq(local.getItem('vh-connect-token:old'), null); eq(local.getItem('theme'), 'dark');
    eq(session.getItem('vh.onboarding.step:old'), null); eq(session.getItem('vh-connect-celebrated:old'), '1');
  });
  await test('concurrent expiry deduplicates and stale expiry cannot log out a new session', async () => {
    const before = fresh(); eq(auth.expireAuthSession(before), true); const expired = auth.authGeneration();
    eq(auth.expireAuthSession(before), false); eq(auth.authGeneration(), expired);
    assert.throws(() => auth.assertAuthGeneration(expired), auth.AuthSessionChangedError); assertions++;
    const current = fresh(); eq(auth.expireAuthSession(before), false); eq(auth.isCurrentAuth(current), true);
  });
  await test('storage access denial does not block session boundaries', async () => {
    const denied = {}; for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(denied, key, { get() { throw new Error('denied'); } });
    install('window', denied); const current = fresh(); eq(auth.isCurrentAuth(current), true); eq(auth.expireAuthSession(current), true);
    install('window', fixtureWindow);
  });
  await test('cookie writes serialize login -> logout -> new login', async () => {
    const enqueue = auth.createAuthQueue(); const gate = deferred(); let cookie = null; const order = [];
    const first = enqueue(async () => { order.push('first-start'); await gate.promise; cookie = 'first'; order.push('first-end'); });
    const logout = enqueue(async () => { cookie = null; order.push('logout'); });
    const second = enqueue(async () => { cookie = 'second'; order.push('second'); });
    await flush(); eq(order, ['first-start']); gate.resolve(); await Promise.all([first, logout, second]);
    eq(order, ['first-start', 'first-end', 'logout', 'second']); eq(cookie, 'second');
  });
  await test('failed cookie write does not prevent later logout or login', async () => {
    const enqueue = auth.createAuthQueue(); const first = enqueue(async () => { throw new Error('fixture failure'); });
    const second = enqueue(async () => 'recovered'); await rejects(first, /fixture failure/); eq(await second, 'recovered');
  });
  await test('provider wires both cookie-changing paths to the same queue', async () => {
    const source = readFileSync(join(root, 'src/context/AuthContext.tsx'), 'utf8');
    eq(source.includes('useMemo(createAuthQueue, [])'), true);
    eq(source.includes('const run = enqueueAuth(async () =>'), true);
    eq(source.includes('enqueueAuth(() => authApi.logout())'), true);
    eq(source.includes('if (generation !== authGeneration()) return;'), true);
  });
  await test('HTTP401 expires the session even with an HTML body', async () => {
    const current = fresh(); respond = () => new Response('<html>no</html>', { status: 401 });
    await rejects(guarded(), e => e.status === 401); eq(auth.isCurrentAuth(current), false);
  });
  await test('expired protected calls are rejected before any request is sent', async () => {
    calls = []; await rejects(guarded(), auth.AuthSessionChangedError); eq(calls.length, 0);
  });
  await test('guest /auth/me answers (401 or user:null) never expire the session', async () => {
    const current = fresh(); respond = () => new Response('', { status: 401 });
    await rejects(authApi.me(), e => e.status === 401); eq(auth.isCurrentAuth(current), true);
    respond = () => json({ user: null }); eq(await authApi.me(), { user: null }); eq(auth.isCurrentAuth(current), true);
    // The provider only treats `user: null` as expiry when someone *was* signed in.
    const source = readFileSync(join(root, 'src/context/AuthContext.tsx'), 'utf8');
    eq(source.includes('else if (userRef.current) expireAuthSession(generation);'), true);
  });
  await test('network, HTTP403/500 and malformed JSON do not prove sign-out', async () => {
    for (const response of [() => { throw new TypeError('fixture network failure'); }, () => json({ error: 'denied' }, 403), () => json({ error: 'retry' }, 500), () => new Response('{', { headers: { 'content-type': 'application/json' } })]) {
      const current = fresh(); respond = response; await rejects(guarded(), Error); eq(auth.isCurrentAuth(current), true);
    }
  });
  await test('old HTTP401 cannot expire a newly authenticated session', async () => {
    fresh(); const gate = deferred(); respond = () => gate.promise; const old = guarded();
    const current = fresh(); gate.resolve(new Response('', { status: 401 }));
    await rejects(old, auth.AuthSessionChangedError); eq(auth.isCurrentAuth(current), true);
  });
  await test('old JSON completion cannot populate the new account', async () => {
    fresh(); const body = deferred(); respond = () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => body.promise });
    const old = guarded(); await flush(); const current = fresh(); body.resolve({ user: { id: 'old-fixture' } });
    await rejects(old, auth.AuthSessionChangedError); eq(auth.isCurrentAuth(current), true);
  });
  await test('rejected OAuth ticket does not expire a valid cookie session', async () => {
    const current = fresh(); respond = () => json({ error: 'ticket rejected' }, 401);
    await rejects(authApi.claim('fixture-ticket'), e => e.status === 401); eq(auth.isCurrentAuth(current), true);
    eq(calls[0].init.signal instanceof AbortSignal, true);
  });
  await test('login and logout are bounded and remain possible after expiry', async () => {
    const current = fresh(); auth.expireAuthSession(current); respond = () => json({ user: { id: 'fixture-user' } });
    await authApi.devLogin('fixture-user'); eq(calls.at(-1).init.signal instanceof AbortSignal, true);
    eq(calls.at(-1).init.headers['Content-Type'], 'application/json');
    respond = () => new Response(null, { status: 204 }); await authApi.logout(); eq(calls.at(-1).init.signal instanceof AbortSignal, true);
  });
  await test('same-session setup deduplicates and late old key cannot overwrite the new key', async () => {
    fresh(); const oldReply = deferred(); const newReply = deferred(); let minted = 0;
    respond = () => (++minted === 1 ? oldReply.promise : newReply.promise);
    const old = connect.ensureConnectToken('fixture-owner', 'Fixture'); const caught = old.catch(e => e);
    eq(connect.ensureConnectToken('fixture-owner', 'Fixture'), old);
    fresh(); const next = connect.ensureConnectToken('fixture-owner', 'Fixture');
    oldReply.resolve(json({ tokenId: 'old-id', token: 'old-fixture-key' }));
    eq((await caught) instanceof auth.AuthSessionChangedError, true);
    eq(connect.ensureConnectToken('fixture-owner', 'Fixture'), next); eq(minted, 2);
    newReply.resolve(json({ tokenId: 'new-id', token: 'new-fixture-key' })); await next;
    eq(connect.readStoredConnectToken('fixture-owner').tokenId, 'new-id');
  });
  await test('offline token verification reuses an existing key but 401 does not', async () => {
    fresh(); const entry = { tokenId: 'fixture-stored-id', token: 'fixture-stored-key', createdAt: '2026-01-01T00:00:00Z' };
    connect.writeStoredConnectToken('fixture-stored-owner', entry); respond = () => json({ error: 'retry' }, 500);
    eq(await connect.ensureConnectToken('fixture-stored-owner', 'Fixture'), entry);
    await flush(); respond = () => new Response('', { status: 401 });
    await rejects(connect.ensureConnectToken('fixture-stored-owner', 'Fixture'), e => e.status === 401);
    eq(connect.readStoredConnectToken('fixture-stored-owner'), null);
  });
  await test('celebration is shared once across surfaces even if browser storage is denied', async () => {
    const denied = {}; for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(denied, key, { get() { throw new Error('denied'); } });
    install('window', denied);
    try { eq(connect.claimConnectCelebration('fixture-private-user'), true); eq(connect.claimConnectCelebration('fixture-private-user'), false); eq(connect.claimConnectCelebration('fixture-another-user'), true); }
    finally { install('window', fixtureWindow); }
  });
  await test('socket ignores late messages and does not reconnect after session expiry', async () => {
    const current = fresh(); fakeTimers(); const client = new VibeHubSocket('fixture-user'); const received = [];
    client.on(e => received.push(e)); client.connect(); const transport = sockets.at(-1); client.subscribe(['presence']); transport.open();
    transport.frame({ type: 'presence:update', username: 'fixture-user', status: 'active' }); eq(received.length, 1);
    auth.expireAuthSession(current); transport.frame({ type: 'presence:update', username: 'old', status: 'active' });
    eq(received.length, 1); eq(timers.size, 0); eq(transport.readyState, 3); client.close();
  });
  await test('socket retries inconclusive failure but stops on HTTP401', async () => {
    const current = fresh(); fakeTimers(); const client = new VibeHubSocket('fixture-user'); client.connect(); sockets.at(-1).close();
    respond = () => json({ error: 'retry' }, 500); await advance(1000); eq(auth.isCurrentAuth(current), true); eq(timers.size > 0, true);
    respond = () => new Response('', { status: 401 }); await advance(2000); eq(auth.isCurrentAuth(current), false); eq(timers.size, 0); client.close();
  });
  await test('socket verifies the account before reconnecting', async () => {
    const current = fresh(); fakeTimers(); const client = new VibeHubSocket('fixture-user'); client.connect(); sockets.at(-1).close();
    respond = () => json({ user: { id: 'different-fixture-user' } }); await advance(1000);
    eq(auth.isCurrentAuth(current), false); eq(timers.size, 0); client.close();
  });
  await test('socket resumes only for the same authenticated account', async () => {
    fresh(); fakeTimers(); const client = new VibeHubSocket('fixture-user'); client.connect(); const count = sockets.length; sockets.at(-1).close();
    respond = () => json({ user: { id: 'fixture-user' } }); await advance(1000); eq(sockets.length, count + 1); client.close(); eq(timers.size, 0);
  });
  await test('closing a socket retires a late successful authentication probe', async () => {
    fresh(); fakeTimers(); const reply = deferred(); const client = new VibeHubSocket('fixture-user'); client.connect(); const count = sockets.length; sockets.at(-1).close();
    respond = () => reply.promise; await advance(1000); client.close(); reply.resolve(json({ user: { id: 'fixture-user' } })); await flush();
    eq(sockets.length, count); eq(timers.size, 0);
  });
} finally {
  for (const socket of sockets) socket.close();
  timers.clear();
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
console.log(`\nSession/connect: ${passed} cases passed, ${failed} failed; ${assertions} assertions.`);
console.log('Synthetic in-memory requests/storage/sockets only. No real tracker or external network.');
process.exitCode = failed ? 1 : 0;
