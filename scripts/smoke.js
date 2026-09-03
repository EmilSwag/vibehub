// End-to-end API smoke test against a running server (default http://localhost:4000).
// Exercises the full ARCHITECTURE.md §5 surface with the seeded dev accounts:
// dev-login → profile → friends → wall → projects/likes → stats → presence →
// tracker token → heartbeat → presence reflects it. Exits non-zero on the first failure.
//
//   node scripts/smoke.js [apiUrl]

const API = (process.argv[2] ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const V1 = `${API}/api/v1`;

const jars = new Map(); // username -> cookie string
let failures = 0;

async function call(method, path, { as, body, token, expect = 200, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (as && jars.has(as)) headers.cookie = jars.get(as);
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${V1}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get("set-cookie");
  if (as && setCookie) jars.set(as, setCookie.split(";")[0]);

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  const ok = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
  const tag = ok ? "ok  " : "FAIL";
  if (!ok) failures += 1;
  console.log(`${tag} ${method.padEnd(6)} ${path}  -> ${res.status}${ok ? "" : `  (expected ${expect}) ${text.slice(0, 200)}`}`);
  return raw ? res : data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function check(label, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "ok  " : "FAIL"} check  ${label}${condition ? "" : `  ${detail}`}`);
}

async function main() {
  console.log(`smoke → ${API}\n`);

  const health = await call("GET", "/health");
  check("health.ok", health?.ok === true);

  // --- auth -------------------------------------------------------------------------
  await call("POST", "/auth/dev-login", { as: "ada", body: { username: "ada" } });
  await call("POST", "/auth/dev-login", { as: "linus", body: { username: "linus" } });
  await call("POST", "/auth/dev-login", { as: "smoke", body: { username: "smoke-" + Date.now().toString(36).slice(-6) } });
  const me = await call("GET", "/auth/me", { as: "ada" });
  check("auth/me returns ada", me?.user?.username === "ada", JSON.stringify(me));
  const anon = await call("GET", "/auth/me");
  check("auth/me anonymous → user null", anon?.user === null);

  // --- profile ----------------------------------------------------------------------
  const profile = await call("GET", "/users/ada", { as: "linus" });
  check("profile has links + friendCount", Array.isArray(profile?.links) && typeof profile?.friendCount === "number");
  await call("PATCH", "/users/me", { as: "ada", body: { bio: "smoke-tested bio" } });
  const links = await call("PUT", "/users/me/links", {
    as: "ada",
    body: { links: [{ url: "https://github.com/ada" }, { url: "https://x.com/ada", label: "X" }, { url: "https://ada.dev" }] },
  });
  check("links icons detected", links?.links?.[0]?.icon === "github" && links?.links?.[2]?.icon === "generic", JSON.stringify(links));
  await call("GET", "/users/does-not-exist", { expect: 404 });

  // --- friends ----------------------------------------------------------------------
  const smokeUser = (await call("GET", "/auth/me", { as: "smoke" }))?.user?.username;
  const friends = await call("GET", "/friends", { as: "ada" });
  check("ada has seeded friends", (friends?.friends?.length ?? 0) >= 2 && typeof friends.friends[0].daysAsFriends === "number");
  await call("POST", "/friends/requests", { as: "smoke", body: { targetUsername: "ada" }, expect: 201 });
  await call("POST", "/friends/requests", { as: "smoke", body: { targetUsername: "ada" }, expect: 409 });
  await call("POST", "/friends/requests", { as: "smoke", body: { targetUsername: smokeUser }, expect: 400 });
  const reqs = await call("GET", "/friends/requests", { as: "ada" });
  const incoming = reqs?.incoming?.find((r) => r.sender?.username === smokeUser);
  check("ada sees incoming request with sender populated", Boolean(incoming));
  await call("POST", `/friends/requests/${incoming?.id}/accept`, { as: "ada" });
  const smokeFriends = await call("GET", "/friends", { as: "smoke" });
  check("smoke now friends with ada", smokeFriends?.friends?.some((f) => f.user.username === "ada"));

  // --- wall -------------------------------------------------------------------------
  const wall = await call("GET", "/users/ada/wall?limit=2");
  check("wall paginates (nextCursor present)", Array.isArray(wall?.comments) && "nextCursor" in wall);
  const posted = await call("POST", "/users/ada/wall", { as: "smoke", body: { body: "hello from smoke" }, expect: 201 });
  await call("POST", "/users/linus/wall", { as: "smoke", body: { body: "not friends" }, expect: 403 });
  await call("DELETE", `/wall/${posted?.comment?.id}`, { as: "linus", expect: 403 });
  await call("DELETE", `/wall/${posted?.comment?.id}`, { as: "ada", expect: 204 });

  // --- projects ---------------------------------------------------------------------
  const project = await call("POST", "/projects", {
    as: "smoke",
    body: { name: "Smoke Project", description: "created by smoke test", repoUrl: "https://github.com/x/y" },
    expect: 201,
  });
  check("project slug generated", project?.project?.slug === "smoke-project", JSON.stringify(project));
  const liked = await call("POST", `/projects/${project?.project?.id}/like`, { as: "ada" });
  check("like increments", liked?.likeCount === 1, JSON.stringify(liked));
  const likedAgain = await call("POST", `/projects/${project?.project?.id}/like`, { as: "ada" });
  check("like is idempotent", likedAgain?.likeCount === 1);
  const list = await call("GET", `/users/${smokeUser}/projects`, { as: "ada" });
  check("likedIds reflects viewer", list?.likedIds?.includes(project?.project?.id));
  const unliked = await call("DELETE", `/projects/${project?.project?.id}/like`, { as: "ada" });
  check("unlike decrements", unliked?.likeCount === 0);
  await call("PATCH", `/projects/${project?.project?.id}`, { as: "ada", body: { name: "hijack" }, expect: 404 });
  await call("DELETE", `/projects/${project?.project?.id}`, { as: "smoke", expect: 204 });

  // --- stats ------------------------------------------------------------------------
  const stats = await call("GET", "/users/ada/stats?range=30d");
  check("stats has byModel + topModel + streak", Array.isArray(stats?.byModel) && stats?.topModel && stats?.streak);
  check("stats totals > 0 from seed", stats?.totalTokens > 0 && stats?.totalActiveSeconds > 0);
  const compare = await call("GET", "/users/ada/stats/compare?with=linus&range=14d");
  check("compare returns a + b", compare?.a?.byModel && compare?.b?.byModel);

  // --- presence + tracker -----------------------------------------------------------
  const presence0 = await call("GET", "/presence/friends", { as: "ada" });
  // The seed leaves linus "coding right now", but the sweeper degrades that to idle/offline
  // with time — only assert the friend shows up with a valid status.
  const linusPresence = presence0?.presences?.find((p) => p.username === "linus");
  check("presence lists linus with a status", ["active", "idle", "offline"].includes(linusPresence?.status), JSON.stringify(linusPresence));

  const tokenRes = await call("POST", "/users/me/tracker-tokens", { as: "smoke", body: { label: "smoke laptop" }, expect: [200, 201] });
  check("tracker token issued", typeof tokenRes?.token === "string" && tokenRes.token.length > 20);
  const hb = await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: {
      eventType: "heartbeat",
      projectAlias: "smoke-proj",
      tool: "claude-code",
      model: "claude-sonnet-4.5",
      tokensInputDelta: 120,
      tokensOutputDelta: 480,
      occurredAt: new Date().toISOString(),
    },
  });
  check("heartbeat opens ACTIVE session", hb?.status === "ACTIVE" && hb?.sessionId, JSON.stringify(hb));
  await call("POST", "/tracker/heartbeat", { token: "bogus", body: { eventType: "heartbeat", projectAlias: "x", occurredAt: new Date().toISOString() }, expect: 401 });
  await call("POST", "/tracker/heartbeat", { token: tokenRes?.token, body: { eventType: "nope" }, expect: 400 });

  const presence1 = await call("GET", "/presence/friends", { as: "ada" });
  const smokePresence = presence1?.presences?.find((p) => p.username === smokeUser);
  check("ada sees smoke active in smoke-proj", smokePresence?.status === "active" && smokePresence?.activity?.projectAlias === "smoke-proj", JSON.stringify(smokePresence));

  const liveStats = await call("GET", `/users/${smokeUser}/stats`);
  check("open session counted in stats", liveStats?.totalTokens === 600, JSON.stringify(liveStats?.byModel));

  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "git_commit", projectAlias: "smoke-proj", repoAlias: "smoke-proj", occurredAt: new Date().toISOString() },
  });
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "session_end", projectAlias: "smoke-proj", tool: "claude-code", model: "claude-sonnet-4.5", occurredAt: new Date().toISOString() },
  });
  const presence2 = await call("GET", "/presence/friends", { as: "ada" });
  check("smoke offline after session_end", presence2?.presences?.find((p) => p.username === smokeUser)?.status === "offline");
  const endedStats = await call("GET", `/users/${smokeUser}/stats`);
  check("session folded into DailyStat + commit counted", endedStats?.totalTokens === 600 && endedStats?.githubCommits?.length === 1, JSON.stringify(endedStats));

  const tokens = await call("GET", "/users/me/tracker-tokens", { as: "smoke" });
  check("token list hides raw token", tokens?.tokens?.length === 1 && !("token" in tokens.tokens[0]));
  await call("DELETE", `/users/me/tracker-tokens/${tokenRes?.tokenId}`, { as: "smoke", expect: 204 });
  await call("POST", "/tracker/heartbeat", { token: tokenRes?.token, body: { eventType: "heartbeat", projectAlias: "x", occurredAt: new Date().toISOString() }, expect: 401 });

  // --- cleanup ----------------------------------------------------------------------
  await call("DELETE", `/friends/${smokeUser}`, { as: "ada", expect: 204 });
  await call("POST", "/auth/logout", { as: "smoke", expect: 204 });

  console.log(`\n${failures === 0 ? "ALL GREEN" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
