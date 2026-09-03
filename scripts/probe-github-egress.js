// Diagnostic: does the deployed server container actually reach GitHub?
//
//   railway ssh --service server -- sh -c "cd /app && node probe-github-egress.js"
//
// Prints DNS answers (A + AAAA) and timings for the two calls the OAuth callback
// makes (token exchange + /user). Every request is bounded so a hang shows up as a
// timeout instead of blocking forever — which is exactly the failure we're chasing.

const dns = require("node:dns");

const TIMEOUT_MS = 8000;

async function resolve(host) {
  const out = { host, a: [], aaaa: [] };
  try {
    out.a = await dns.promises.resolve4(host);
  } catch (err) {
    out.a = [`ERR ${err.code ?? err.message}`];
  }
  try {
    out.aaaa = await dns.promises.resolve6(host);
  } catch (err) {
    out.aaaa = [`ERR ${err.code ?? err.message}`];
  }
  return out;
}

async function timed(label, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    console.log(`${label}: OK ${Date.now() - started}ms — ${value}`);
  } catch (err) {
    console.log(`${label}: FAIL ${Date.now() - started}ms — ${err.name}: ${err.message}`);
  }
}

/**
 * Walks the OAuth entry + callback exactly like a browser would (minus GitHub's own
 * consent screen): GET /auth/github to obtain the state cookie, then replay that cookie
 * against /auth/github/callback with a throwaway code. A healthy server answers 400
 * "GitHub OAuth failed: …" in well under a second; a hang here is the bug we're after.
 */
async function probeCallback(baseUrl) {
  const started = Date.now();
  const entry = await fetch(`${baseUrl}/api/v1/auth/github`, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const setCookie = entry.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  const state = new URL(entry.headers.get("location") ?? "https://x/").searchParams.get("state");
  console.log(
    `GET /auth/github: ${entry.status} ${Date.now() - started}ms state=${state} cookie=${cookie}`
  );

  await timed("GET /auth/github/callback (bogus code)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/auth/github/callback?code=probe-invalid&state=${state}`,
      { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(20_000) }
    );
    return `status=${res.status} location=${res.headers.get("location") ?? "-"} body=${(
      await res.text()
    ).slice(0, 200)}`;
  });
}

(async () => {
  if (process.argv[2] === "callback") {
    await probeCallback(process.argv[3] ?? "http://localhost:4000");
    return;
  }

  console.log(`node=${process.version} order=${dns.getDefaultResultOrder?.() ?? "n/a"}`);

  for (const host of ["github.com", "api.github.com"]) {
    const r = await resolve(host);
    console.log(`dns ${r.host}: A=${r.a.join(",")} AAAA=${r.aaaa.join(",")}`);
  }

  // Same shape as routes/auth.ts token exchange, with a deliberately invalid code:
  // GitHub answers 200 + {error: "bad_verification_code"} fast when reachable.
  await timed("POST github.com/login/oauth/access_token", async () => {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: "probe", client_secret: "probe", code: "probe" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return `status=${res.status} body=${(await res.text()).slice(0, 120)}`;
  });

  await timed("GET api.github.com/user (no auth)", async () => {
    const res = await fetch("https://api.github.com/user", {
      headers: { "User-Agent": "vibehub-server" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return `status=${res.status}`;
  });
})();
