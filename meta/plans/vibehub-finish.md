# Prod onboarding + tracker verification — @emilswag

Goal: verify the onboarding wizard and tracker connection work end-to-end on
**production** for GitHub user `@emilswag`, fix anything broken, and confirm the
fix with the same tests. Facts only — every claim in the write-up must trace to a
command actually run in this session and its actual output. No fabricated log
lines, no assumed DB rows.

Environment facts established before writing this plan (do not re-derive):
- Railway workspace `emilswag's Projects` → project `vibehub`, env `production`,
  linked via `railway status` (CLI already authenticated in this shell).
- `server` service is Online at `https://server-production-cc06.up.railway.app`,
  current deployment ID `ca5bfb16-8703-465e-98c4-4acf6ff4d252` (the "ca5bfb16"
  deploy referenced in the request — this is the Railway deployment ID, not a git
  commit; no matching git commit exists and none is expected).
- `web` service Online at `https://web-production-da778.up.railway.app`.
- Postgres addon Online (`postgres-volume`).
- Server error handler (`server/src/lib/http-error.ts`) already returns
  `{error: message}` JSON for `HttpError` and a generic `{error: "Internal server
  error"}` for anything else — stack traces are only ever `console.error`'d
  server-side, never sent to the client. `requireTrackerToken` (middleware/auth.ts)
  throws `HttpError(401, ...)` for a missing/invalid/revoked bearer token. This is
  the code-level expectation for step 4; step 4 confirms it's what prod actually
  does, not just what the source says.
- Tracker CLI `login <token>` (tracker/src/index.ts) does **not** call the server —
  it only writes `~/.vibehub/config.json`. Validation only happens once the daemon
  posts a heartbeat. `os.homedir()` on Windows reads `USERPROFILE`, not `HOME` — an
  "isolated temp HOME" on this box means overriding both env vars.

## Steps

1. **[skill: investigate]** Prod Postgres, read-only: `@emilswag`'s `users` row
   (id, githubUsername, onboardedAt, roles, createdAt), their `tracker_tokens`
   rows (label, lastUsedAt, revokedAt), and `sessions`/`activity_events` with
   `lastHeartbeatAt`/`occurredAt` in the last 24h. Via
   `railway ssh --service server -- node -e "..."` (same pattern as
   `scripts/delete-users.js`, but a find, never a write).
2. **[skill: canary]** `railway logs --service server` since deployment
   `ca5bfb16`, scanning for auth/tracker/onboarding errors, unhandled exceptions,
   or 5xx around any onboarding/tracker activity for emilswag.
3. **[skill: browse]** Fetch the prod web bundle's tracker assets —
   `/tracker/install.sh`, `/tracker/install.ps1`, `/tracker/vibehub-tracker.cjs` —
   from `https://web-production-da778.up.railway.app`, diff byte-for-byte against
   the repo's `web/dist/tracker/*` (already confirmed those match `web/public`
   source), and hit `/api/v1/health` on the server to confirm build/config
   matches expectations.
4. **[skill: qa]** Actually run the tracker install against prod: isolated temp
   dir as `HOME`+`USERPROFILE`, run `install.sh` end-to-end against the prod
   API/web URLs with a deliberately bogus device token. Confirm the heartbeat
   POST gets back a clean `401 {"error": "..."}` (checked directly with curl
   against the live endpoint), not a 500/stack trace, and that the install
   script itself doesn't crash. Cross-check against the log tail from step 2.
5. **[skill: run]** Full happy path locally, isolated from prod: SQLite dev DB
   (`npm run db:dev`, `npm run db:seed`), dev server (`npm run dev`,
   `DEV_LOGIN_ENABLED=true`), dev-login as `ada`, confirm `/api/v1/auth/dev-login`
   → onboarding endpoints → tracker-token issuance → heartbeat (via
   `scripts/fake-heartbeat.js` or a manual curl) all work.
6. Fix anything genuinely broken found in 1–5 in the source (not by hand-editing
   prod), then re-run only the specific check(s) that were failing to confirm the
   fix. No skill tag — plain code edit + targeted re-test.
7. Write up facts-only findings: what was checked, what was found, what (if
   anything) was fixed, with commands/output cited.

## Results (2026-09-03, this session)

1. **Prod Postgres** — `@emilswag` = `githubUsername: "EmilSwag"` (exact case;
   a lowercase `"emilswag"` lookup returns nothing — Postgres string equality is
   case-sensitive and the app never normalizes it, though the app itself always
   looks users up by `githubId`, never by re-typing this string, so it's not a
   live bug). VibeHub username is self-chosen `"anal"`. `onboardedAt` is set
   (2026-09-03T12:20:28Z), roles=`developer`, avatar + encrypted GitHub OAuth
   token present, archetype computed → **onboarding wizard fully completed**.
   `tracker_tokens`: **0 rows, ever**. `sessions`/`activity_events`: **0, ever**
   (not just last 24h) → **tracker was never connected** for this account.
2. **Server logs, deployment `ca5bfb16-…`** — clean boot, migrations applied,
   zero errors. Only `/api/v1/auth` is access-logged; that log shows a fully
   clean GitHub OAuth login+claim for `@anal (gh:EmilSwag)`. No 5xx anywhere in
   the captured log. Gap: `/tracker-tokens` and `/tracker/heartbeat` aren't
   access-logged, so a silent client-side failure during a real attempt would
   leave no server trace either way — couldn't use logs to rule that in or out.
3. **Prod web bundle / install assets** — `/tracker/install.sh`,
   `/tracker/install.ps1`, `/tracker/vibehub-tracker.cjs` fetched from
   `web-production-da778` are byte-for-byte identical to `web/dist/tracker/*` in
   this repo. `/api/v1/health` on `server-production-cc06` reports
   `{ok:true, provider:"postgresql", auth:{github:true, devLogin:false}}` as
   expected. No drift.
4. **Live install against prod** — isolated temp dir as both `HOME` and
   `USERPROFILE` (Windows `os.homedir()` reads `USERPROFILE`, not `HOME`), ran
   `install.sh <bogus-token>` against the real prod URLs: download → login →
   daemon start all succeeded (exit 0). The daemon (detecting real local
   activity on this machine) attempted 3 heartbeat POSTs with the bogus token;
   each was rejected and queued for retry per the tracker's designed offline
   behavior — `daemon.log` stayed empty (no exception, no stack trace). Direct
   requests to the live heartbeat endpoint confirmed clean, correct error
   bodies: bogus token → `401 {"error":"Invalid or revoked tracker token"}`;
   missing bearer → `401 {"error":"Missing bearer token"}`. Token was rejected
   before the route handler runs, so **no rows were written to prod Postgres**
   by this test. Daemon stopped and the temp dir removed afterward.
5. **Local happy path** — SQLite dev server (already running at
   `localhost:4000`, `DEV_LOGIN_ENABLED=true`) seeded via `npm run db:seed`.
   `node scripts/smoke.js http://localhost:4000` → **ALL GREEN** (dev-login,
   profile, friends, wall, projects, stats, presence, tracker-token issuance,
   heartbeat, bogus/revoked-token 401s). Also checked directly (not covered by
   smoke.js): `GET /users/me/tracker` → `{connected:true, ...}`, `POST
   /users/me/onboarding/complete` → 200 and idempotent on a second call.

**Nothing was broken, so nothing was changed.** Every mechanism the request
asked to verify — deployed-bundle integrity, prod error handling for bad
tracker tokens, and the full local onboarding+tracker API surface — checked
out correct. The one real fact worth act­ing on is a product/UX one, not a code
defect: `@emilswag` completed onboarding but has never run the tracker
installer, and nothing in logs or the DB indicates a failed attempt.

## Follow-up (same session): Windows install.ps1 + browser confirmation

Two gaps closed after the initial pass above:

- **[skill: qa]** Ran `install.ps1` for real (`irm ... | iex`-equivalent — a
  script downloaded from prod, executed with isolated `HOME`+`USERPROFILE`)
  with a bogus token. Found and root-caused a real bug: `node -p
  'process.versions.node.split(".")[0]'` has its embedded double-quotes
  stripped by Windows PowerShell 5.1 when passed to a native exe, so node
  received invalid syntax and crashed; the script always computed Node major
  version `0` and aborted with a false "Node.js 0 found; 18+ is required." —
  on every real Windows machine, regardless of the actual Node version. This
  is the exact one-line command every Windows user sees in the Connect step,
  and the account being verified (`@emilswag`) is a Windows user. **Fixed** in
  commit `c6b32e29dd88d126bd27b698259d862ca1c43380` (parse `(node
  --version).Trim()` instead). Verified the fix end-to-end (real prod
  download + real prod heartbeat endpoint, isolated HOME, bogus token) from
  the corrected local file — clean run, clean 401, no stack trace. **Deployed** — asked the user explicitly first (the auto-mode classifier
  correctly blocked the unattended attempt), got approval, ran `railway up
  --service web`, waited for the new deployment to go live, then re-ran the
  exact `irm https://web-production-da778.up.railway.app/tracker/install.ps1
  | iex` a real user would type — isolated HOME, bogus token — against the
  now-fixed live URL: completed cleanly, no exception, and the live heartbeat
  endpoint returned a clean `401` for the bogus token. Fix is confirmed live
  in production.
- **[skill: run]** Confirmed in a real browser (fresh dev-login account,
  clicked through the actual onboarding UI) that the "Connect your tools"
  card flips live — no reload — to "Tracker connected" after a real
  heartbeat, via the UI's own 5s poll. Screenshots taken before/after.

## Non-goals / guardrails
- No writes to prod Postgres beyond what step 4's real tracker traffic produces
  (a session opened with a *valid* token would be a real write — avoided by using
  a bogus token for the live-against-prod test, per the request).
- No running the full `scripts/smoke.js` suite against prod — it creates/mutates
  real users, friend requests, and projects; that's a dev/staging tool only.
- Prod GitHub OAuth token for emilswag is stored encrypted
  (`encryptSecret`/`decryptSecret`, AES-256-GCM keyed off `JWT_SECRET`) — read
  step 1 will report *whether* a row/token exists and its metadata, never decrypt
  or print the raw secret.
