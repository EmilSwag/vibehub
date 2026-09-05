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
| coTools | Json? | round 6: latest `tools[]` seen open with this session (§4.3), `[{tool, model, projectAlias}]`, primary first. Presence only. `String?` (JSON-encoded) on the SQLite mirror — SQLite has no Json type, same divergence as `ActivityEvent.payload` (§2.15) |

A session closes (`status = ENDED`, `endedAt` set) when no heartbeat arrives for
**10 minutes** (`SESSION_IDLE_TIMEOUT_MS`, server-configurable), or immediately on a
`session_end` event. On close, its totals are folded into `DailyStat` (§2.10).
`model` is nullable (presence-only tools) and may be refined from `null` to a known
model in place while the session is open (§4.3). Index `(userId, lastHeartbeatAt)` —
presence and the tracker panel read the freshest session per user on every poll.

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

Index `(userId, occurredAt)` — `GET /users/me/tracker` scans a user's newest events
for `sources` (§5.2).

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
| lastUsedAt | DateTime? | bumped by every authenticated tracker call (`/tracker/verify`, heartbeats); `null` = never used |
| revokedAt | DateTime? | set by `DELETE /users/me/tracker-tokens/:id` or by `replaceUnused` on mint (§5.2) |
| createdAt | DateTime | |

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

**Model normalization.** `model` is `string | null`; `null` means the tool exposes no
model (presence-only tools). The strings `""`, `"unknown"` and `"<synthetic>"` (Claude
Code's own placeholder for locally generated turns) are sentinels and are normalized
to `null` at ingestion (`lib/sessions.ts` `normalizeModel`) — `Session.model` never
stores one, and presence/stats readers apply the same mapping to rows written before
this existed. This is what stopped "<synthetic>" from showing up on profiles as if it
were a model.

**Heartbeat v2 — per-source `usage[]`** (optional, backward compatible). The presence
tool (top-level `tool`/`model`, what the developer is *in*) is not always the only
thing producing tokens — a Codex log can grow while the user sits in Claude Code. A
v2 tracker therefore attaches precise attribution:

```json
{
  "eventType": "heartbeat",
  "projectAlias": "vibehub",
  "tool": "claude-code",
  "model": "claude-fable-5-1",
  "occurredAt": "2026-09-04T14:22:10.000Z",
  "tokensInputDelta": 812,
  "tokensOutputDelta": 340,
  "usage": [
    { "tool": "claude-code", "model": "claude-fable-5-1", "tokensInputDelta": 700, "tokensOutputDelta": 300 },
    { "tool": "codex",       "model": "gpt-5-codex",      "tokensInputDelta": 112, "tokensOutputDelta": 40 }
  ]
}
```

`usage` is at most 30 entries of `{ tool (1..60), model? (0..60 | null),
tokensInputDelta ≥ 0, tokensOutputDelta ≥ 0 }`. The top-level deltas are still sent
as the sum across all sources so servers that predate `usage` keep working. When
`usage` is present the server:

- folds each entry with a nonzero delta straight into today's `DailyStat` row for
  `(userId, day, model ?? "unknown", tool)` — tokens only, `activeSeconds` untouched
  (`foldUsageIntoDailyStat`), bumping the streak once;
- extends the open `Session` with **0** tokens and ignores the top-level deltas for
  token accounting, so nothing is counted twice when the session later folds;
- still derives presence (the open `Session`) from the top-level
  `projectAlias`/`tool`/`model`.

Each `usage[]` entry may also carry `estimated: true` — the counts were derived, not
reported. Quadcode chat logs contain no token numbers anywhere, so its adapter
estimates from character counts (§4.5). The server accepts the flag and echoes it into
the `ActivityEvent` payload; it does **not** change accounting. Anywhere those numbers
are shown — profile, `tracker status` — they must be labelled "est.". An estimate is
never presented as measured.

**Multi-tool presence — `tools[]`** (round 6, optional, backward compatible). People sit
in several terminals and IDEs at once, so a single "current activity" understates what
is open. A heartbeat may therefore carry:

```json
"tools": [
  { "tool": "quadcode",    "model": "claude-fable-5-1", "projectAlias": "vibehub" },
  { "tool": "cursor",      "model": null,               "projectAlias": "vibehub" },
  { "tool": "claude-code", "model": "claude-opus-5",    "projectAlias": null }
]
```

At most 10 entries, primary first (entry 0 always matches the top-level
`tool`/`model`), deduped by tool. `projectAlias` is `null` when unknown or when the
user hid that project — the tool still shows, its project name does not. This is
**presence only**: time and tokens still accrue solely to the primary. Steam semantics
— show everything open, credit the one being driven.

The server stores the latest list on the live `Session` (`coTools`, §2.8) and surfaces
it as `tools` on every presence read (§5.7, §5.9, and `GET /users/me/tracker`). A
heartbeat without `tools[]` leaves whatever the session already had; a session that
never received one reports `[activity]`, so a reader always has a non-empty list while
someone is online, and `[]` when offline.

Without `usage`, the legacy path is unchanged: the top-level deltas accrue on the
`Session` and reach `DailyStat` when it closes.

Response `200`:

```json
{ "sessionId": "clv...", "status": "ACTIVE" }
```

Server behavior: upsert-extend the open `Session` for `(userId, projectAlias, tool,
model)` if `lastHeartbeatAt` is within `SESSION_IDLE_TIMEOUT_MS`, else close the stale
one and open a new one. Every heartbeat also inserts one `ActivityEvent` row (§2.9)
whose payload mirrors what was *credited*: `tokensInputDelta`/`tokensOutputDelta` are
what went onto the Session (0 for v2 bodies) and `usage` (when present, models
normalized) is what went straight to `DailyStat`. On session close (timeout or explicit
`session_end`), the server folds the session's deltas into today's `DailyStat` row for
that `(userId, model, tool)` and, if the friend graph has active WebSocket subscribers,
pushes `presence:update` with `status: "offline"` for that activity.

**null → known model refinement.** Log-backed tools are usually detected by their
process before their session log has a model line, so the first heartbeats of a
session arrive with `model: null` and open a null-model `Session`; a beat or two
later the same `(projectAlias, tool)` arrives with a real model. If no open session
matches `(projectAlias, tool, model)` but a *live* one (within
`SESSION_IDLE_TIMEOUT_MS`) exists for `(projectAlias, tool, null)` and the incoming
model is non-null, the server sets that session's `model` in place and extends it as
usual — same `sessionId`, no `session_end`/`session_start` churn, no split in
`DailyStat`, no presence flicker. Logged once as
`[tracker] model refined null→<model> session=<id>`. A stale null-model session is
never refined — it closes under the `"unknown"` bucket it earned. The reverse
(known → null, e.g. a `"<synthetic>"` turn) is not a refinement: a null-model
heartbeat opens its own session, as before.

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

### 4.5 Quadcode AI adapter (estimated tokens)

Quadcode writes one JSONL per chat section, per project:

```
<QuadcodeAI root>/apps/<Project>/.quadcodeai/.data/chats/<section>.files/chat_N.jsonl
```

Roots: `%APPDATA%\QuadcodeAI` (Windows), `~/Library/Application Support/QuadcodeAI`
(macOS), `~/.config/QuadcodeAI` (Linux), plus `~/.quadcodeai`; `QUADCODE_HOME`
overrides. One JSON record per line: `method` `"USER"|"LLM"`, `message`, `timestamp`,
and `variations[].model_name` on LLM replies.

Three measured properties of that format shape the adapter (verified over 44 logs /
341 LLM records; full evidence in the round 6 plan's Amendment 1):

- **No token counts exist anywhere** — not in the record, not in `meta_info` (RAG
  metadata, whose `max_tokens` is a *boolean*), not in `cluster_node_info` (a node id).
  Tokens are therefore estimated at ~4 characters each and always carry
  `estimated: true` (§4.3).
- **The LLM record's `timestamp` is the turn start, not its end**, and the line is only
  appended when the turn finishes — one observed record spanned 3h47m. The *append* is
  the activity signal (the file's mtime), never the embedded timestamp. During a long
  turn nothing is appended, and the process adapter's presence-only observation
  (`genui.exe` / "Quadcode AI") carries presence instead.
- **`message` is ~99% embedded tool transcript** (`message_raw` is byte-identical). So
  `<TOOL_RESULT>` spans — tool output, not model output — are stripped before counting,
  while `<TOOL_RUN>` args are kept because the model wrote them. Counting the raw
  message overstated output by ~138x on the measured record.

`projectAlias` comes from the nearest git repository: the project folder if it is one,
else an enclosing repo, else the single repo directly inside it (so
`apps/Vibemunity` reports `vibehub`, agreeing with what every other adapter reports
from its cwd), else the folder name.

**Media generation is not model-tagged.** `model_name` only ever holds the chat model;
a media call names only a meta-section id, and the media model lives in a file on disk,
not in the log. Quadcode media work is tracked as activity under the chat model that
drove it.

Chat logs embed base64 image uploads inline and can be huge, so the tailer skips any
single append over 8 MB or record over 2 MB rather than reading it. Only the model,
project, timestamps and character counts ever leave the machine — never message text.

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
| POST | `/api/v1/users/me/tracker-tokens` | `{ label, replaceUnused? }` → `{ token, tokenId }` — raw token shown once; see "minted once" below |
| GET | `/api/v1/users/me/tracker-tokens` | → `{ tokens: [{ id, label, lastUsedAt, revokedAt, createdAt }] }` — newest first, revoked included, never the raw token |
| DELETE | `/api/v1/users/me/tracker-tokens/:id` | → `204` (sets `revokedAt`) |
| GET | `/api/v1/users/me/tracker` | → tracker status v2, below |

**Tracker tokens — minted once.** `POST /users/me/tracker-tokens` with
`replaceUnused: true` revokes (sets `revokedAt`) every token of the caller's that has
`lastUsedAt = null` and `revokedAt = null` *before* creating the new one, in one
transaction. The connect flow sends it, so a user who clicks "New token" three times
before the tracker ever ran ends up with one live token, not three — and never sees a
token in the list that the tracker would still accept but that they no longer have.
Tokens that have authenticated anything (`/tracker/verify` and every heartbeat bump
`lastUsedAt`) are real devices and are never touched. Without the flag (default
`false`) the route is purely additive; the response is identical either way.
`GET /users/me/tracker-tokens` returns every token, revoked ones included —
`lastUsedAt` (`null` = never used), `revokedAt` (`null` = live), `createdAt` — so the
web can show "unused / last seen … / revoked" without a second request; only the raw
token is withheld.

**`GET /users/me/tracker` (v2)** — "is my tracker actually talking to us, and is
everything I use being counted?" Drives the Connect-your-tools panel and is polled
every ~5s, so it is a fixed six queries regardless of history size.

```json
{
  "connected": true,
  "lastSeenAt": "2026-09-04T14:22:10.000Z",
  "activeTokens": 1,
  "tools": ["claude-code", "codex"],
  "tokenLastUsedAt": "2026-09-04T14:22:10.000Z",
  "heartbeatIntervalMs": 30000,
  "presence": {
    "status": "active",
    "activity": { "projectAlias": "vibehub", "tool": "claude-code", "model": "claude-fable-5-1", "startedAt": "…" }
  },
  "sources": [
    { "tool": "claude-code", "model": "claude-fable-5-1", "lastSeenAt": "…", "tokensToday": 12345, "tokens7d": 99999, "activeSecondsToday": 3600 },
    { "tool": "codex", "model": "gpt-5-codex", "lastSeenAt": "…", "tokensToday": 152, "tokens7d": 152, "activeSecondsToday": 0 }
  ],
  "devices": [ { "id": "clv…", "label": "MacBook Pro", "lastUsedAt": "…", "createdAt": "…" } ]
}
```

- `connected` — a heartbeat within `SESSION_IDLE_TIMEOUT_MS` (`presence.status !==
  "offline"`); `lastSeenAt` — last heartbeat of any kind (`Session.lastHeartbeatAt`,
  not `TrackerToken.lastUsedAt`, which `/tracker/verify` also bumps — see the route
  comment for the incident behind that). `tokenLastUsedAt` exposes the token signal
  separately. `tools` — tool ids seen in the last 30 days, most recent first (compat).
- `presence` — the same snapshot friends get (§5.7), minus `username`: `status`,
  `activity`, and the round 6 `tools` list. Note `presence.tools` (per-tool presence
  detail) is a different thing from the sibling top-level `tools` field below, which
  is a flat list of recently-seen tool ids kept for compatibility.
- `sources` — every `(tool, model)` pair seen in the last 7 days (today + 6 UTC days),
  most recently seen first. Totals come from `DailyStat` rows in the window plus open
  `Session`s (live tokens/elapsed not folded yet — the same "one place at a time"
  rule as §5.6, so nothing double counts); `lastSeenAt` from the newest 400
  `HEARTBEAT`/`SESSION_START` `ActivityEvent`s (presence pair and each `usage[]`
  entry) and recent `Session.lastHeartbeatAt`. `model` is `null` for presence-only
  tools (the `DailyStat` `"unknown"` bucket maps back to `null` here).
  `activeSecondsToday` is only ever credited to the presence pair — `usage[]`
  sources that never owned a Session report tokens but `0` seconds.
- `devices` — non-revoked tracker tokens, newest first.
- `heartbeatIntervalMs` — the tracker's cadence (§4.2), so the UI can render "one
  missed beat" rather than an absolute age.

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
| GET | `/api/v1/projects/:id` | → `{ project, owner, liked }` — public, or the owner's own private card |
| POST | `/api/v1/projects` | `{ name, description?, repoUrl?, liveUrl? }` → `{ project }` |
| PATCH | `/api/v1/projects/:id` | partial → `{ project }` |
| DELETE | `/api/v1/projects/:id` | → `204` |
| POST | `/api/v1/projects/:id/like` | → `{ likeCount }` |
| DELETE | `/api/v1/projects/:id/like` | → `{ likeCount }` |
| GET | `/api/v1/projects/:id/commits` | → `{ repo, commits[], lastPushAt, build, latestRelease }` — degrades to empty when GitHub is unreachable |
| GET | `/api/v1/projects/:id/repo?path=` | repo file browser, below |

**`GET /projects/:id/repo?path=<subpath>` (round 7)** — the project page's file browser:
one directory level of the linked GitHub repo's default branch, so a project with no
screenshots and no recent pushes still shows what the code *is*. Visibility gate is
identical to `GET /projects/:id` — a public project is browsable signed-out, a private
one is a 404 for everyone but its owner. Auth, timeout and caching are the
`/projects/:id/commits` pattern: the owner's refreshed OAuth token first (so a private
repo works for its owner), then `GITHUB_TOKEN`, then anonymous; 8 s per GitHub call;
10-minute cache per (repo, path, auth-or-anon).

```json
{
  "repo": { "owner": "expressjs", "repo": "express" },
  "defaultBranch": "master",
  "path": "",
  "entries": [
    { "name": "lib", "type": "dir", "size": null, "url": "https://github.com/expressjs/express/tree/master/lib" },
    { "name": "index.js", "type": "file", "size": 224, "url": "https://github.com/expressjs/express/blob/master/index.js" }
  ],
  "languages": [ { "name": "JavaScript", "share": 0.9987 } ],
  "readme": { "excerpt": "Fast, unopinionated, minimalist web framework for Node.js…", "url": "https://github.com/expressjs/express#readme" }
}
```

- `path` — the normalized subpath the listing is for; `""` is the repo root. Validated,
  not sanitized: no `..`, no empty segments, ≤ 200 chars, ≤ 20 segments, no control
  characters. A bad path is a `400` and never reaches GitHub.
- `entries` — directories first, then files, alphabetical (case-insensitive) within each
  group; capped at 300. `size` is bytes for files and `null` for directories (GitHub
  reports `0`, which would read as "empty"). `url` is the github.com page for the entry.
- `languages` / `readme` — repo-level, so they are returned **only** for `path=""` and
  are `null` for any subpath. `share` is a fraction of total bytes (0–1, 4 dp), biggest
  first. `readme.excerpt` is the first ~600 characters of the README with markdown
  syntax stripped — plain text, no links or images. Either may be `null` on its own (no
  README, or GitHub declined just that call) without failing the listing.
- **Errors, deliberately not degrading.** `/commits` may quietly return an empty list —
  the card still means something without it. An empty *file browser* would instead read
  as "this repo has no code", so: no GitHub repo linked (or a non-GitHub `repoUrl`) →
  `404`; repo or path missing → `404`; GitHub rate-limited, 5xx or unreachable → `503`
  `{ "error": "github_unavailable" }`, which the web renders as "GitHub is busy — open
  the repo" next to the repo link.

### 5.6 Stats

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/users/:username/stats?range=30d` | → `{ byModel[], topModel, totalTokens, totalActiveSeconds, streak, githubCommits[], rangeDays }` |
| GET | `/api/v1/users/:username/stats/compare?with=otherUsername&range=30d` | → `{ a: {...}, b: {...} }` (same shape as above, twice) |

`range` is `<n>d` (1–365, default `30d`) or **`all`** (round 7) — no lower bound at all,
for the lifetime "hrs on record" column on the profile's models block. `rangeDays`
echoes the resolved window and is `null` for `range=all`. Anything unparseable falls
back to `30d`.

Each `byModel` bucket is one `(tool, model)` pair:

```json
{ "tool": "claude-code", "model": "claude-fable-5-1", "tokensInput": 812000, "tokensOutput": 240000,
  "activeSeconds": 66240, "lastActiveAt": "2026-09-05T11:02:31.000Z" }
```

`lastActiveAt` (round 7, additive — older clients ignore it) is the newest moment that
pair was seen inside the range: the max over every contributing `DailyStat.date` (UTC
midnight — a rollup row has no finer "when") and every open `Session.lastHeartbeatAt`
(to the second). So a model in use right now sorts newest and reads as live, while a
model last used on Tuesday reports Tuesday's UTC midnight. It is `null` only for the
impossible case of a bucket with no contributing row.

### 5.7 Presence

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/presence/friends` | initial snapshot → `{ presences: [{ username, status, activity, tools }] }` — `tools` is the round 6 multi-tool list (§4.3), primary first, `[activity]` for sessions from an older tracker and `[]` when offline |

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
                "model": "claude-sonnet-5", "startedAt": "2026-09-03T13:40:00.000Z" },
  "tools": [ { "tool": "claude-code", "model": "claude-sonnet-5", "projectAlias": "neon-app" },
             { "tool": "cursor", "model": null, "projectAlias": "neon-app" } ] }

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
