// QA helper for the uploads volume.
//
//   node scripts/check-avatar-persistence.js upload <apiUrl> <username>
//     -> dev-logs in as <username>, uploads a 1x1 PNG avatar, prints the avatar URL
//   node scripts/check-avatar-persistence.js verify <avatarUrl>
//     -> GETs the URL and exits 0 on HTTP 200 (run this after a redeploy)
//
// Requires DEV_LOGIN_ENABLED=true on the target server. Uses only Node 18+ built-ins.

const [mode, ...rest] = process.argv.slice(2);

// Smallest valid PNG (1x1, opaque black).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

async function upload(apiUrl, username) {
  const login = await fetch(`${apiUrl}/api/v1/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!login.ok) throw new Error(`dev-login failed: ${login.status} ${await login.text()}`);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error("no session cookie returned");

  const form = new FormData();
  form.append("file", new Blob([PNG_1X1], { type: "image/png" }), "probe.png");
  const res = await fetch(`${apiUrl}/api/v1/users/me/avatar`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  const { avatarUrl } = await res.json();
  console.log(avatarUrl);
}

async function verify(avatarUrl) {
  const res = await fetch(avatarUrl, { cache: "no-store" });
  console.log(`${res.status} ${avatarUrl}`);
  if (!res.ok) process.exitCode = 1;
}

(async () => {
  if (mode === "upload" && rest.length === 2) return upload(rest[0], rest[1]);
  if (mode === "verify" && rest.length === 1) return verify(rest[0]);
  console.error("usage: upload <apiUrl> <username> | verify <avatarUrl>");
  process.exitCode = 2;
})().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
