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
- Live presence (§4.3) — what someone is doing right now (project, tool, model, open
  tools) — is only pushed to accepted friends, never public. The *coarse* part is public
  since round 20 (PO decision): `GET /users/:username` carries `presence: { status,
  lastSeenAt }`, so any signed-in visitor sees "Online" / "Last online 2h ago" on a
  profile, but never the project name or the stack.
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
| `~/.vibehub/config.json` | user / `vibehub-tracker login` | tracker | `{ apiUrl, deviceToken, projectAliases, attestedMetadata? }` |
| `~/.vibehub/status.json` | tracker | **vibehub/macos** (and anything else local) | current status snapshot, see §4.4 |
| `~/.vibehub/attested.jsonl` | a separate, user-installed producer | tracker (read-only, and only while opted in) | attested metadata inbox, see §4.6 |

`~/.vibehub/` is `0700`; `status.json` and `config.json` are `0600`.

### 4.2 Detecting activity (AI-only)

Shipped detection is log-adapter based, not host-process based: the tracker polls every
`HEARTBEAT_INTERVAL_MS` (default 30000) and reads only newly appended, recognized
session-log records from supported AI tools — currently Claude Code and Codex only (see
`tracker/README.md` and `meta/facts/vibehub-ai-only-privacy.md`). The active detector
(`tracker/src/detector.ts`) wires in only these two log adapters; there is no generic
process/window enumeration, foreground-app polling, editor presence or Git probing in
the collection path. `projectAlias` comes from a bounded hint on the log's own `cwd`
field (basename, or the configured alias override), never from scanning the filesystem
or asking the OS what is open. Model name is read from the tool's own log records when
available; unrecognized or absent models are normalized to `model: null` (§4.3), not the
string `"unknown"`.

No supported-source activity for `IDLE_THRESHOLD_MS` (default 300000 = 5 min) → tracker
marks itself idle locally and stops sending heartbeats (server-side session then times
out per §2.8 after its own longer `SESSION_IDLE_TIMEOUT_MS`).

`tracker/src/adapters/processes.ts` still exists, but **only as an inert compatibility
stub** — `poll()` returns `[]` and it performs no filesystem or process operation at
all. The host-inventory adapter that filename once held was **removed**, not merely
unwired: there is no window/title reader anywhere in `tracker/src`, and the retired
content helpers `estimateTokens()` / `stripToolResults()` still return `0` and `""` so
a chat body can never become a token count.

`adapters/quadcode.ts` is **no longer a stub**: as of Round 4 it is a live log adapter
reporting activity and model with tokens permanently unknown (§4.5). It brings its own
bounded reader — `JsonlTailer` stays pinned to the two `~/.claude` / `~/.codex` layouts,
whose path rules reject the dots in `.quadcodeai` by design. §4.6 covers the separate,
explicitly opt-in receiver.

Each adapter may speak only for its own tool id. The origin fence is an exact
`tool === adapter.name` match rather than a category test, because `quadcode` is both
natively collected and receiver-eligible, so "is it a native tool" no longer separates
anything — a category rule would have let the Claude adapter assert Quadcode activity.

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
reported. **No current tracker ever sets it.** It existed for the Quadcode
character-count estimator, which has been removed (§4.5); the tracker's outgoing
projection now *rejects* any usage entry carrying the flag, and the opt-in receiver
(§4.6) refuses a record that so much as mentions it. The server still accepts and
echoes the flag so an older tracker is not rejected mid-heartbeat, and it has never
changed accounting. Anywhere such numbers are shown — profile, `tracker status` — they
must be labelled "est.". An estimate is never presented as measured, and usage that
cannot be measured is reported as unknown rather than estimated or zeroed.

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

### 4.5 Quadcode AI — native activity and model, never tokens

**Round 4 (PO decision): Quadcode is collected natively.** `tracker/src/detector.ts`
constructs `QuadcodeAdapter` alongside `ClaudeCodeAdapter` and `CodexAdapter`, under the
same local-read contract: transcript bytes are parsed locally, and only bounded metadata
leaves. It reports **activity and model. It never reports tokens.**

What changed is *not* the evidence — the two dating failures below are unchanged and
still decisive — but what the tracker does about them. Rather than derive an instant
from an undateable record, the adapter **observes the append**: the daemon is running,
holds a byte offset into the chat file, and a complete LLM line appears past that
offset. The moment it is seen is the moment reported, bounded by the poll interval.
This is tied to a specific completed assistant record, not to a file being touched, and
it is what §4.2's ban on mtime-as-activity excludes. First sight primes at EOF, so a
turn that finished while the tracker was not running is never counted or re-billed.

The record's own `timestamp` is still read, for exactly one purpose: discarding turns
whose start is more than 24 h old. For that day-scale filter the log's local time is
read as this host's local time, which is sound because the same machine wrote it. It
never becomes a reported instant, so no UTC offset is ever guessed for anything that
leaves the machine.

Roots are the platform app-data directory only, derived from the home directory:
`%USERPROFILE%\AppData\Roaming\QuadcodeAI` (Windows),
`~/Library/Application Support/QuadcodeAI` (macOS), `~/.config/QuadcodeAI` (Linux).
`APPDATA`/`XDG_CONFIG_HOME` are deliberately **not** consulted — an environment variable
that relocates a collector is an unreviewed escape hatch, and in a sandboxed child it can
still point at a real profile after HOME was redirected. `QUADCODE_HOME` follows the
`CLAUDE_CONFIG_DIR` rule: it may name the real root and nothing else, or the source is
unavailable. A non-default install is simply not found, which is the safe failure.

De-duplication is a **local fingerprint** over bounded metadata (project, chat file,
turn-start stamp, model, variation index), not a record id — the format has none. It is
weaker than Claude's `message.id` digest and is documented as such: two LLM records in
one chat sharing a microsecond stamp, model and variation index would count once. It
exists to make a re-prime idempotent, not to identify a turn.

The dating evidence that forced this design, unchanged:

The decisive test is narrow: **does the documented schema prove a dated AI request or
response?** It does not, for two independent reasons, and everything else follows.

1. **The timestamps carry no timezone.** They are local ISO strings
   (`2026-09-05T21:18:11.752000`). That is not an instant until someone assumes the
   host's current UTC offset — an assumption that is simply wrong across a DST
   boundary or for a log written in another zone. `tracker/src/privacy.ts`'s
   `eventTime()` requires a `Z` or `±HH:MM` suffix and rejects these outright rather
   than repairing them.
2. **An LLM record's timestamp is the turn start, not the reply.** The line is
   appended only once the turn ends, and one measured record spanned 3h47m. So nothing
   *inside* the file dates the response; the only thing that would is the moment the
   line was appended — a filesystem mtime signal, which this collector does not treat
   as AI evidence (§4.2). The USER record's own stamp is appended at send time, but a
   request is not a response, and its trustworthiness is an inference about write
   ordering rather than something the content sweep measured.

Consequently the tracker reports **Quadcode activity and model, and no Quadcode usage
whatsoever**. `quadcode` is listed in `TOKENLESS_TOOLS`, so `projectUsage()` rejects any
usage entry naming it rather than zeroing it, the server's `usageEntrySchema` refuses
one too, and a heartbeat whose only source is Quadcode **omits** `tokensInputDelta` /
`tokensOutputDelta` entirely — absent, not `0`, because a zero would be booked as a
measurement that came back empty. `/users/me/tracker` carries `activity.tokens: null`
for the same reason. The opt-in receiver (§4.6) remains available for a producer that
genuinely measured a turn; today `quadcode` is its only consentable tool and is
tokenless, so that measured path is implemented and unreachable until a tool with a
real counter joins `ATTESTED_TOOLS`.

Quadcode writes one JSONL per chat section, per project:

```
<QuadcodeAI root>/apps/<Project>/.quadcodeai/.data/chats/<section>.files/chat_N.jsonl
```

One JSON record per line: `method` `"USER"|"LLM"`, `message`, `timestamp`, and
`variations[].model_name` on LLM replies. Only `method`, `timestamp`,
`is_status_message`, `variation_index` and `variations[].model_name` are consulted;
`message` and `name` are never read out of the parsed line, stored or forwarded. Only an
LLM record that is not a status message counts — a USER line is a request, not a reply.

> **Unverified against a live install.** This path layout comes from the round-6 sweep
> recorded in prose, and the surviving fixture
> (`tracker/scripts/local-quadcode-check.ts`) pins only the *record shape*, not the
> directory tree. The adapter is written to the documented layout and is exercised
> against synthetic fixtures; it has not been confirmed to match a real Quadcode
> installation, and if the tree differs it will simply find nothing.

Three properties of that format were measured over 44 logs / 341 LLM records (full
evidence in the round 6 plan's Amendment 1). They are recorded here as findings about
the file, not as a description of any shipped behaviour:

- **No token counts exist anywhere** — not in the record, not in `meta_info` (RAG
  metadata, whose `max_tokens` is a *boolean flag*), not in `cluster_node_info` (a node
  id). There is therefore no measured Quadcode usage to read. The round-6 answer was a
  ~4-characters-per-token estimate flagged `estimated: true`; that estimator has been
  **removed**, and derived counts are now rejected by the outgoing projection (§4.3).
  Quadcode usage is unknown, and unknown is what gets reported — never an estimate, and
  never a zero standing in for one.
- **The LLM record's `timestamp` is the turn start, not its end**, and the line is only
  appended when the turn finishes — one observed record spanned 3h47m. Round 6 used the
  file's *mtime* as the activity signal, with a `genui.exe` process sighting carrying
  presence through long turns. The process sighting remains barred outright: it is host
  observation, not AI evidence. Round 4 does **not** revive the mtime signal either —
  it observes the append of a specific completed LLM record while holding a byte
  offset, which is why a touched file, a truncation or a rotation produce nothing.
  Note that the premise "the line is appended only once the turn ends" is carried from
  the round-6 prose and has not been re-measured; the whole dating design rests on it.
- **`message` is ~99% embedded tool transcript** (`message_raw` is byte-identical), and
  base64 image uploads are inlined, so records reach megabytes. Counting the raw message
  overstated output by ~138x on the measured record. Nothing in this repo parses these
  bodies any more.

**Media generation is not model-tagged.** `variations[].model_name` only ever holds the
chat model; a media call names only a meta-section id, and the media model lives in a
file on disk, not in the log. So even a perfect reader could not attribute media work to
the model that did it.

**The one reliable field is `variations[].model_name`.** Of the seven values observed,
five are already in the reviewed allowlists; `grok-4.6` and `gemini-3.5-flash` are not,
and are deliberately **not** added — an unreviewed id normalizes to `null` (§4.3)
rather than becoming an allowlist entry with no pricing evidence behind it.

`tracker/scripts/local-quadcode-check.ts` keeps this schema as an executable record and
demonstrates both dating failures without reading any real log.

### 4.6 Opt-in attested metadata receiver (`attested-metadata-v1`)

For a tool the collector cannot honestly read, the tracker can **receive** metadata a
separate, user-installed producer already knows — instead of guessing at it. This is a
receiver, never a producer: it discovers nothing, derives nothing, and with the switch
off it opens no file descriptor at all.

**Consent is explicit and lives in `~/.vibehub/config.json`:**

```json
{ "attestedMetadata": { "enabled": true, "tools": ["quadcode"] } }
```

Absent or `enabled: false` means the receiver is never constructed. Only receiver-only
tool ids may be listed — a natively supported tool must come from its own log adapter,
so no producer can assert Claude Code or Codex activity by writing a file. Malformed
consent invalidates the whole config (collection pauses) rather than silently
downgrading. The setting is part of `configFingerprint`, so granting or withdrawing it
re-fences collected state, and `refreshConfig` applies a change on the next tick without
a restart. `StatusFile.attestedReceiver` reports whether it is live; `collectionPolicy`
stays `ai-session-metadata-v1`, whose guarantee is unchanged while the switch is off.

**The producer appends JSONL to `~/.vibehub/attested.jsonl`.** The tracker only ever
reads that file: it never creates, writes, rotates, chmods or deletes it.

```json
{ "v": 1, "tool": "quadcode", "recordId": "turn-7f3a",
  "occurredAt": "2026-09-19T12:04:31.000Z", "model": "claude-fable-5-1",
  "projectHint": "vibehub", "measured": true,
  "tokensInputDelta": 391, "tokensOutputDelta": 120 }
```

Every rule below fails closed — a record that does not satisfy it is dropped, never
coerced:

- `occurredAt` must be a real instant carrying `Z` or `±HH:MM`. A local timestamp with
  no zone — exactly what Quadcode's own logs hold (§4.5) — is rejected and never
  repaired by assuming the host offset. This is what makes "dated" structural.
- Records outside the active window, or in the future beyond the existing skew bound,
  are dropped; timestamps are not clamped into range.
- `estimated` may not appear **at all**, in either polarity, so a derivation cannot be
  smuggled in under a measured claim.
- Token counts are accepted **only** under `measured: true`, and only as safe
  non-negative integers. Without that claim the counts must be absent entirely and the
  record contributes activity and model with `usage: []` — usage stays unknown rather
  than becoming a zero that reads as "nothing spent".
- `model` runs through the same allowlist as every other source; an unreviewed id
  becomes `null`. No id is added on a receiver-only tool's behalf.
- `projectHint` is a bounded alias and runs through the existing alias/hidden override;
  `cwd` is always `null`. No path, message, prompt or free-form field is read or kept.
- `recordId` is a bounded opaque token, deduplicated per daemon lifetime, so a producer
  retry or restart cannot double-bill.
- The reader primes at EOF on first sight, replacement, truncation, in-place rewrite or
  an oversized append, so history is never replayed; it refuses symlinks, hard links and
  non-regular files, and bounds file, chunk, line and per-poll record counts.
- `clear()` — consent change, account change, pause, cancellation — drops both the
  cursor and the dedup set.

Records that pass then travel the ordinary path: the same `projectObservation`
projection, the same hidden-project filter, the same outgoing allowlist (§4.3). Nothing
about pricing changes — measured tokens on a reviewed model price exactly as any other
source's do, and an unpriced or `null` model stays unpriced.

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
| GET | `/api/v1/users/:username` | → `{ user, links[], archetype, friendCount, level, levelBreakdown, presence: { status, lastSeenAt } }` — `presence` (round 20) is the coarse public snapshot, no activity/tools (§3) |
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
| POST | `/api/v1/projects` | `{ name, description?, repoUrl?, liveUrl? }` → `{ project }` — URLs are lenient (round 20): `owner/repo`, `github.com/owner/repo` and any scheme-less `host/path` are normalized to `https://…`; `""` means "none"; only http(s) survive |
| PATCH | `/api/v1/projects/:id` | partial → `{ project }` — same URL leniency; `""`/`null` clears a URL |
| DELETE | `/api/v1/projects/:id` | → `204` |
| POST | `/api/v1/projects/:id/like` | → `{ likeCount }` |
| DELETE | `/api/v1/projects/:id/like` | → `{ likeCount }` |
| GET | `/api/v1/projects/:id/commits` | → `{ repo, commits[], lastPushAt, build, latestRelease }` — degrades to empty when GitHub is unreachable |
| GET | `/api/v1/projects/:id/repo?path=` | repo file browser, below |
| GET | `/api/v1/projects/:id/digest` | → `{ repo, url, description, homepage, stars, forks, openIssues, language, languages[], topics[], license, defaultBranch, createdAt, pushedAt, readme, socialImageUrl, fetchedAt }` — repo digest for the card (round 20), below |

**`GET /projects/:id/digest` (round 20)** — what the project card shows when the owner
pasted only a repo URL: GitHub's own description, stars/forks, primary language plus
the languages split, topics, licence, and the README excerpt, in one request. Same
visibility gate, token order (owner OAuth → `GITHUB_TOKEN` → anonymous), 8 s timeout
and 10-minute cache as `/repo`; `languages`/`readme` degrade to `null` on their own,
the repo itself missing is a `404 repo_unavailable`, GitHub down is a `503
github_unavailable`, a non-GitHub `repoUrl` is a `404 not_github`. `socialImageUrl` is
`https://opengraph.githubassets.com/<projectId>/<owner>/<repo>` — GitHub's generated
social card, which the web uses as the cover when no screenshot was uploaded.

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
| GET | `/api/v1/users/:username/stats?range=30d` | → `{ byModel[], topModel, byTool[], topTool, totalTokens, totalActiveSeconds, streak, githubCommits[], rangeDays }` — `byTool` (round 20) is `byModel` folded per tool `{ tool, tokensInput, tokensOutput, activeSeconds, lastActiveAt }`, ranked by active time, tokens second; `topTool = byTool[0].tool ?? null` |
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
| GET | `/api/v1/presence/friends` | initial snapshot → `{ presences: [{ username, status, activity, tools, lastSeenAt }] }` — `tools` is the round 6 multi-tool list (§4.3), primary first, `[activity]` for sessions from an older tracker and `[]` when offline; `lastSeenAt` is ISO-8601 or null, max(every `Session.lastHeartbeatAt` ever incl. ENDED, retained connection-v1 receipt), never auth/verify time — same rule as §5.8's self-only `tracker.lastSeenAt`, scoped to accepted friends + self like the rest of this response |

### 5.8 Tracker ingestion

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/api/v1/tracker/heartbeat` | Bearer device token | see §4.3 |
| GET | `/api/v1/tracker/me` | Bearer device token | — → see below |
| POST | `/api/v1/tracker/connection` | Bearer device token | empty body → `{ connected: true, lastSeenAt, protocol: "connection-v1" }` |
| DELETE | `/api/v1/tracker/connection` | Bearer device token | empty body → `{ connected: false, lastSeenAt, protocol: "connection-v1" }` |
| GET | `/api/v1/tracker/verify` | Bearer device token | — → `{ username }` |

**Connection-v1 is daemon transport liveness, not an AI heartbeat**
(`server/src/lib/trackerConnection.ts`, `services/trackerConnection.ts`,
`routes/tracker.ts`). Both `/tracker/connection` routes reject any non-empty body
(`assertEmptyTrackerConnectionRequest` — framing/content-type must agree with an empty
JSON object) and never write a `Session`, `ActivityEvent` or `DailyStat` row; only an
in-memory per-device receipt is recorded. `POST` marks the device live and returns
`connected: true`; `DELETE` retires it (a clean stop) and returns `connected: false`.
A receipt stays live for `TRACKER_CONNECTION_TTL_MS` (**90s**) after the last accepted
`POST`, independent of AI-log activity — the tracker sends a bodyless `POST` before
polling AI logs and whenever no AI source is active, and a bounded bodyless `DELETE` on
clean shutdown.

**Process-local by design:** the connection store lives in the API process's memory and
a restart clears every receipt; a shared store is *required* before running multiple API
processes/replicas, and sticky routing alone is not sufficient (see the file-level
comment in `lib/trackerConnection.ts`).

**`GET /api/v1/tracker/verify` is not liveness** — it only validates a bearer token and
bumps `TrackerToken.lastUsedAt` (the same bookkeeping every authenticated tracker call
performs) before `login` saves it, and never creates or refreshes a connection-v1
receipt or otherwise proves a daemon is running, so treating it as "connected" is the
exact Round 5 regression the `GET /api/v1/tracker/me` notes below guard against.

Against a server that predates this protocol, the tracker deliberately treats the
connection as unavailable rather than reading AI logs or fabricating a connected state.

`GET /api/v1/tracker/me` is the read side of the device-token surface: everything the
macOS menu-bar companion (`menubar-mac/`) renders, in one request. Same auth as the
heartbeat — the app holds a tracker token in the Keychain and has no browser cookie, so
a revoked token 401s here exactly as it does on ingest.

```jsonc
{
  "user":     { "id": "…", "username": "emil", "displayName": "Emil|null",
                "avatarUrl": "…|null", "level": 7 },
  "presence": { "status": "active|idle|offline",
                // null when offline; `model` is null for presence-only tools (§4.3)
                "activity": { "project": "vibehub", "tool": "claude-code",
                              "model": "claude-opus-5|null", "since": "ISO-8601" } },
  "today":    { "activeSeconds": 8040, "tokens": 125000,
                // start of the session open right now, or null
                "sessionStartedAt": "ISO-8601|null" },
  "tracker":  { "connected": true, "lastSeenAt": "ISO-8601|null",
                "devices": [ { "name": "MacBook Pro", "lastSeenAt": "ISO-8601|null" } ] },
  // `count` is every online friend; `sample` is capped at 4 — what the popover draws
  "friendsOnline": { "count": 12,
                     "sample": [ { "username": "ann", "displayName": "…|null",
                                   "avatarUrl": "…|null", "status": "active|idle",
                                   "activity": { … } | null } ] }
}
```

Notes:

- `tracker.connected` and `lastSeenAt` are **heartbeat-derived** (`presenceFor()`), never
  `TrackerToken.lastUsedAt` — that column is bumped by `/tracker/verify` *and* by this
  route's own middleware, so deriving connectedness from it reports a live tracker the
  moment `login` runs (the Round 5 regression described at §5.2).
- `today` folds DailyStat rows dated today plus any still-open session, bucketed by the
  session's **start** day — the same day `foldIntoDailyStat` uses when it closes, so an
  overnight session does not land on today. Elapsed is measured to `lastHeartbeatAt`, so
  a dead tracker stops accruing time. `sessionStartedAt` is a display offset for a live
  ticking clock, not something to add to `activeSeconds` server-side.
- `friendsOnline` covers accepted friends only (§3), so the popover cannot leak a
  stranger's activity.
- Every timestamp is an ISO-8601 string with fractional seconds.
- Shaping lives in `server/src/lib/tracker-me.ts` (Prisma-free) and is pinned by
  `server/src/lib/__checks__/trackerMe.check.ts`.

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
             { "tool": "cursor", "model": null, "projectAlias": "neon-app" } ],
  "lastSeenAt": "2026-09-03T13:40:00.000Z" }

{ "type": "wall:new-comment", "wallOwner": "ada", "comment": { "...": "WallComment shape" } }

{ "type": "friend-request:incoming", "request": { "...": "FriendRequest shape" } }
```

`presence:update`'s `lastSeenAt` is ISO-8601 or null, heartbeat/receipt-derived exactly
like §5.7's `/presence/friends` field, never verification time.

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
