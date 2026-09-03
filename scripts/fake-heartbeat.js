// Dev helper: make a seeded dev account look like it's coding right now, without running
// the real tracker. Logs in via dev-login, mints a tracker token, sends one heartbeat.
//
//   node scripts/fake-heartbeat.js [username=linus] [projectAlias=kernel-sim] [apiUrl]

const [username = "linus", projectAlias = "kernel-sim", apiArg] = process.argv.slice(2);
const API = (apiArg ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function main() {
  const login = await fetch(`${API}/api/v1/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!login.ok) throw new Error(`dev-login failed: ${login.status} ${await login.text()}`);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const tokenRes = await fetch(`${API}/api/v1/users/me/tracker-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ label: "fake-heartbeat" }),
  });
  const { token } = await tokenRes.json();

  const hb = await fetch(`${API}/api/v1/tracker/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      eventType: "heartbeat",
      projectAlias,
      tool: "codex",
      model: "gpt-5-codex",
      tokensInputDelta: 900,
      tokensOutputDelta: 3100,
      occurredAt: new Date().toISOString(),
    }),
  });
  console.log(`${username} → ${projectAlias}:`, hb.status, await hb.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
