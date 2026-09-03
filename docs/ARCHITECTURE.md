# VibeHub Architecture

VibeHub is a Steam-like social platform for AI-assisted developers: profiles, friends, a
privacy-safe live "what are you building right now" status, stats on tokens/time spent
per model, GitHub activity, and project cards friends can browse and like.

This document is the frozen contract every workstream in [BUILD_PLAN.md](./BUILD_PLAN.md)
builds against. It is design-complete; it contains no business logic implementation.

## 1. System Overview

```
                         ┌───────────────────────────┐
                         │        vibehub/web         │
                         │   React + Vite (browser)   │
                         └──────────────┬─────────────┘
                                REST (fetch) + WS
                                        │
┌───────────────┐   heartbeat POST   ┌──▼──────────────────────────┐
│ vibehub/tracker│───────────────────▶│         vibehub/server       │
│  (Node CLI,    │  Bearer device    │  Express API + WS + Prisma   │
│  runs on dev's │  token             │  Postgres (SQLite in dev)    │
│  machine)      │                    └──────────────┬───────────────┘
└───────┬────────┘                                    │
        │ writes                                       │ GitHub OAuth + REST
        ▼                                               ▼
 ~/.vibehub/status.json                          GitHub API (commits, profile)
        │ reads (local file, no network, no auth)
        ▼
┌────────────────┐
│  vibehub/macos  │  Swift menu-bar app — shows the tracker's current status only
└────────────────┘
```

Four independently buildable pieces, three network-shaped contracts between them
(server⇄web, tracker⇄server, tracker⇄macos). See BUILD_PLAN.md §Interfaces for the
exact boundary each parallel builder agent must respect.

## 2. Data Model

Postgres (SQLite in dev — see §6). All IDs are `cuid()` strings unless noted. All tables
have `createdAt`/`updatedAt` (`DateTime @default(now())` / `@updatedAt`) omitted below
for brevity except where semantically load-bearing.

### 2.1 User

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| username | String | unique, lowercase, `[a-z0-9-]{3,24}` |
| displayName | String | |
| email | String? | unique, nullable (dev-login accounts may lack one) |
| avatarUrl | String? | |
| bio | String? | max 500 chars, plain text (markdown deferred) |
| githubId | String? | unique — GitHub numeric user id as string |
| githubUsername | String? | |
| githubAccessToken | String? | encrypted at rest; used for commit sync only |
| passwordHash | String? | dev-login only, null for OAuth-only accounts |
| archetype | Archetype? | `CODER \| ARTIST \| DIRECTOR \| GENERALIST`, cached, recomputed nightly |
| archetypeComputedAt | DateTime? | |
| isDevAccount | Boolean | default false — flags dev-login seed accounts, hidden from prod archetype leaderboards |

Relations: `externalLinks[]`, `sentFriendRequests[]`, `receivedFriendRequests[]`,
`friendshipsA[]`/`friendshipsB[]`, `wallComments[]` (as author), `projects[]`,
`likes[]`, `sessions[]`, `activityEvents[]`, `dailyStats[]`, `githubCommitDays[]`,
`trackerTokens[]`.

### 2.2 ExternalLink

Profile links with auto-detected icons (GitHub, X/Twitter, LinkedIn, YouTube, Discord,
personal site, etc. — detected server-side from URL hostname against a static map,
falling back to a generic "link" icon).

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| userId | String | FK → User |
| url | String | |
| label | String? | user override; defaults to detected service name |
| icon | String | enum-like string, one of the known icon keys or `"generic"` |
| order | Int | display order, default 0 |

### 2.3 FriendRequest

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| senderId | String | FK → User |
| receiverId | String | FK → User |
| status | FriendRequestStatus | `PENDING \| ACCEPTED \| DECLINED \| CANCELED` |
| createdAt | DateTime | |
| respondedAt | DateTime? | |

Unique constraint on `(senderId, receiverId)` where `status = PENDING` is enforced at
the application layer (Postgres partial unique index in the migration, not expressible
in Prisma schema syntax directly — documented as a raw SQL migration step).

### 2.4 Friendship

Materialized, symmetric, created when a request is accepted. Always stored with
`userAId < userBId` (string comparison) so a pair has exactly one row.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| userAId | String | FK → User, lexicographically smaller id |
| userBId | String | FK → User |
| since | DateTime | used to compute "friends for N days" |

Unique constraint on `(userAId, userBId)`.

### 2.5 WallComment

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| wallOwnerId | String | FK → User — whose wall |
| authorId | String | FK → User — who wrote it |
| body | String | max 1000 chars |
| createdAt | DateTime | |
| deletedAt | DateTime? | soft delete — owner or author can delete |

Posting requires `wallOwnerId` and `authorId` to be friends (or the same user).

### 2.6 Project

Project cards on a profile.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| ownerId | String | FK → User |
| slug | String | unique per owner, url-safe |
| name | String | |
| description | String? | max 500 chars |
| repoUrl | String? | |
| liveUrl | String? | |
| coverImageUrl | String? | |
| isPublic | Boolean | default true |
| likeCount | Int | denormalized counter, default 0 |

Unique constraint on `(ownerId, slug)`.

### 2.7 Like

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| projectId | String | FK → Project |
| userId | String | FK → User |
| createdAt | DateTime | |

Unique constraint on `(projectId, userId)`. `Project.likeCount` is updated in the same
transaction as insert/delete (no background reconciliation job in MVP).

### 2.8 Session (tracker coding session)

A continuous span of coding activity in one project, with one tool and one model,
reconstructed server-side from heartbeats. This is **not** an auth/login session (see
§5.4 for auth).

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| userId | String | FK → User |
| projectAlias | String | local project/folder name, e.g. `"neon-app"` — never a path |
| tool | String | e.g. `"claude-code"`, `"cursor"`, `"codex"` — free-form, tracker-supplied |
| model | String | e.g. `"claude-sonnet-5"` — free-form, tracker-supplied |
| status | SessionStatus | `ACTIVE \| IDLE \| ENDED` |
| startedAt | DateTime | |
| lastHeartbeatAt | DateTime | |
| endedAt | DateTime? | set when closed by idle timeout or explicit `session_end` |
| tokensInput | Int | running total, default 0 |
| tokensOutput | Int | running total, default 0 |

A session closes (`status = ENDED`, `endedAt` set) when no heartbeat arrives for
**10 minutes** (`SESSION_IDLE_TIMEOUT_MS`, server-configurable), or immediately on a
`session_end` event. On close, its totals are folded into `DailyStat` (§2.10).

### 2.9 ActivityEvent

Raw, append-only log of every ingested tracker event — the source of truth `Session`
and `DailyStat` are derived from. Kept so aggregates can be recomputed if the rollup
logic changes.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| userId | String | FK → User |
| sessionId | String? | FK → Session, null for events not tied to a session (e.g. `git_commit`) |
| type | ActivityEventType | `HEARTBEAT \| SESSION_START \| SESSION_END \| GIT_COMMIT` |
| occurredAt | DateTime | client-supplied timestamp |
| receivedAt | DateTime | server clock, default now() |
| payload | Json | raw event body, shape depends on `type` — see §5.3 |

### 2.10 DailyStat

Per-user, per-day, per-model rollup. One row per `(userId, date, model)`.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| userId | String | FK → User |
| date | DateTime | truncated to UTC day |
| model | String | |
| tool | String | |
| tokensInput | Int | |
| tokensOutput | Int | |
| activeSeconds | Int | sum of session durations for this bucket |

Unique constraint on `(userId, date, model, tool)`.

### 2.11 UserStreak (cached)

| Field | Type | Notes |
|---|---|---|
| userId | String | PK, FK → User |
| currentStreak | Int | consecutive days with ≥1 `DailyStat` row |
| longestStreak | Int | |
| lastActiveDate | DateTime | UTC day |

Recomputed whenever a `DailyStat` row is written for "today" (cheap incremental check,
not a full recompute).

### 2.12 GithubCommitDay (cached GitHub sync)

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| userId | String | FK → User |
| date | DateTime | UTC day |
| commitCount | Int | |

Unique constraint on `(userId, date)`. Populated by a periodic sync job (or manual
"Sync now" button) hitting the GitHub REST API's commit search for the linked account;
never real-time.

### 2.13 TrackerToken

Device tokens the tracker CLI authenticates with — separate from user login sessions.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| userId | String | FK → User |
| tokenHash | String | SHA-256 of the token; raw token shown once at creation |
| label | String | user-supplied, e.g. `"MacBook Pro"` |
| lastUsedAt | DateTime? | |
| revokedAt | DateTime? | |

### 2.14 AuthSession (login sessions)

Kept separate from tracker `Session`. VibeHub uses stateless JWTs for the common case;
this table exists only to support **revocable** sessions ("log out everywhere").

| Field | Type | Notes |
|---|---|---|
| id | String | PK, also the refresh-token's jti |
| userId | String | FK → User |
| userAgent | String? | |
| createdAt | DateTime | |
| expiresAt | DateTime | |
| revokedAt | DateTime? | |

### 2.15 Enums

```
Archetype           = CODER | ARTIST | DIRECTOR | GENERALIST
FriendRequestStatus = PENDING | ACCEPTED | DECLINED | CANCELED
SessionStatus       = ACTIVE | IDLE | ENDED
ActivityEventType   = HEARTBEAT | SESSION_START | SESSION_END | GIT_COMMIT
```

> **SQLite dev fallback note**: SQLite has no native enum type. The dev schema
> (`server/prisma/schema.sqlite.prisma`) represents every enum above as `String`,
> validated at the application layer (Zod schemas shared between the two). See §6.

## 3. Privacy Model (why the data model looks like this)

- The tracker never transmits file contents, diffs, prompts, or commit messages —
  only `projectAlias` (a name, not a path), `tool`, `model`, token counts, and
  timestamps. This is enforced at the tracker level (§4) so there is nothing sensitive
  to leak even if the server were compromised.
- `projectAlias` defaults to the folder's basename but is user-remappable/hideable per
  project in `~/.vibehub/config.json` (e.g. map `client-acme-app` → `"a client project"`
  or mark it `"hidden"` to exclude it from presence entirely).
- Live presence (§4.3) is only pushed to accepted friends, never public.
- Stats are public per-user by default (Steam-like), but a user can set
  `statsVisibility: "friends" | "private"` (profile setting, not modeled as a separate
  table — a column on `User` added when the settings surface is built; out of scope for
  this scaffold).

## 4. Tracker Heartbeat Protocol

`vibehub/tracker` is a Node CLI (`vibehub-tracker`) that runs as a long-lived background
process on the developer's machine (started manually, or as a login item / launch
agent — packaging that is out of scope for this scaffold).

### 4.1 Local config & state files

| Path | Written by | Read by | Purpose |
|---|---|---|---|
| `~/.vibehub/config.json` | user / `vibehub-tracker login` | tracker | `{ apiUrl, deviceToken, projectAliases }` |
| `~/.vibehub/status.json` | tracker | **vibehub/macos** (and anything else local) | current status snapshot, see §4.4 |

`~/.vibehub/` is `0700`; `status.json` and `config.json` are `0600`.

### 4.2 Detecting activity

MVP detection is host-process based: the tracker polls the local process list every
`HEARTBEAT_INTERVAL_MS` (default 30000) for known coding-tool process names (configurable
list, e.g. `claude`, `cursor`, `code`) and reads the current working directory of the
most recently active one to derive `projectAlias` (basename of cwd, or the configured
alias override). Model name is read from the tool's own local session/log file when
available (tool-specific adapters — the exact adapter table is a builder-agent decision
documented in `tracker/README.md`); when unknown, `model` is sent as `"unknown"`.

No filesystem/tool activity for `IDLE_THRESHOLD_MS` (default 300000 = 5 min) → tracker
marks itself idle locally and stops sending heartbeats (server-side session then times
out per §2.8 after its own longer `SESSION_IDLE_TIMEOUT_MS`).

### 4.3 Wire format — `POST /api/v1/tracker/heartbeat`

Auth: `Authorization: Bearer <deviceToken>` (a `TrackerToken`, §2.13).

Request body:

```json
{
  "eventType": "heartbeat",
  "projectAlias": "neon-app",
  "tool": "claude-code",
  "model": "claude-sonnet-5",
  "tokensInputDelta": 812,
  "tokensOutputDelta": 340,
  "occurredAt": "2026-09-03T14:22:10.000Z"
}
```

`eventType` is one of `"heartbeat" | "session_start" | "session_end" | "git_commit"`.
`session_start`/`session_end` omit the token deltas. `git_commit` additionally carries
`{ "repoAlias": "neon-app" }` only — no commit hash, message, or diff.

Response `200`:

```json
{ "sessionId": "clv...", "status": "ACTIVE" }
```

Server behavior: upsert-extend the open `Session` for `(userId, projectAlias, tool,
model)` if `lastHeartbeatAt` is within `SESSION_IDLE_TIMEOUT_MS`, else close the stale
one and open a new one. Every heartbeat also inserts one `ActivityEvent` row (§2.9).
On session close (timeout or explicit `session_end`), the server folds the session's
deltas into today's `DailyStat` row for that `(userId, model, tool)` and, if the friend
graph has active WebSocket subscribers, pushes `presence:update` with `status: "offline"`
for that activity.

### 4.4 `~/.vibehub/status.json` (tracker ⇄ macOS contract)

Written atomically (temp file + rename) by the tracker on every state change — this is
the **only** interface `vibehub/macos` depends on; it never calls the server directly.

```json
{
  "status": "active",
  "projectAlias": "neon-app",
  "tool": "claude-code",
  "model": "claude-sonnet-5",
  "sessionStartedAt": "2026-09-03T13:40:00.000Z",
  "updatedAt": "2026-09-03T14:22:10.000Z"
}
```

`status` is `"active" | "idle" | "offline"`. When `"offline"`, the other fields are
`null` except `updatedAt`. The macOS app computes the human string itself, e.g.
`"in project neon-app · Claude Code · 1h 42m"`, from `sessionStartedAt`.

## 5. REST + WebSocket Contract

Base URL: `{VITE_API_URL}` (dev default `http://localhost:4000`). All endpoints are
prefixed `/api/v1`. All bodies are JSON; auth via `httpOnly` cookie `vh_session` (JWT)
for browser clients, or `Authorization: Bearer` for tracker device tokens on the
`/tracker/*` routes only.

### 5.1 Auth

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/auth/github` | redirects to GitHub OAuth |
| GET | `/api/v1/auth/github/callback` | sets `vh_session` cookie, redirects to web app |
| POST | `/api/v1/auth/dev-login` | `{ username }` → `{ user }` — **only when `DEV_LOGIN_ENABLED=true`** |
| POST | `/api/v1/auth/logout` | → `204` |
| GET | `/api/v1/auth/me` | → `{ user: User \| null }` |

### 5.2 Users & profile

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/users/:username` | → `{ user, links[], archetype, friendCount }` |
| PATCH | `/api/v1/users/me` | `{ displayName?, bio? }` → `{ user }` |
| POST | `/api/v1/users/me/avatar` | multipart file → `{ avatarUrl }` |
| PUT | `/api/v1/users/me/links` | `{ links: [{ url, label? }] }` (replace-all, server assigns `order`/`icon`) → `{ links[] }` |
| POST | `/api/v1/users/me/tracker-tokens` | `{ label }` → `{ token, tokenId }` — raw token shown once |
| GET | `/api/v1/users/me/tracker-tokens` | → `{ tokens[] }` (no raw token) |
| DELETE | `/api/v1/users/me/tracker-tokens/:id` | → `204` |

### 5.3 Friends

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/friends` | → `{ friends: [{ user, since, daysAsFriends }] }` |
| GET | `/api/v1/friends/requests` | → `{ incoming[], outgoing[] }` |
| POST | `/api/v1/friends/requests` | `{ targetUsername }` → `{ request }` |
| POST | `/api/v1/friends/requests/:id/accept` | → `{ friendship }` |
| POST | `/api/v1/friends/requests/:id/decline` | → `204` |
| DELETE | `/api/v1/friends/:username` | unfriend → `204` |

### 5.4 Wall

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/users/:username/wall?cursor=&limit=20` | → `{ comments[], nextCursor }` |
| POST | `/api/v1/users/:username/wall` | `{ body }` → `{ comment }` (403 if not friends) |
| DELETE | `/api/v1/wall/:commentId` | → `204` (author or wall owner only) |

### 5.5 Projects

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/users/:username/projects` | → `{ projects[] }` |
| POST | `/api/v1/projects` | `{ name, description?, repoUrl?, liveUrl? }` → `{ project }` |
| PATCH | `/api/v1/projects/:id` | partial → `{ project }` |
| DELETE | `/api/v1/projects/:id` | → `204` |
| POST | `/api/v1/projects/:id/like` | → `{ likeCount }` |
| DELETE | `/api/v1/projects/:id/like` | → `{ likeCount }` |

### 5.6 Stats

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/users/:username/stats?range=30d` | → `{ byModel[], topModel, totalTokens, totalActiveSeconds, streak, githubCommits[] }` |
| GET | `/api/v1/users/:username/stats/compare?with=otherUsername&range=30d` | → `{ a: {...}, b: {...} }` (same shape as above, twice) |

### 5.7 Presence

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/presence/friends` | initial snapshot → `{ presences: [{ username, status, activity }] }` |

### 5.8 Tracker ingestion

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/api/v1/tracker/heartbeat` | Bearer device token | see §4.3 |

### 5.9 WebSocket — `GET {VITE_WS_URL}` (dev default `ws://localhost:4000/ws`)

Auth: `vh_session` cookie read during the HTTP upgrade (browser only — the tracker
never opens a WS connection).

Client → server (subscribe on connect):

```json
{ "type": "subscribe", "channels": ["presence", "friend-requests"] }
```

Server → client events:

```json
{ "type": "presence:update", "username": "ada", "status": "active",
  "activity": { "projectAlias": "neon-app", "tool": "claude-code",
                "model": "claude-sonnet-5", "startedAt": "2026-09-03T13:40:00.000Z" } }

{ "type": "wall:new-comment", "wallOwner": "ada", "comment": { "...": "WallComment shape" } }

{ "type": "friend-request:incoming", "request": { "...": "FriendRequest shape" } }
```

Client subscribes to `wall:{username}` implicitly while viewing that profile by sending
`{ "type": "subscribe", "channels": ["wall:ada"] }`; server unsubscribes on disconnect.

## 6. Archetype Algorithm

Computed nightly (cron in the server process, no external scheduler in MVP) per user
over a trailing 30-day window, and cached on `User.archetype`.

Three raw signals per user, from `DailyStat` + `GithubCommitDay` + `Session`:

1. **`commitDensity`** = `githubCommits30d / activeHours30d` (commits per active hour)
2. **`autonomyRatio`** = `avg(tokensOutput / max(tokensInput, 1))` across sessions,
   weighted by session length — a proxy for "delegates large autonomous runs to an
   agent" vs. "tight interactive back-and-forth"
3. **`avgSessionMinutes`** = mean session length over the window

MVP uses fixed absolute thresholds (no cross-user normalization — deferred until there
is enough of a user base for z-scores to be meaningful):

```
if commitDensity >= 0.5 and autonomyRatio < 3.0:
    archetype = CODER
elif avgSessionMinutes >= 45 and autonomyRatio >= 3.0:
    archetype = DIRECTOR        # long, low-touch, high-output-ratio runs
elif <insufficient data OR no threshold cleared>:
    archetype = GENERALIST
```

`ARTIST` requires a signal this scaffold does not yet ingest (design/media-tool
usage — Figma, image/video generation tool time). It is reserved in the enum and
algorithm write-up now so the data model doesn't need a breaking migration later;
computing it is out of scope until a design-tool adapter exists in the tracker
(tracked as a BUILD_PLAN.md follow-up, not part of the MVP threshold logic above).
Until then `ARTIST` is never assigned by the algorithm but remains user-visible as a
concept (e.g. a manually-set badge is a reasonable stopgap a builder agent may add).

Users with < 3 days of `DailyStat` history in the window are always `GENERALIST`
(not enough signal).

## 7. Monorepo Layout

```
vibehub/
├── docs/
│   ├── ARCHITECTURE.md        (this file)
│   └── BUILD_PLAN.md
├── server/                    Express + Prisma API + WS
├── web/                       React + Vite SPA
├── tracker/                   Node CLI, published as `vibehub-tracker`
├── macos/                     Swift menu-bar app (SwiftPM)
├── assets/branding/           logo.png, icon.png, banner.png (done — see plans.vibehub-branding)
├── package.json                root npm workspaces (server, web, tracker)
├── docker-compose.yml          local Postgres for dev
├── .gitignore
└── README.md
```

`macos/` is intentionally excluded from the npm workspace — it is a separate Swift
Package Manager project.

## 8. Deploy Target (Railway)

- `server` and `web` deploy as two separate Railway services, each with **Root
  Directory** set to `vibehub/server` / `vibehub/web` respectively (Railway's Nixpacks
  builder auto-detects Node from `package.json`).
- Railway's Postgres plugin provides `DATABASE_URL` directly to the `server` service.
- `web` is a static Vite build served in production by `serve` (a regular dependency,
  not `npx`'d at container start) via `npm run start`, per its `Dockerfile`/`railway.json`.
- `tracker` and `macos` are developer-machine software, never deployed to Railway.

Full step-by-step Railway setup (env vars per service, build/start commands) is a
BUILD_PLAN.md deliverable per workstream, not duplicated here.
