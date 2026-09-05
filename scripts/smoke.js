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

  // --- heartbeat v2: per-source `usage[]` (ARCHITECTURE.md §4.3) ---------------------
  // Top-level deltas are the legacy sum of the usage entries; the server must credit the
  // usage entries only, so a double count would show up as 600 + 2*1152 in totalTokens.
  const hbUsage = await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: {
      eventType: "heartbeat",
      projectAlias: "smoke-proj",
      tool: "claude-code",
      model: "claude-fable-5-1",
      tokensInputDelta: 812,
      tokensOutputDelta: 340,
      occurredAt: new Date().toISOString(),
      usage: [
        { tool: "claude-code", model: "claude-fable-5-1", tokensInputDelta: 700, tokensOutputDelta: 300 },
        { tool: "codex", model: "gpt-5-codex", tokensInputDelta: 112, tokensOutputDelta: 40 },
      ],
    },
  });
  check("usage heartbeat opens ACTIVE session", hbUsage?.status === "ACTIVE" && hbUsage?.sessionId, JSON.stringify(hbUsage));
  const usageStats = await call("GET", `/users/${smokeUser}/stats`);
  const byPair = (stats, tool, model) => stats?.byModel?.find((b) => b.tool === tool && b.model === model);
  const fableBucket = byPair(usageStats, "claude-code", "claude-fable-5-1");
  const codexBucket = byPair(usageStats, "codex", "gpt-5-codex");
  check("usage → byModel has (claude-code, claude-fable-5-1) = 700/300", fableBucket?.tokensInput === 700 && fableBucket?.tokensOutput === 300, JSON.stringify(usageStats?.byModel));
  check("usage → byModel has (codex, gpt-5-codex) = 112/40", codexBucket?.tokensInput === 112 && codexBucket?.tokensOutput === 40, JSON.stringify(usageStats?.byModel));
  check("usage not double-counted via Session (total = 600 + 1152)", usageStats?.totalTokens === 1752, `totalTokens=${usageStats?.totalTokens}`);

  const tracker = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("tracker v2: connected + presence active on claude-fable-5-1", tracker?.connected === true && tracker?.presence?.status === "active" && tracker?.presence?.activity?.model === "claude-fable-5-1", JSON.stringify(tracker?.presence));
  check("tracker v2: heartbeatIntervalMs = 30000", tracker?.heartbeatIntervalMs === 30000);
  const findSource = (t, tool, model) => t?.sources?.find((s) => s.tool === tool && s.model === model);
  const fableSource = findSource(tracker, "claude-code", "claude-fable-5-1");
  const codexSource = findSource(tracker, "codex", "gpt-5-codex");
  check("tracker v2: sources has (claude-code, claude-fable-5-1) tokensToday=1000", fableSource?.tokensToday === 1000 && typeof fableSource?.lastSeenAt === "string", JSON.stringify(tracker?.sources));
  check("tracker v2: sources has (codex, gpt-5-codex) tokensToday=152", codexSource?.tokensToday === 152 && codexSource?.tokens7d === 152, JSON.stringify(tracker?.sources));
  check("tracker v2: sources sorted most-recent first", tracker?.sources?.length >= 3 && tracker.sources.every((s, i, arr) => i === 0 || Date.parse(arr[i - 1].lastSeenAt) >= Date.parse(s.lastSeenAt)), JSON.stringify(tracker?.sources?.map((s) => s.lastSeenAt)));
  check("tracker v2: devices lists the smoke laptop token", tracker?.devices?.length === 1 && tracker.devices[0].label === "smoke laptop" && tracker.devices[0].id === tokenRes?.tokenId, JSON.stringify(tracker?.devices));
  check("tracker v2: legacy fields kept", Array.isArray(tracker?.tools) && tracker.tools.includes("claude-code") && typeof tracker?.activeTokens === "number" && "tokenLastUsedAt" in tracker);

  // "<synthetic>" (Claude Code's placeholder for locally generated turns) must never
  // surface as a model — the server normalizes it to null at ingestion.
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "heartbeat", projectAlias: "smoke-proj", tool: "claude-code", model: "<synthetic>", tokensInputDelta: 0, tokensOutputDelta: 0, occurredAt: new Date().toISOString() },
  });
  const trackerSynthetic = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("model <synthetic> → presence.activity.model is null", trackerSynthetic?.presence?.status === "active" && trackerSynthetic?.presence?.activity?.tool === "claude-code" && trackerSynthetic?.presence?.activity?.model === null, JSON.stringify(trackerSynthetic?.presence));
  check("model <synthetic> → no '<synthetic>' source", !trackerSynthetic?.sources?.some((s) => s.model === "<synthetic>") && Boolean(findSource(trackerSynthetic, "claude-code", null)), JSON.stringify(trackerSynthetic?.sources));
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "session_end", projectAlias: "smoke-proj", tool: "claude-code", model: "<synthetic>", occurredAt: new Date().toISOString() },
  });
  const trackerEnded = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("session_end with <synthetic> closes the null-model session", trackerEnded?.connected === false && trackerEnded?.presence?.status === "offline");
  const finalStats = await call("GET", `/users/${smokeUser}/stats`);
  check("totals unchanged after closing usage sessions (no double count on fold)", finalStats?.totalTokens === 1752, `totalTokens=${finalStats?.totalTokens}`);

  // --- null → known model refinement (ARCHITECTURE.md §4.3) --------------------------
  // Claude Code is detected by its process before its log has a model line, so the
  // first heartbeats carry model: null. When the model shows up for the same
  // (projectAlias, tool), the open session is refined in place: same sessionId, no
  // second Session, presence flips to the known model without start/end churn.
  const hbNull = await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "heartbeat", projectAlias: "smoke-refine", tool: "claude-code", model: null, tokensInputDelta: 0, tokensOutputDelta: 0, occurredAt: new Date().toISOString() },
  });
  check("refine: null-model heartbeat opens ACTIVE session", hbNull?.status === "ACTIVE" && typeof hbNull?.sessionId === "string", JSON.stringify(hbNull));
  const trackerNull = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("refine: presence model is null before the model is known", trackerNull?.presence?.activity?.projectAlias === "smoke-refine" && trackerNull?.presence?.activity?.model === null, JSON.stringify(trackerNull?.presence));
  const hbKnown = await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "heartbeat", projectAlias: "smoke-refine", tool: "claude-code", model: "claude-fable-5-1", tokensInputDelta: 0, tokensOutputDelta: 0, occurredAt: new Date().toISOString() },
  });
  check("refine: known-model heartbeat returns the SAME sessionId (no new Session)", hbKnown?.status === "ACTIVE" && hbKnown?.sessionId === hbNull?.sessionId, `null=${hbNull?.sessionId} known=${hbKnown?.sessionId}`);
  const trackerRefined = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("refine: session.model updated in place (presence = claude-fable-5-1, same startedAt)", trackerRefined?.presence?.activity?.model === "claude-fable-5-1" && trackerRefined?.presence?.activity?.startedAt === trackerNull?.presence?.activity?.startedAt, JSON.stringify(trackerRefined?.presence));
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "session_end", projectAlias: "smoke-refine", tool: "claude-code", model: "claude-fable-5-1", occurredAt: new Date().toISOString() },
  });
  const trackerRefinedEnd = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("refine: session_end with the refined model closes it (offline)", trackerRefinedEnd?.connected === false && trackerRefinedEnd?.presence?.status === "offline", JSON.stringify(trackerRefinedEnd?.presence));
  const refinedStats = await call("GET", `/users/${smokeUser}/stats`);
  check("refine: zero-token session folds without changing totals", refinedStats?.totalTokens === 1752, `totalTokens=${refinedStats?.totalTokens}`);

  // --- round 6: multi-tool presence, quadcode, estimated usage ----------------------
  // People sit in several tools at once, so presence reports the whole stack while
  // hours and tokens still accrue only to the primary. `estimated: true` marks counts
  // the tracker derived (Quadcode logs carry no token numbers); the server must accept
  // the flag and must not let it change accounting.
  const statsBeforeMulti = await call("GET", `/users/${smokeUser}/stats`);
  const hbMulti = await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: {
      eventType: "heartbeat",
      projectAlias: "smoke-multi",
      tool: "quadcode",
      model: "claude-fable-5-1",
      tokensInputDelta: 40,
      tokensOutputDelta: 60,
      usage: [{ tool: "quadcode", model: "claude-fable-5-1", tokensInputDelta: 40, tokensOutputDelta: 60, estimated: true }],
      tools: [
        { tool: "quadcode", model: "claude-fable-5-1", projectAlias: "smoke-multi" },
        { tool: "cursor", model: null, projectAlias: "smoke-multi" },
        { tool: "claude-code", model: "claude-opus-5", projectAlias: null },
      ],
      occurredAt: new Date().toISOString(),
    },
  });
  check("multi-tool: quadcode heartbeat opens an ACTIVE session", hbMulti?.status === "ACTIVE" && typeof hbMulti?.sessionId === "string", JSON.stringify(hbMulti));
  const trackerMulti = await call("GET", "/users/me/tracker", { as: "smoke" });
  check(
    "quadcode session carries its model",
    trackerMulti?.presence?.activity?.tool === "quadcode" && trackerMulti?.presence?.activity?.model === "claude-fable-5-1",
    JSON.stringify(trackerMulti?.presence?.activity)
  );
  check(
    "presence.tools lists every open tool, primary first",
    JSON.stringify((trackerMulti?.presence?.tools ?? []).map((t) => t.tool)) === JSON.stringify(["quadcode", "cursor", "claude-code"]),
    JSON.stringify(trackerMulti?.presence?.tools)
  );
  check(
    "presence.tools keeps each tool's own model and project",
    trackerMulti?.presence?.tools?.[1]?.model === null &&
      trackerMulti?.presence?.tools?.[1]?.projectAlias === "smoke-multi" &&
      trackerMulti?.presence?.tools?.[2]?.model === "claude-opus-5" &&
      trackerMulti?.presence?.tools?.[2]?.projectAlias === null,
    JSON.stringify(trackerMulti?.presence?.tools)
  );
  const presenceMulti = await call("GET", "/presence/friends", { as: "ada" });
  const smokeMulti = presenceMulti?.presences?.find((p) => p.username === smokeUser);
  check(
    "friend view sees the same tool stack",
    JSON.stringify((smokeMulti?.tools ?? []).map((t) => t.tool)) === JSON.stringify(["quadcode", "cursor", "claude-code"]),
    JSON.stringify(smokeMulti)
  );
  const statsAfterMulti = await call("GET", `/users/${smokeUser}/stats`);
  check(
    "estimated usage is counted exactly like measured usage (flag changes nothing)",
    statsAfterMulti?.totalTokens === (statsBeforeMulti?.totalTokens ?? 0) + 100,
    `before=${statsBeforeMulti?.totalTokens} after=${statsAfterMulti?.totalTokens}`
  );

  // A tracker that predates tools[] opens a session without one: presence falls back
  // to just the primary activity, never null.
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "heartbeat", projectAlias: "smoke-legacy", tool: "cursor", occurredAt: new Date().toISOString() },
  });
  const trackerLegacy = await call("GET", "/users/me/tracker", { as: "smoke" });
  check(
    "tracker without tools[] falls back to [activity]",
    (trackerLegacy?.presence?.tools ?? []).length === 1 && trackerLegacy?.presence?.tools?.[0]?.tool === "cursor",
    JSON.stringify(trackerLegacy?.presence?.tools)
  );
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "session_end", projectAlias: "smoke-legacy", tool: "cursor", occurredAt: new Date().toISOString() },
  });
  const trackerOffline = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("offline presence reports an empty tool list, not null", Array.isArray(trackerOffline?.presence?.tools) && trackerOffline.presence.tools.length === 0, JSON.stringify(trackerOffline?.presence));

  // --- round 7: stats range=all + per-bucket lastActiveAt (§5.6) --------------------
  // The Steam-style models block needs a lifetime "hrs on record" per model and a "last
  // used 4 Sep" line. `range=all` drops the lower bound entirely (and reports
  // rangeDays: null); every byModel bucket now carries the newest moment that (tool,
  // model) pair was seen — to the second while its session is open, to the UTC day once
  // it has folded into DailyStat.
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: {
      eventType: "heartbeat",
      projectAlias: "smoke-range",
      tool: "codex",
      model: "gpt-5-codex",
      tokensInputDelta: 10,
      tokensOutputDelta: 20,
      occurredAt: new Date().toISOString(),
    },
  });
  const statsAll = await call("GET", `/users/${smokeUser}/stats?range=all`);
  const stats30 = await call("GET", `/users/${smokeUser}/stats?range=30d`);
  check("range=all → rangeDays null", statsAll?.rangeDays === null, JSON.stringify(statsAll?.rangeDays));
  check(
    "range=all totals >= range=30d totals",
    statsAll?.totalTokens >= stats30?.totalTokens && statsAll?.totalActiveSeconds >= stats30?.totalActiveSeconds,
    `all=${statsAll?.totalTokens}/${statsAll?.totalActiveSeconds} 30d=${stats30?.totalTokens}/${stats30?.totalActiveSeconds}`
  );
  check(
    "every byModel bucket carries a parseable lastActiveAt",
    statsAll?.byModel?.length > 0 &&
      statsAll.byModel.every((b) => typeof b.lastActiveAt === "string" && !Number.isNaN(Date.parse(b.lastActiveAt))),
    JSON.stringify(statsAll?.byModel?.map((b) => [b.tool, b.model, b.lastActiveAt]))
  );
  const newestBucket = [...(statsAll?.byModel ?? [])].sort(
    (a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)
  )[0];
  check(
    "lastActiveAt orders the just-heartbeated pair newest, at second precision",
    newestBucket?.tool === "codex" &&
      newestBucket?.model === "gpt-5-codex" &&
      Date.now() - Date.parse(newestBucket.lastActiveAt) < 120_000,
    JSON.stringify(newestBucket)
  );
  // Seeded ada has two weeks of folded history, so "all" must reach further back than
  // one day — otherwise "no lower bound" would be indistinguishable from the default.
  const adaAll = await call("GET", "/users/ada/stats?range=all");
  const adaDay = await call("GET", "/users/ada/stats?range=1d");
  check(
    "range=all reaches past a narrow range (ada: all > 1d)",
    adaAll?.totalTokens > 0 && adaAll.totalTokens > adaDay?.totalTokens,
    `all=${adaAll?.totalTokens} 1d=${adaDay?.totalTokens}`
  );
  check(
    "folded DailyStat buckets also report lastActiveAt",
    adaAll?.byModel?.length > 0 && adaAll.byModel.every((b) => typeof b.lastActiveAt === "string"),
    JSON.stringify(adaAll?.byModel?.map((b) => [b.tool, b.model, b.lastActiveAt]))
  );
  await call("POST", "/tracker/heartbeat", {
    token: tokenRes?.token,
    body: { eventType: "session_end", projectAlias: "smoke-range", tool: "codex", model: "gpt-5-codex", occurredAt: new Date().toISOString() },
  });

  // --- round 7: repo browser — GET /projects/:id/repo (§5.5) ------------------------
  // Real GitHub call against a real public repo. Anonymous GitHub allows 60 requests an
  // hour per IP, so a rate-limited run still has to be a *correct* run: the endpoint is
  // contractually allowed to answer 503 { error: "github_unavailable" }, and this block
  // asserts that shape instead of the 200 shape when it does, saying so out loud.
  const repoProject = await call("POST", "/projects", {
    as: "smoke",
    body: {
      name: "Smoke Repo Browser",
      description: "round 7 repo browser",
      repoUrl: "https://github.com/expressjs/express",
      liveUrl: "https://expressjs.com",
    },
    expect: 201,
  });
  const repoId = repoProject?.project?.id;

  // Signed out on purpose: a public project's code is browsable without an account.
  const repoRoot = await call("GET", `/projects/${repoId}/repo`, { expect: [200, 503] });
  const githubBusy = repoRoot?.error === "github_unavailable";
  if (githubBusy) {
    console.log("note  GitHub was rate-limited/unreachable — asserting the 503 contract, not the 200 shape");
    check(
      "repo browser: 503 body is exactly { error: github_unavailable }",
      Object.keys(repoRoot).length === 1 && repoRoot.error === "github_unavailable",
      JSON.stringify(repoRoot)
    );
  } else {
    const entries = repoRoot?.entries ?? [];
    const firstFileAt = entries.findIndex((e) => e.type === "file");
    const alphaWithinGroup = (list) =>
      list.every((e, i) => i === 0 || list[i - 1].name.localeCompare(e.name, "en", { sensitivity: "base" }) <= 0);
    check(
      "repo browser: repo + defaultBranch + path for the root listing",
      repoRoot?.repo?.owner === "expressjs" &&
        repoRoot?.repo?.repo === "express" &&
        typeof repoRoot?.defaultBranch === "string" &&
        repoRoot.defaultBranch.length > 0 &&
        repoRoot?.path === "",
      JSON.stringify({ repo: repoRoot?.repo, defaultBranch: repoRoot?.defaultBranch, path: repoRoot?.path })
    );
    check(
      "repo browser: entries are dirs first, then files, alpha within each group",
      entries.length > 0 &&
        (firstFileAt === -1 || !entries.slice(firstFileAt).some((e) => e.type === "dir")) &&
        alphaWithinGroup(entries.filter((e) => e.type === "dir")) &&
        alphaWithinGroup(entries.filter((e) => e.type === "file")),
      JSON.stringify(entries.map((e) => `${e.type}:${e.name}`).slice(0, 12))
    );
    check(
      "repo browser: entry shape { name, type, size, url } — dirs have size null",
      entries.every(
        (e) =>
          typeof e.name === "string" &&
          (e.type === "dir" || e.type === "file") &&
          (e.size === null || typeof e.size === "number") &&
          typeof e.url === "string" &&
          e.url.startsWith("https://github.com/")
      ) &&
        entries.filter((e) => e.type === "dir").every((e) => e.size === null) &&
        entries.some((e) => e.type === "file" && typeof e.size === "number"),
      JSON.stringify(entries.slice(0, 3))
    );
    check(
      "repo browser: root carries languages (shares summing to ~1) + readme",
      Array.isArray(repoRoot?.languages) &&
        repoRoot.languages.length > 0 &&
        Math.abs(repoRoot.languages.reduce((sum, l) => sum + l.share, 0) - 1) < 0.01 &&
        repoRoot.languages.every((l, i) => i === 0 || repoRoot.languages[i - 1].share >= l.share) &&
        typeof repoRoot?.readme?.excerpt === "string" &&
        typeof repoRoot?.readme?.url === "string",
      JSON.stringify({ languages: repoRoot?.languages, readmeUrl: repoRoot?.readme?.url })
    );
    const excerpt = repoRoot?.readme?.excerpt ?? "";
    check(
      "repo browser: readme excerpt is plain text, <= ~600 chars",
      excerpt.length > 0 &&
        excerpt.length <= 601 &&
        !excerpt.includes("](") &&
        !excerpt.includes("![") &&
        !excerpt.startsWith("#") &&
        !excerpt.includes("<img"),
      JSON.stringify(excerpt.slice(0, 160))
    );

    const repoLib = await call("GET", `/projects/${repoId}/repo?path=lib`, { expect: [200, 503] });
    if (repoLib?.error) {
      console.log("note  subpath listing hit the GitHub rate limit — 503 shape asserted instead");
      check("repo browser: subpath 503 body", repoLib.error === "github_unavailable", JSON.stringify(repoLib));
    } else {
      check(
        "repo browser: ?path=lib lists that folder; languages/readme are root-only",
        repoLib?.path === "lib" &&
          Array.isArray(repoLib?.entries) &&
          repoLib.entries.length > 0 &&
          repoLib.languages === null &&
          repoLib.readme === null,
        JSON.stringify({ path: repoLib?.path, count: repoLib?.entries?.length, languages: repoLib?.languages, readme: repoLib?.readme })
      );
    }
  }

  // Path validation runs before any GitHub call, so these four cost nothing and never flake.
  await call("GET", `/projects/${repoId}/repo?path=../../etc`, { expect: 400 });
  await call("GET", `/projects/${repoId}/repo?path=lib/../../secrets`, { expect: 400 });
  await call("GET", `/projects/${repoId}/repo?path=${"a/".repeat(21)}b`, { expect: 400 });
  await call("GET", `/projects/${repoId}/repo?path=${"a".repeat(201)}`, { expect: 400 });

  // Not a GitHub repo, and no repo at all — both 404, never an empty file list.
  const gitlabProject = await call("POST", "/projects", {
    as: "smoke",
    body: { name: "Smoke Gitlab", repoUrl: "https://gitlab.com/smoke/elsewhere" },
    expect: 201,
  });
  await call("GET", `/projects/${gitlabProject?.project?.id}/repo`, { expect: 404 });
  const noRepoProject = await call("POST", "/projects", { as: "smoke", body: { name: "Smoke No Repo" }, expect: 201 });
  await call("GET", `/projects/${noRepoProject?.project?.id}/repo`, { expect: 404 });

  // Visibility gate is the one from GET /projects/:id: private is a 404 for everyone
  // but the owner, and the check happens before GitHub is touched.
  const privateProject = await call("POST", "/projects", {
    as: "smoke",
    body: { name: "Smoke Private Repo", repoUrl: "https://github.com/expressjs/express", isPublic: false },
    expect: 201,
  });
  const privateId = privateProject?.project?.id;
  await call("GET", `/projects/${privateId}/repo`, { as: "ada", expect: 404 });
  await call("GET", `/projects/${privateId}/repo`, { expect: 404 });
  // The owner can browse it — served from the 10-minute cache filled above, so free.
  const privateOwn = await call("GET", `/projects/${privateId}/repo`, { as: "smoke", expect: [200, 503] });
  check(
    "repo browser: owner browses their own private project",
    privateOwn?.error === "github_unavailable" || privateOwn?.repo?.repo === "express",
    JSON.stringify(privateOwn?.repo ?? privateOwn)
  );

  for (const id of [repoId, gitlabProject?.project?.id, noRepoProject?.project?.id, privateId]) {
    await call("DELETE", `/projects/${id}`, { as: "smoke", expect: 204 });
  }

  const tokens = await call("GET", "/users/me/tracker-tokens", { as: "smoke" });
  check("token list hides raw token", tokens?.tokens?.length === 1 && !("token" in tokens.tokens[0]));

  // --- token minted once: replaceUnused (ARCHITECTURE.md §5.2) ----------------------
  // Retrying the connect flow must not pile up live-but-unused tokens: minting with
  // replaceUnused revokes the caller's never-used tokens in the same transaction. The
  // "smoke laptop" token has heartbeated (lastUsedAt set) and must survive untouched.
  const tokenA = await call("POST", "/users/me/tracker-tokens", { as: "smoke", body: { label: "unused A" }, expect: [200, 201] });
  const tokenB = await call("POST", "/users/me/tracker-tokens", { as: "smoke", body: { label: "replacement B", replaceUnused: true }, expect: [200, 201] });
  check("replaceUnused: response shape unchanged { token, tokenId }", typeof tokenB?.token === "string" && typeof tokenB?.tokenId === "string", JSON.stringify(Object.keys(tokenB ?? {})));
  const tokensAfter = await call("GET", "/users/me/tracker-tokens", { as: "smoke" });
  const tokenById = (id) => tokensAfter?.tokens?.find((t) => t.id === id);
  check("replaceUnused: unused token A revoked", typeof tokenById(tokenA?.tokenId)?.revokedAt === "string", JSON.stringify(tokenById(tokenA?.tokenId)));
  check("replaceUnused: new token B live", tokenById(tokenB?.tokenId)?.revokedAt === null, JSON.stringify(tokenById(tokenB?.tokenId)));
  check("replaceUnused: used token (lastUsedAt set) NOT revoked", typeof tokenById(tokenRes?.tokenId)?.lastUsedAt === "string" && tokenById(tokenRes?.tokenId)?.revokedAt === null, JSON.stringify(tokenById(tokenRes?.tokenId)));
  check("token list includes revoked tokens with lastUsedAt/revokedAt/createdAt", tokensAfter?.tokens?.length === 3 && tokensAfter.tokens.every((t) => "lastUsedAt" in t && "revokedAt" in t && typeof t.createdAt === "string"), JSON.stringify(tokensAfter?.tokens));
  await call("GET", "/tracker/verify", { token: tokenA?.token, expect: 401 });
  const verifyB = await call("GET", "/tracker/verify", { token: tokenB?.token });
  check("replaceUnused: token B authenticates", verifyB?.username === smokeUser, JSON.stringify(verifyB));
  const trackerDevices = await call("GET", "/users/me/tracker", { as: "smoke" });
  check("tracker devices lists only live tokens (laptop + B)", trackerDevices?.devices?.length === 2 && !trackerDevices.devices.some((d) => d.id === tokenA?.tokenId), JSON.stringify(trackerDevices?.devices));
  await call("DELETE", `/users/me/tracker-tokens/${tokenB?.tokenId}`, { as: "smoke", expect: 204 });
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
