import "dotenv/config";
import { prisma } from "../src/db";
import { encryptSecret } from "../src/lib/crypto";
import { getFreshGithubToken, GithubAuthError } from "../src/lib/github";

// Local-only proof for Round 5 Phase 9 Step 2: GitHub App user tokens expire (~8h);
// the OAuth callback now stores the refresh token + expiries, and getFreshGithubToken
// renews an expired token transparently. This constructs every credential state and
// shows the helper doing the right thing in each — no prod, no real GitHub (the
// refresh HTTP call is stubbed so the persist path is exercised offline).
//
//   $env:DATABASE_PROVIDER='sqlite'; npm run db:dev; npx tsx scripts/local-github-refresh-check.ts
//
// Requires the SQLite mirror (schema.sqlite.prisma) to carry the new columns — so a
// clean run is also proof the migration's columns exist on that schema.

const HOUR = 3600_000;

async function mkUser(username: string, data: Record<string, unknown>) {
  await prisma.user.deleteMany({ where: { username } });
  return prisma.user.create({ data: { username, displayName: username, isDevAccount: true, ...data } });
}

async function main() {
  let pass = true;
  const check = (label: string, ok: boolean, detail: string) => {
    pass = pass && ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  };

  // 1) Never connected: no stored token → null (route maps to 409 "connect").
  const u1 = await mkUser("qa-ghr-none", { githubAccessToken: null });
  const t1 = await getFreshGithubToken(u1);
  check("no token → null", t1 === null, `got ${JSON.stringify(t1)}`);

  // 2) Non-expiring (classic OAuth App / legacy row, expiresAt null) → used as-is.
  const u2 = await mkUser("qa-ghr-nonexp", {
    githubAccessToken: encryptSecret("gho_nonexpiring"),
    githubTokenExpiresAt: null,
  });
  const t2 = await getFreshGithubToken(u2);
  check("non-expiring → returned as-is", t2 === "gho_nonexpiring", `got ${JSON.stringify(t2)}`);

  // 3) Valid, in-date GitHub App token (expires in 2h) → used as-is, no refresh.
  const u3 = await mkUser("qa-ghr-valid", {
    githubAccessToken: encryptSecret("ghu_stillgood"),
    githubRefreshToken: encryptSecret("ghr_x"),
    githubTokenExpiresAt: new Date(Date.now() + 2 * HOUR),
    githubRefreshTokenExpiresAt: new Date(Date.now() + 100 * HOUR),
  });
  const t3 = await getFreshGithubToken(u3);
  check("in-date → returned as-is", t3 === "ghu_stillgood", `got ${JSON.stringify(t3)}`);

  // 4) Expired token, NO refresh token (anal's real state: legacy row) → GithubAuthError.
  const u4 = await mkUser("qa-ghr-expired-norefresh", {
    githubAccessToken: encryptSecret("ghu_deadnorefresh"),
    githubRefreshToken: null,
    githubTokenExpiresAt: new Date(Date.now() - 1 * HOUR),
  });
  let threw4 = false;
  try {
    await getFreshGithubToken(u4);
  } catch (e) {
    threw4 = e instanceof GithubAuthError;
  }
  check("expired + no refresh → GithubAuthError (reconnect)", threw4, `threw=${threw4}`);

  // 5) Expired token, refresh token present but ALSO expired → GithubAuthError.
  const u5 = await mkUser("qa-ghr-refresh-expired", {
    githubAccessToken: encryptSecret("ghu_dead"),
    githubRefreshToken: encryptSecret("ghr_dead"),
    githubTokenExpiresAt: new Date(Date.now() - 1 * HOUR),
    githubRefreshTokenExpiresAt: new Date(Date.now() - 1 * HOUR),
  });
  let threw5 = false;
  try {
    await getFreshGithubToken(u5);
  } catch (e) {
    threw5 = e instanceof GithubAuthError;
  }
  check("expired + refresh also expired → GithubAuthError", threw5, `threw=${threw5}`);

  // 6) Expired token, valid refresh token → refreshes via GitHub, persists new pair.
  //    Stub the one outbound HTTP call so this stays offline and deterministic.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        access_token: "ghu_fresh_minted",
        refresh_token: "ghr_rotated",
        expires_in: 8 * 3600,
        refresh_token_expires_in: 6 * 30 * 24 * 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
  try {
    const u6 = await mkUser("qa-ghr-refreshable", {
      githubAccessToken: encryptSecret("ghu_dead"),
      githubRefreshToken: encryptSecret("ghr_good"),
      githubTokenExpiresAt: new Date(Date.now() - 1 * HOUR),
      githubRefreshTokenExpiresAt: new Date(Date.now() + 100 * HOUR),
    });
    const t6 = await getFreshGithubToken(u6);
    const after = await prisma.user.findUnique({ where: { id: u6.id } });
    const persistedFuture =
      !!after?.githubTokenExpiresAt && after.githubTokenExpiresAt.getTime() > Date.now();
    check("expired + valid refresh → minted fresh token", t6 === "ghu_fresh_minted", `got ${JSON.stringify(t6)}`);
    check("refresh persisted new expiry in the future", persistedFuture, `expiresAt=${after?.githubTokenExpiresAt?.toISOString()}`);
    // The stored access token must now decrypt to the freshly minted one, not the dead one.
    const { decryptGithubToken } = await import("../src/lib/github");
    check(
      "stored access token rotated",
      decryptGithubToken(after?.githubAccessToken) === "ghu_fresh_minted",
      "decrypted stored token matches minted"
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  // Cleanup.
  await prisma.user.deleteMany({
    where: { username: { in: [
      "qa-ghr-none", "qa-ghr-nonexp", "qa-ghr-valid", "qa-ghr-expired-norefresh",
      "qa-ghr-refresh-expired", "qa-ghr-refreshable",
    ] } },
  });
  console.log(pass ? "\nALL PASS — cleanup done" : "\nFAILURES ABOVE — cleanup done");
  if (!pass) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
