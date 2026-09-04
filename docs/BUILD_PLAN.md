# VibeHub Build Plan

Four independent workstreams for parallel builder agents. Each agent works only inside
its own folder. **The contracts in §2 are frozen** — treat them as the API between
agents; changing one requires updating this file first, since another agent may already
be coding against it.

Full context (data model, algorithm, full request/response shapes): [ARCHITECTURE.md](./ARCHITECTURE.md).
This file only restates what a workstream needs to avoid touching the others.

## 1. Workstreams

| # | Workstream | Folder | Owns |
|---|---|---|---|
| 1 | Server | `vibehub/server` | Express API, WebSocket, Prisma/DB, GitHub OAuth, all business logic |
| 2 | Web | `vibehub/web` | React + Vite SPA — every user-facing screen |
| 3 | Tracker | `vibehub/tracker` | Node CLI `vibehub-tracker` — heartbeats + local status file |
| 4 | macOS | `vibehub/macos` | Swift menu-bar app — reads the tracker's local status file only |

None of the four needs another to compile or start. Web can build fully against the
documented REST/WS shapes with mocked responses; the tracker can build against the
heartbeat contract with a manually-seeded dev token; macOS only ever touches a local
JSON file it doesn't produce.

## 2. Interfaces (the only things that must not drift)

### 2.1 Server ⇄ Web — REST + WebSocket

- Base URLs come from env, never hardcoded: `VITE_API_URL`, `VITE_WS_URL`.
- Every endpoint, request/response JSON shape: ARCHITECTURE.md §5.
- Auth: `httpOnly` cookie `vh_session`, `credentials: "include"` on every fetch.
- Web must treat every list response as `{ items_key: [...], ...pagination? }` and
  every mutation as returning the updated resource, per §5 — no ad hoc shapes.

### 2.2 Server ⇄ Tracker — heartbeat ingestion

- One endpoint: `POST /api/v1/tracker/heartbeat`, `Authorization: Bearer <deviceToken>`.
- Exact body/response: ARCHITECTURE.md §4.3.
- **Dev-time token, so tracker work never blocks on web's Settings UI existing**: seed
  a `TrackerToken` directly via `server/prisma/seed.ts` (`npm run db:seed` inside
  `server/`) and print the raw token to stdout. The tracker workstream uses that value
  in its own local `~/.vibehub/config.json` for manual testing.

### 2.3 Tracker ⇄ macOS — local status file

- Tracker writes, macOS only reads: `~/.vibehub/status.json`.
- Exact schema: ARCHITECTURE.md §4.4.
- Path is platform-appropriate `$HOME/.vibehub/status.json`; macOS reads it via
  `FileManager` + a `DispatchSourceFileSystemObject` watch (or simple polling every 5s
  for MVP — builder's call, document the choice in `macos/README.md`).
- macOS never talks to the server directly and never needs a device token.

### 2.4 Web ⇄ macOS

None. The menu bar app's only cross-cutting action is "Open Dashboard," which opens
`WEB_APP_URL` (a hardcoded/config value, e.g. `https://vibehub.app` or
`http://localhost:5173` in dev) in the default browser. No shared code, no shared types.

## 3. Ports & Env Vars

| Service | Dev port | Env vars |
|---|---|---|
| server | `4000` | `PORT=4000`, `DATABASE_URL`, `DATABASE_PROVIDER=postgresql\|sqlite`, `JWT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `DEV_LOGIN_ENABLED=true\|false`, `CORS_ORIGIN` (web's origin), `SESSION_IDLE_TIMEOUT_MS=600000` |
| web | `5173` (Vite default) | `VITE_API_URL=http://localhost:4000`, `VITE_WS_URL=ws://localhost:4000/ws` |
| tracker | n/a (local process) | none via env — config lives in `~/.vibehub/config.json` (`apiUrl`, `deviceToken`, `projectAliases`); `HEARTBEAT_INTERVAL_MS`/`IDLE_THRESHOLD_MS` optional overrides in the same file |
| macos | n/a (local process) | none — reads `~/.vibehub/status.json`; `WEB_APP_URL` is a build-time constant, overridable via `defaults write` for local testing |
| postgres (local dev, `docker-compose.yml`) | `5432` | `POSTGRES_USER=vibehub`, `POSTGRES_PASSWORD=vibehub`, `POSTGRES_DB=vibehub` |

## 4. Workstream 1 — Server

**Stack**: Express, Prisma, `ws` (raw WebSocket, not Socket.IO — one dependency, matches
the plain-JSON contract in ARCHITECTURE.md §5.9), Postgres in prod / SQLite in dev.

**Scaffolded already** (this session): `package.json`, `tsconfig.json`,
`prisma/schema.prisma` (Postgres, full data model from ARCHITECTURE.md §2),
`prisma/schema.sqlite.prisma` (same models, enums flattened to `String` — SQLite has no
native enum type), `src/index.ts` (boots Express, health check, no routes), `.env.example`,
`Dockerfile` + `.dockerignore` (multi-stage Node 20-alpine build, `openssl` installed for
Prisma's query engine), `railway.json` (Dockerfile builder, `healthcheckPath:
/api/v1/health`, start command runs `prisma migrate deploy` before boot).

**Not scaffolded — build order for the agent**:
1. Prisma migrate + seed script (`prisma/seed.ts`) — creates one dev-login user and one
   `TrackerToken` for the tracker workstream to consume (§2.2).
2. Auth middleware (JWT cookie) + GitHub OAuth routes + dev-login route.
3. REST routes per ARCHITECTURE.md §5.2–§5.8, in that order (profile before friends
   before wall/projects before stats before tracker ingestion).
4. WebSocket server on the same HTTP server at `/ws`, channel subscription per §5.9.
5. Session-close + `DailyStat` rollup job (can be a `setInterval` in-process for MVP —
   no external job queue needed at this scale).
6. Nightly archetype recompute (ARCHITECTURE.md §6) — same in-process cron approach.

**SQLite dev fallback — how it actually works**: Prisma cannot target two providers
from one schema file at generate time. `npm run db:dev` (SQLite) and
`npm run db:migrate` (Postgres) point the Prisma CLI at the two different schema files
via `--schema`. Keep both schemas' models in lockstep by hand — this is a scaffold-time
tradeoff, not a hidden footgun (documented here so no builder agent "fixes" it into a
single dynamic schema, which Prisma does not support cleanly for SQLite/Postgres type
differences like native enums).

**Schema drift (dev) — re-generate after every pull.** After pulling or editing anything
under `server/prisma/`, run `npm run db:generate --workspace server` *and*
`npm run db:dev --workspace server` before starting the server (Postgres:
`db:migrate`). A `dev.db` or generated client that lags the schema does not fail at
boot — `/api/v1/health` stays green — it fails at query time as HTTP 500s
(`no such column` / unknown field), which is exactly how the nullable-`model` change
surfaced. Additive Postgres migrations that can't be generated here (no Postgres in
dev) are hand-written under `server/prisma/migrations/<timestamp>_<name>/migration.sql`
using Prisma's own index/constraint names (e.g. `sessions_userId_lastHeartbeatAt_idx`)
so `prisma migrate diff` stays clean; `CREATE INDEX IF NOT EXISTS` keeps them
re-runnable. Note: on Windows `db:generate` cannot overwrite the SQLite query-engine
DLL while `npm run dev:server` has it loaded — stop the server first, or move the
loaded DLL aside.

## 5. Workstream 2 — Web

**Stack**: React 18, Vite, no CSS framework — hand-rolled CSS custom properties for the
strict monochrome design system (already scaffolded, see below). React Router for
navigation, native `fetch`/`WebSocket` (no client library) to keep the contract in
ARCHITECTURE.md §5 as the only source of truth.

**Scaffolded already**: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`,
`src/main.tsx`, `src/App.tsx` (placeholder route), `src/styles/tokens.css` (the full
monochrome token set — grayscale only, light + dark via `prefers-color-scheme`),
`.env.example`, `Dockerfile` + `.dockerignore` (builds the Vite bundle, then serves
`dist/` in production via `serve`, a regular dependency — `npm run start`), `railway.json`
(Dockerfile builder, healthcheck on `/`).

**Not scaffolded — build order for the agent**:
1. Auth screens (GitHub OAuth button + dev-login form gated behind
   `import.meta.env.DEV`), `AuthContext` reading `/api/v1/auth/me`.
2. Profile page: avatar, bio, external links (render the icon key from §2.2 via a small
   static icon map), wall.
3. Friends: request list, "friends for N days" (compute client-side from `since`).
4. Live presence: WebSocket client subscribing to `presence`, rendering
   `"in project {alias} · {tool} · {elapsed}"` exactly as specified in ARCHITECTURE.md §4.4
   — never render anything the server didn't send (no client-side guessing of activity).
5. Project cards grid + like button (optimistic update, reconcile with response).
6. Stats page + friend-compare view, archetype badge (four fixed monochrome glyphs, one
   per `Archetype` enum value — no per-user color coding, that would break "strict
   monochrome").

**Design tokens contract**: `src/styles/tokens.css` defines `--vh-bg`, `--vh-surface`,
`--vh-surface-2`, `--vh-border`, `--vh-text`, `--vh-text-dim`, `--vh-text-faint`,
`--vh-invert-bg`/`--vh-invert-text` (for the one deliberate inversion — e.g. a primary
button), `--vh-focus-ring`. All values are grayscale (`hsl(0 0% L%)`); no hue is ever
introduced by any component — enforce this in review, not just at token-definition time.

## 6. Workstream 3 — Tracker

**Stack**: Node, TypeScript, `commander` (CLI parsing) — no other runtime dependency
needed for MVP polling-based detection.

**Scaffolded already**: `package.json` (`bin: { "vibehub-tracker": "./dist/index.js" }`),
`src/index.ts` (CLI stub: `login`, `start`, `status` subcommands wired to no-ops),
`.env.example` (documents `~/.vibehub/config.json` shape instead of real env vars, since
the tracker is a long-running local process, not a 12-factor service).

**Not scaffolded — build order for the agent**:
1. `vibehub-tracker login <deviceToken>` — writes `~/.vibehub/config.json`.
2. Process-list polling adapter (per-OS: `ps`/`tasklist`) detecting configured tool
   process names; cwd → `projectAlias` resolution with the alias/hide override table.
3. Heartbeat loop: POST per ARCHITECTURE.md §4.3 every `HEARTBEAT_INTERVAL_MS`; idle
   detection per §4.2.
4. Atomic writer for `~/.vibehub/status.json` (§4.4) — write to a temp file in the same
   directory, then `rename()`, so the macOS reader never sees a half-written file.
5. `vibehub-tracker status` — pretty-prints the current `status.json` for local debugging.

**Privacy invariant the agent must not break**: no field ever sent to the server or
written to `status.json` may contain file paths, file contents, diffs, or prompt text —
only `projectAlias` (a name), `tool`, `model`, counts, and timestamps. This is the whole
reason `status.json` and the heartbeat body share the same minimal vocabulary.

## 7. Workstream 4 — macOS

**Decision: Swift (SwiftPM executable target, AppKit `NSStatusItem`) over Python
+ `rumps`.**

Justification:
- End-user distribution matters for an open-source "companion app" — a signed,
  notarizable `.app` with zero runtime dependency beats asking every user to have
  Python + `pip install rumps` (+ `pyobjc`) working. `rumps` apps are realistically
  shipped via `py2app`, which is more fragile to package/notarize than a native
  SwiftPM/Xcode build.
- Tighter integration with the things a menu-bar app actually needs: `NSStatusItem`,
  launch-at-login (`SMAppService`), sandboxing — all first-class in Swift/AppKit,
  bolted-on in `rumps`.
- The app's job is trivial (poll/watch one local JSON file, render text in a status
  item, one "Open Dashboard" action) — Swift's extra setup cost is paid once and is
  small relative to the distribution win.
- Counter-consideration (why one might pick `rumps` instead): faster to prototype and
  no Xcode/macOS-toolchain requirement for contributors without a Mac dev setup. Not
  chosen here because VibeHub is macOS-only for this component anyway — contributors
  without a Mac can't test it either way — and the project already needs a "real app"
  distribution story, not a throwaway script.

**Scaffolded already**: `Package.swift` (executable target `VibeHubMenuBar`, macOS 13+
platform floor), `Sources/VibeHubMenuBar/main.swift` (stub: creates an `NSStatusItem`
with static placeholder text, no file reading yet), `README.md` (this justification +
build instructions: `swift build` / `swift run`, no Xcode project required for
development; packaging as a distributable signed `.app` is a follow-up, not required to
iterate locally).

**Not scaffolded — build order for the agent**:
1. Read `~/.vibehub/status.json` on launch; render per ARCHITECTURE.md §4.4.
2. File-watch (`DispatchSource` on the file descriptor) or 5s poll timer — pick one,
   document the choice, no server dependency either way.
3. Menu: current status line (disabled/label item), "Open Dashboard" → `WEB_APP_URL`,
   "Quit".
4. Optional follow-up (not MVP): launch-at-login toggle via `SMAppService`.

## 8. What Is Explicitly Out of Scope for This Scaffold

- No implemented auth, no implemented DB queries, no implemented WebSocket handlers —
  manifests and stubs only, per the design brief.
- No CI config, no test setup. Both `server/` and `web/` have `Dockerfile` +
  `.dockerignore` + `railway.json` scaffolded (§4, §5) — each Railway service's Root
  Directory must point at its respective folder (ARCHITECTURE.md §8).
- `ARTIST` archetype detection (needs a design-tool tracker adapter that doesn't exist
  yet — ARCHITECTURE.md §6).
- Account/profile settings for `statsVisibility` (mentioned in ARCHITECTURE.md §3 as a
  future column, not part of the MVP `User` fields scaffolded in Prisma).
