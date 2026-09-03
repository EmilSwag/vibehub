---
SECTION_ID: plans.vibehub_server_workstream
TYPE: plan
STATUS: in_progress
PRIORITY: high
---

# VibeHub — Server Workstream Implementation

GOAL: Implement Workstream 1 (Server) exactly per `docs/ARCHITECTURE.md` and
`docs/BUILD_PLAN.md` §4. Contracts are frozen — no deviation from documented
request/response shapes, data model, or the 6-step build order. Work confined to
`server/`; `docs/`, `web/`, `tracker/`, `macos/` are read-only.
TIMELINE: single session
ASSIGNEE: claude-server-agent

Templates checked before starting (mandatory skill-first workflow): `ToolGetTemplates`
for `developer` (type does not exist in this project), `skills: product`
(`product_create_prd` — PRD writer, not applicable), `skills: quadcode.ai`
(IDE-config/dynamic-UI/skill-authoring tools, not applicable). No template covers
writing Express/Prisma/WebSocket backend business logic → custom implementation,
per the "only if no skill matches" fallback. Every step below is tagged
`[skill: none]` for this reason unless a template becomes relevant.

## Task Checklist

### 0. Setup
- [x] Read ARCHITECTURE.md + BUILD_PLAN.md in full, read all scaffolded server/ files `[skill: none]`
- [x] Checked template catalog (developer/product/quadcode.ai types) — none apply `[skill: none]`

### 1. Data layer
- [x] `src/db.ts` — Prisma client selection between Postgres (`@prisma/client`) and
      SQLite (`generated/sqlite-client`) based on `DATABASE_PROVIDER` `[skill: none]`
- [ ] `prisma/seed.ts` — dev-login user + one `TrackerToken`, raw token printed to
      stdout (BUILD_PLAN §2.2) `[skill: none]`
- [ ] Add `db:generate:sqlite` package.json script for symmetry `[skill: none]`

### 2. Shared libs
- [x] `src/env.ts` — typed env accessor `[skill: none]`
- [x] `src/lib/http-error.ts` + `asyncHandler` wrapper + central error middleware `[skill: none]`
- [x] `src/lib/schemas.ts` — Zod schemas (username, bio, links, wall body, heartbeat
      body, enums as strings per §2.15 SQLite note) `[skill: none]`
- [x] `src/lib/serializers.ts` — public-safe User/Project/etc. shape builders (never
      leak `githubAccessToken`/`passwordHash`) `[skill: none]`
- [x] `src/lib/links.ts` — hostname → icon key detection map (§2.2) `[skill: none]`
- [x] `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt for `githubAccessToken` at
      rest, device-token hashing `[skill: none]`
- [x] `src/lib/json-field.ts` — cross-schema Json/String shim for `ActivityEvent.payload` `[skill: none]` (not in original plan, needed once dual-client divergence was discovered)

### 3. Auth
- [ ] `src/auth/jwt.ts` — sign/verify `vh_session` JWT (jti = AuthSession id) `[skill: none]`
- [ ] `src/middleware/auth.ts` — `requireAuth`, `optionalAuth`, `requireTrackerToken` `[skill: none]`
- [ ] `src/routes/auth.ts` — GitHub OAuth redirect+callback (state cookie CSRF guard),
      dev-login (gated on `DEV_LOGIN_ENABLED`), logout (revokes `AuthSession`), `me` `[skill: none]`

### 4. REST routes (ARCHITECTURE §5.2 → §5.8, in order)
- [ ] `src/routes/users.ts` — profile GET, PATCH me, avatar upload (multer, static
      `/uploads`), links PUT (replace-all + icon/order assignment), tracker-tokens
      POST/GET/DELETE `[skill: none]`
- [ ] `src/routes/friends.ts` — list, requests (incoming/outgoing), send/accept/decline,
      unfriend `[skill: none]`
- [ ] `src/routes/wall.ts` — cursor-paginated GET, POST (403 if not friends), DELETE
      (soft delete, author-or-owner) `[skill: none]`
- [ ] `src/routes/projects.ts` — CRUD + like/unlike (like count kept in one transaction) `[skill: none]`
- [ ] `src/routes/stats.ts` — per-user rollup + compare, `range=Nd` parsing `[skill: none]`
- [ ] `src/routes/presence.ts` — friends snapshot from live `Session` rows `[skill: none]`
- [ ] `src/routes/tracker.ts` — heartbeat ingestion, upsert-extend session logic (§4.3) `[skill: none]`

### 5. WebSocket (§5.9)
- [ ] `src/ws/hub.ts` — per-user socket registry + per-socket channel subscriptions `[skill: none]`
- [ ] `src/ws/index.ts` — upgrade auth via `vh_session` cookie, message routing,
      `presence:update` / `wall:new-comment` / `friend-request:incoming` emitters `[skill: none]`
- [ ] Wire emitters into tracker heartbeat, wall POST, friend-request POST `[skill: none]`

### 6. Background jobs
- [ ] `src/jobs/session-rollup.ts` — idle-timeout session close + `DailyStat` fold +
      `UserStreak` incremental update, in-process interval `[skill: none]`
- [ ] `src/jobs/archetype.ts` — nightly (UTC midnight) archetype recompute per §6
      thresholds, in-process scheduler `[skill: none]`

### 7. Integration
- [ ] Rewrite `src/index.ts` to mount all routers, WS server, jobs, uploads static dir `[skill: none]`
- [ ] Update `server/package.json` deps (multer) and scripts `[skill: none]`
- [ ] `npm install` + `tsc --noEmit` type-check pass inside `server/` `[skill: none]`

### 8. Verification
- [ ] Typecheck clean `[skill: none]`
- [ ] Manual smoke: sqlite migrate + seed + boot dev server + hit `/api/v1/health`,
      `/api/v1/auth/dev-login`, `/api/v1/auth/me` `[skill: none]`

## Success Criteria
- [ ] Every endpoint in ARCHITECTURE.md §5 implemented with the exact documented
      request/response shape
- [ ] WebSocket channel contract (§5.9) implemented
- [ ] Privacy invariants respected (no secrets leaked in public serializers)
- [ ] Only files under `server/` (+ this plan under `meta/`) touched
- [ ] `tsc --noEmit` passes; dev server boots and responds on `/api/v1/health`
