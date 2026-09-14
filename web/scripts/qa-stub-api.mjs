#!/usr/bin/env node
// QA stub for the VibeHub API — enough of it to render Home, Settings and the connect
// sheet against made-up data, with `staleTracker` under direct control.
//
// Why this exists: the round-10 "old token" hint is driven by a field that only appears
// when a *revoked* token is actively heartbeating. Reproducing that for real means a live
// daemon and a revoked token, which is exactly what QA is not allowed to touch. So the
// field is stubbed at the API boundary instead: the response shape is the contract, and
// everything downstream (mapper → hook → component) is the real code.
//
//   node scripts/qa-stub-api.mjs [--port 4399]
//   GET /__qa/scenario?name=offline-stale|connected-stale|offline-null|offline-omitted
//                            [&rejectedAt=<iso>|+30s|-2h]
//   GET /__qa/state
//
// Nothing here talks to a real server, a real database or a real tracker. The account is
// a fiction named vh-qa-stub.

import { createServer } from "node:http";

const port = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 4399);

const USER = {
  id: "vh-qa-stub-id",
  username: "vh-qa-stub",
  displayName: "QA Stub",
  email: null,
  avatarUrl: null,
  bio: null,
  githubUsername: null,
  archetype: "CODER",
  roles: ["developer"],
  onboardedAt: "2026-09-01T00:00:00.000Z",
};

/** Offsets like "+30s" / "-2h" are relative to *now*, resolved per request so the sheet's
 *  freshness comparison sees a timestamp that is genuinely newer or older than its
 *  waiting moment rather than one frozen when the scenario was selected. */
function resolveAt(spec) {
  const m = /^([+-])(\d+)([smh])$/.exec(spec ?? "");
  if (!m) return spec ?? new Date().toISOString();
  const mult = { s: 1000, m: 60_000, h: 3_600_000 }[m[3]];
  const delta = Number(m[2]) * mult * (m[1] === "-" ? -1 : 1);
  return new Date(Date.now() + delta).toISOString();
}

const SCENARIOS = {
  "offline-stale": { connected: false, stale: "+0s" },
  "connected-stale": { connected: true, stale: "+0s" },
  "offline-null": { connected: false, stale: null },
  "offline-omitted": { connected: false, stale: "omit" },
};

let scenario = "offline-stale";
let rejectedAt = "+0s";

/**
 * Fixed at boot, NOT recomputed per request. This matters: the sheet decides "a ping
 * arrived" by comparing `lastSeenAt` against the baseline it took on its first fetch, so
 * a `lastSeenAt` of `Date.now() - 2h` evaluated per request creeps forward every poll and
 * the sheet reads it as a fresh heartbeat — it jumped straight to "First ping" with no
 * tracker anywhere. A real offline account has a `lastSeenAt` that does not move.
 * `staleTracker.lastRejectedAt` is the one timestamp that is deliberately live.
 */
const BOOT = Date.now();
const AGO_2H = new Date(BOOT - 2 * 3_600_000).toISOString();
const AGO_3H = new Date(BOOT - 3 * 3_600_000).toISOString();
const SESSION_START = new Date(BOOT - 12 * 60_000).toISOString();

function trackerStatus() {
  const s = SCENARIOS[scenario];
  const connected = s.connected;
  const body = {
    connected,
    lastSeenAt: connected ? new Date().toISOString() : AGO_2H,
    activeTokens: 1,
    tools: connected ? ["claude-code"] : [],
    tokenLastUsedAt: AGO_2H,
    heartbeatIntervalMs: 30_000,
    presence: connected
      ? {
          status: "active",
          activity: {
            projectAlias: "vibehub",
            tool: "claude-code",
            model: "claude-opus-5",
            startedAt: SESSION_START,
          },
          tools: [],
        }
      : { status: "offline", activity: null, tools: [] },
    sources: [
      {
        tool: "claude-code",
        model: "claude-opus-5",
        lastSeenAt: AGO_2H,
        tokensToday: 1634,
        tokens7d: 24000,
        activeSecondsToday: 2040,
      },
    ],
    devices: [
      { id: "dev-1", label: "Windows", lastUsedAt: AGO_2H, createdAt: "2026-09-04T00:00:00.000Z" },
    ],
  };

  // Three distinct cases, and the difference between the last two is the point: an older
  // server omits the key entirely, which must behave exactly like an explicit null.
  if (s.stale === "omit") return body;
  if (s.stale === null) return { ...body, staleTracker: null };
  return {
    ...body,
    staleTracker: { lastRejectedAt: resolveAt(rejectedAt), label: "Windows", revokedAt: AGO_3H },
  };
}

const ROUTES = {
  "/api/v1/auth/me": () => ({ user: USER }),
  "/api/v1/users/me": () => ({ user: USER }),
  "/api/v1/users/me/tracker": trackerStatus,
  "/api/v1/users/me/tracker-tokens": () => ({ tokens: [{ id: "tok-1", label: "Windows", lastUsedAt: null, createdAt: "2026-09-04T00:00:00.000Z" }] }),
  "/api/v1/users/me/links": () => ({ links: [] }),
  "/api/v1/users/me/github/repos": () => ({ repos: [] }),
  "/api/v1/friends": () => ({ friends: [] }),
  "/api/v1/friends/requests": () => ({ incoming: [], outgoing: [] }),
  "/api/v1/presence/friends": () => ({ presences: [] }),
  "/api/v1/projects": () => ({ projects: [] }),
  "/api/v1/health": () => ({ ok: true }),
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (code, body) => {
    res.writeHead(code, {
      "content-type": "application/json",
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") return send(204, {});

  if (url.pathname === "/__qa/scenario") {
    const name = url.searchParams.get("name");
    if (name && !SCENARIOS[name]) return send(400, { error: `unknown scenario ${name}` });
    if (name) scenario = name;
    if (url.searchParams.has("rejectedAt")) rejectedAt = url.searchParams.get("rejectedAt");
    return send(200, { scenario, rejectedAt, preview: trackerStatus().staleTracker ?? null });
  }
  if (url.pathname === "/__qa/state") return send(200, { scenario, rejectedAt });

  // Minting a device token: the sheet does this on open.
  if (req.method === "POST" && url.pathname === "/api/v1/users/me/tracker-tokens") {
    return send(201, { token: "vbh_qa_stub_token", tokenRow: { id: "tok-2", label: "Windows", lastUsedAt: null, createdAt: new Date().toISOString() } });
  }

  const route = ROUTES[url.pathname];
  if (route) return send(200, route());

  // GET /users/:username — the profile payload Settings' links section reads. Its
  // `links` array is destructured without a guard, so an empty object here crashes the
  // page; that is a stub bug and it cost a round of confusion, hence the log below.
  const profile = /^\/api\/v1\/users\/([^/]+)$/.exec(url.pathname);
  if (profile) {
    return send(200, {
      user: USER,
      links: [],
      archetype: USER.archetype,
      friendCount: 0,
      level: 7,
      levelBreakdown: { level: 7, xp: 1200, activeHours: 34, totalTokens: 24000, projects: 0, friends: 0, commits: 0 },
    });
  }

  // Anything unlisted answers empty rather than 404 — an unexpected 404 becomes an error
  // state that would be mistaken for a finding — but it is logged, because "the UI broke
  // because the stub was thin" must never be reported as "the UI is broken".
  console.log(`[qa-stub] UNSTUBBED ${req.method} ${url.pathname} -> {}`);
  send(200, {});
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[qa-stub] http://127.0.0.1:${port}  scenario=${scenario}`);
  console.log(`[qa-stub] scenarios: ${Object.keys(SCENARIOS).join(", ")}`);
});
