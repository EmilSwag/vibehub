// Typed env accessor. Defaults mirror .env.example / docs/BUILD_PLAN.md §3 so the
// dev server boots with sane values even before an operator copies .env.example.

export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseProvider: (process.env.DATABASE_PROVIDER === "sqlite" ? "sqlite" : "postgresql") as
    | "postgresql"
    | "sqlite",
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  githubCallbackUrl:
    process.env.GITHUB_CALLBACK_URL ?? "http://localhost:4000/api/v1/auth/github/callback",
  devLoginEnabled: process.env.DEV_LOGIN_ENABLED === "true",
  // Round 5 Phase 6: optional prod QA login (routes/auth.ts POST /auth/qa-login),
  // scoped to vh-qa-* usernames only. Unset (the default) => the route doesn't
  // exist, not just refuses — see the route registration for why.
  qaLoginSecret: process.env.QA_LOGIN_SECRET || null,
  sessionIdleTimeoutMs: Number(process.env.SESSION_IDLE_TIMEOUT_MS ?? 600_000),
  isProduction: process.env.NODE_ENV === "production",
  // Where avatar files live. On Railway this is a persistent volume mounted at
  // /app/uploads (== <cwd>/uploads), so the default works without configuration;
  // override with UPLOAD_DIR to mount the volume elsewhere.
  uploadDir: process.env.UPLOAD_DIR || `${process.cwd()}/uploads`,
  // Web and API are served from different hosts on Railway (*.up.railway.app is on the
  // Public Suffix List, so sibling subdomains count as different sites). Cross-site
  // fetch/WS with credentials therefore needs SameSite=None (+ Secure). Local dev on
  // localhost keeps Lax. Override explicitly with COOKIE_SAME_SITE=lax|none|strict.
  cookieSameSite: ((): "lax" | "none" | "strict" => {
    const raw = process.env.COOKIE_SAME_SITE?.toLowerCase();
    if (raw === "lax" || raw === "none" || raw === "strict") return raw;
    return process.env.NODE_ENV === "production" ? "none" : "lax";
  })(),
};

/** First allowed browser origin — where OAuth callbacks redirect to. */
export const primaryWebOrigin = env.corsOrigin.split(",")[0].trim();
