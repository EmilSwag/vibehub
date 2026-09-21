# vibehub-tracker

Node/TypeScript CLI that runs on a developer's machine, reads local Claude Code
and Codex session logs, and reports heartbeats to the VibeHub server. Full
protocol: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §4. Build order
this scaffold followed: [`../docs/BUILD_PLAN.md`](../docs/BUILD_PLAN.md) §6.

## Commands

```
vibehub-tracker login <deviceToken> [--api-url <url>]   # write ~/.vibehub/config.json
vibehub-tracker set <projectFolder> <alias|hidden>       # remap or hide a project's display name
vibehub-tracker start                                    # spawn the background heartbeat daemon
vibehub-tracker status                                    # pretty-print ~/.vibehub/status.json
vibehub-tracker stop                                      # stop the daemon
vibehub-tracker logout                                    # stop the daemon and remove config.json
```

`start` requires a device token from a prior `login`. For local testing, seed one
via `npm run db:seed` inside `server/` (prints a raw `TrackerToken`; see
BUILD_PLAN.md §2.2) and pass it to `login`.

`status` also prints a `Seeing:` line — every tool and raw model id the daemon
observed in the last 10 minutes, e.g.
`Seeing:  Claude Code (claude-fable-5-1, claude-opus-5), Codex (gpt-5-codex)`. If the
profile shows a model you don't expect, this is where to check what was actually seen.

## Local files (`~/.vibehub/`)

| File | Written by | Purpose |
|---|---|---|
| `config.json` | `login`, `set` | `{ apiUrl, deviceToken, projectAliases, heartbeatIntervalMs?, idleThresholdMs?, toolProcessNames? }` |
| `status.json` | the daemon | current presence snapshot — the only file `vibehub/macos` reads (ARCHITECTURE.md §4.4); additionally carries `sources` (see below) |
| `queue.json` | the daemon | FIFO-ordered heartbeat events that failed to POST, retried on the next tick |
| `tracker.pid` | `start` | pid of the detached daemon, used by `stop`/`status` |
| `daemon.log` | the daemon | stdout/stderr of the detached process (for debugging `start`) |
| `stop.request` | `stop` | transient — asks the daemon to shut down cleanly; removed by whichever side finishes first |
| `attested.jsonl` | a separate producer you installed — **never** the tracker | opt-in attested metadata inbox; read-only, and only while `attestedMetadata.enabled` is set (see below) |

Directory is created `0700`, files `0600`, on platforms with POSIX permission
bits. Windows has no equivalent bit, so this degrades silently there.

`status.json` extends the §4.4 shape with an optional, additive
`sources: [{ tool, model, lastSeenAt }]` — every (tool, model) pair seen in the
last 10 minutes, most recent first. Older readers ignore it.

## Daemon model

`start` spawns a **detached** copy of the same CLI entry point invoked with the
hidden `run-loop` command, writes its pid to `tracker.pid`, and returns
immediately. `run-loop` is what actually polls on `HEARTBEAT_INTERVAL_MS` and
sends heartbeats; it is not meant to be run directly.

Ticks never overlap: if a poll is still running when the interval fires, that
tick is skipped (one debug log line per skip) rather than stacked, and a tick
slower than the interval is logged with its duration. Every payload's
`occurredAt` is stamped *after* detection finishes, right before sending, so a
slow poll can't date a heartbeat tens of seconds in the past.

### `stop` semantics

`stop` is cooperative, on every platform:

1. It writes `~/.vibehub/stop.request` and waits (polling, up to **8 s**) for the
   daemon's pid to exit.
2. The daemon checks for that file at the start of every tick **and** on a 1 s
   timer. On seeing it, it runs its normal shutdown: lets a mid-send tick finish
   (≤ 3 s grace), sends `session_end` for the open session (best-effort — queued
   if the network is down), writes `status.json` back to `"offline"`, removes
   `tracker.pid` and `stop.request`, and exits `0`. `SIGTERM` / `SIGINT` take the
   same path.
3. Fallback: if the pid is still alive after the wait, `stop` kills it. Then, if
   `status.json` still says `"active"` (killed daemon, or one that had crashed
   earlier), `stop` itself posts a best-effort `session_end` — `projectAlias` /
   `tool` / `model` from `status.json`, token and `apiUrl` from `config.json` —
   and writes the offline status.

Why not just a signal: on Windows `process.kill(pid, "SIGTERM")` is
`TerminateProcess` — the daemon's handler never ran, no `session_end` went out,
`status.json` stayed `"active"`, and the server session lingered until the rollup
job. `logout` runs the same `stop` before deleting `config.json`.

## Heartbeat payload (v2, backward compatible)

`POST /api/v1/tracker/heartbeat`, `Authorization: Bearer <deviceToken>`:

```json
{
  "eventType": "heartbeat",
  "projectAlias": "vibehub",
  "tool": "claude-code",
  "model": "claude-fable-5-1",
  "occurredAt": "2026-09-04T10:00:00.000Z",
  "tokensInputDelta": 812,
  "tokensOutputDelta": 340,
  "usage": [
    { "tool": "claude-code", "model": "claude-fable-5-1", "tokensInputDelta": 700, "tokensOutputDelta": 300 },
    { "tool": "codex",       "model": "gpt-5-codex",      "tokensInputDelta": 112, "tokensOutputDelta": 40 }
  ]
}
```

- Top-level `projectAlias` / `tool` / `model` describe **presence** — the one
  activity the user is "in" (see detection rules below).
- `usage` is the **precise token attribution**: one entry per `(tool, model)`
  that burned tokens since the previous heartbeat, nonzero entries only, merged
  across every session file that was active. A server that understands `usage`
  books stats from it and ignores the top-level sums; `tokensInputDelta` /
  `tokensOutputDelta` are still sent as the plain sums so older servers keep
  counting (never double-counted: a server reads one or the other).
- `model: null` inside `usage` means the tokens can't be attributed to a model —
  Claude Code's locally fabricated `"<synthetic>"` assistant lines, empty ids.
  Those never become the presence model either.
- `estimated: true` on a `usage` entry once meant the counts were **derived, not read**
  — the Quadcode character-count estimator. **This tracker can no longer send it.** The
  estimator is gone, `projectUsage` rejects any entry carrying the flag, and the opt-in
  receiver refuses a record that even mentions it. The server still accepts it from
  older trackers, where it must still be shown as **est.**. Usage that cannot be
  measured is reported as unknown — not estimated, and not zero.
- `tools` lists **every tool seen open right now**, primary first (entry 0 always
  matches the top-level `tool`/`model`), deduped, at most 10, e.g.
  `[{"tool":"quadcode","model":"claude-fable-5-1","projectAlias":"vibehub"},
  {"tool":"cursor","model":null,"projectAlias":"vibehub"}]`. People work in several
  tools at once and presence should show that, but hours and tokens still accrue only
  to the primary. `projectAlias` is `null` when unknown or when the project is hidden
  by an alias override — the tool shows, its project name does not. Sent on
  `heartbeat` only; a server that predates it ignores the field.
- `session_start` / `session_end` carry presence only — no deltas, no `usage`, no `tools`.
- Tokens seen while no session is open (or the project is hidden) accumulate
  per `(tool, model)` and ride on the next heartbeat, so spend is never lost and
  never re-attributed to whatever session opens next.

## Offline heartbeat queue

Every heartbeat/session event first tries a direct POST. On failure (network
down, server unreachable) the event is appended to `queue.json` instead of
being dropped. Each tick flushes the queue **before** sending the current
event, delivering strictly in FIFO order and stopping at the first event that
still fails — so ordering is preserved and nothing is skipped ahead of an
earlier failure. The queue is capped at 500 entries (oldest dropped first) so
an extended offline stretch can't grow the file without bound.

## Detection adapters (`src/adapters/`, merged by `src/detector.ts`)

**Current status: `claudeCode`, `codex` and `quadcode` are the log adapters.**
`processes.ts` still exists as a file but is an **inert stub** — `poll()` returns `[]`
and it touches no file and no process. The host-inventory implementation that name once
held was removed, not merely unwired: there is no window/title reader anywhere in
`src/`, and `estimateTokens()` / `stripToolResults()` still return `0` and `""`. See
`meta/facts/vibehub-ai-only-privacy.md` for the AI-only collection contract, and
`../docs/ARCHITECTURE.md` §4.5 for how Quadcode is read and why it never reports tokens.

A third adapter, `attested`, exists but is **constructed only when the user opts in**
(`attestedMetadata` in `config.json`). It is a receiver, not a producer — see
"Opt-in attested metadata" below and ARCHITECTURE.md §4.6.

| Adapter | Source | Gives | Active? |
|---|---|---|---|
| `claudeCode` | `~/.claude/projects/**/*.jsonl` (or `CLAUDE_CONFIG_DIR`) | project (from `cwd`), model, **real token counts per model** (input + cache read/creation, output), precise timestamps | Yes |
| `codex` | `~/.codex/sessions/**/*.jsonl` (or `CODEX_HOME`) | project, model, token deltas from running `token_count` totals, attributed to the model of the latest `turn_context` | Yes |
| `attested` | `~/.vibehub/attested.jsonl`, written by a separate producer you installed | whatever that producer states: dated activity, an allowlisted model or null, and token counts **only** when it marks them measured | Only when opted in |
| `quadcode` | `<app data>/QuadcodeAI/apps/*/.quadcodeai/.data/chats/**/chat_N.jsonl` | project (from the `<Project>` folder), model from `variations[].model_name`, activity — **never tokens** | Yes |
| `processes` | nothing — inert stub | nothing; `poll()` returns `[]` | No |

**How Quadcode is dated, and why it reports no tokens.** Its chat records cannot date a
reply from their own contents. The `timestamp` is local ISO with **no timezone**, and on
an LLM record it marks the turn *start*, written only once the turn ends (one observed
record spanned 3h47m). So the adapter does not use it as an instant at all: it reports
the moment it **observes the append** of a completed LLM record while holding a byte
offset in that file, bounded by the poll interval. First sight primes at EOF, so a turn
that finished before the tracker started is never counted. The record's own stamp is
used for one thing only — discarding turns whose start is over 24 h old.

The logs carry no token counts anywhere (`meta_info.max_tokens` is a boolean flag,
`cluster_node_info` is a node id), so `quadcode` is a **tokenless** tool: usage entries
naming it are rejected outright (not zeroed) by both the tracker and the server, and a
Quadcode-only heartbeat omits the token fields entirely rather than sending `0`.

Roots come from your home directory (`%USERPROFILE%\AppData\Roaming\QuadcodeAI`,
`~/Library/Application Support/QuadcodeAI`, `~/.config/QuadcodeAI`). `APPDATA` and
`XDG_CONFIG_HOME` are not consulted; `QUADCODE_HOME` may name the real root and nothing
else. A non-default install location is simply not found. Full write-up:
`../docs/ARCHITECTURE.md` §4.5.

## Opt-in attested metadata (`attested-metadata-v1`)

Measured token counts for a tool without its own counter can only come from something
that actually knows what a turn used. The `attested` adapter lets a **separate producer
you install** state that. It is a receiver: it discovers nothing, derives nothing, and
while the switch is off it opens no file at all.

Note that `quadcode` — currently the only tool you can consent to — is tokenless, so
even a producer's measured claim contributes activity and model only. The measured path
stays implemented for a future tool that has a real counter.

Turn it on in `~/.vibehub/config.json`:

```json
{ "attestedMetadata": { "enabled": true, "tools": ["quadcode"] } }
```

Your producer then appends one JSON record per line to `~/.vibehub/attested.jsonl`
(the tracker only reads that file — it never writes, rotates or deletes it):

```json
{ "v": 1, "tool": "quadcode", "recordId": "turn-7f3a",
  "occurredAt": "2026-09-19T12:04:31.000Z", "model": "claude-fable-5-1",
  "projectHint": "vibehub", "measured": true,
  "tokensInputDelta": 391, "tokensOutputDelta": 120 }
```

Rules, all fail-closed — a record that breaks one is dropped, never repaired:

- `occurredAt` must carry `Z` or a `±HH:MM` offset. A Quadcode-style local timestamp is
  rejected. Stale and future records are dropped, not clamped.
- `measured: true` is the only way tokens are accepted, and only as safe non-negative
  integers. Leave it out and the counts must be absent too: the record then reports
  activity and model with **no usage at all**. Unknown usage stays unknown — it never
  becomes a zero, and it is never estimated.
- `estimated` must not appear, in either polarity.
- `model` goes through the same allowlist as every other source; an unreviewed id (for
  example `grok-4.6`) becomes `null`. Nothing is added to the allowlist for this path.
- `tool` may only be a receiver-only id. Listing `claude-code` or `codex` is a config
  error, not a wider receiver — those must come from their own logs.
- `recordId` is deduplicated, and the reader primes at EOF, so a retry, a restart or a
  rewritten file never replays or double-bills.
- Withdrawing consent removes the receiver and clears its state on the next tick.

`vibehub-tracker status` prints a `Receiver:` line whenever it is on.

**Process/window detection is gone, not paused.** The Windows `Get-Process` listing and
the macOS/Linux `ps`/`lsof` walk this section used to describe were deleted along with
the rest of the host-inventory adapter; `check-ai-only.mjs` greps the collector sources
to keep them from coming back. An open editor is not evidence that a model ran.

Every adapter returns `Observation`s with `usage: [{ model, tokensInputDelta,
tokensOutputDelta }]` — per-model deltas since the last poll — plus the summed
`tokensInputDelta` / `tokensOutputDelta` for compatibility.

Rules:
- Log files are tailed incrementally from the byte offset where they were first
  seen, so restarting the tracker never re-counts old sessions. Claude Code writes
  one line per streamed content block with the same `message.id`; those are
  de-duplicated before counting.
- **Attribution:** each Claude Code assistant message's tokens are booked under
  *that message's own* `message.model` — one session file routinely mixes the
  main model with cheaper side-call models. `"<synthetic>"` / empty model ids are
  booked under `model: null` and are ignored when deciding the file's current
  model, which is the most recent non-synthetic assistant message that carried
  usage. Real ids seen in the wild: `claude-opus-5`, `claude-fable-5-1`,
  `claude-sonnet-5`, `claude-opus-4-8`, bare `sonnet` / `opus`.
- Token deltas from *every* observed session are merged by `(tool, model)` into
  the next heartbeat's `usage`, even if a different tool is the "current"
  activity — Claude tokens are never booked under Cursor just because Cursor's
  window title changed last.
- **Presence** (the one activity reported at the top level of the payload). The rules
  below were written when `processes`/`quadcode` could also feed candidates; with only
  the two active log adapters, "window title changed" and "process-only" candidates do
  not currently occur, but the same tool/project hysteresis applies between Claude Code
  and Codex:
  1. Candidates are observations with `activity` confidence whose evidence is
     inside `idleThresholdMs` (default 5 min): a log line, or a window title that
     changed. An editor left open with a static title decays to idle;
     `claude` / `codex` *processes* alone never count as active (their logs do).
  2. Hysteresis: if the current session's tool is still among the candidates,
     keep it — unless a candidate of *another* tool burned tokens this poll.
     Within the same tool, prefer the current project, then a session with
     tokens this poll, then the newest. This is what stops Claude Code running
     inside Cursor's terminal from flipping `claude-code ↔ cursor` every 30 s
     (with `session_end` / `session_start` churn and fragmented stats).
  3. Otherwise log-backed candidates (Claude Code, Codex — a model or tokens)
     beat process-only ones: those with tokens this poll first, then newest. A
     log line proves work; a window-title change only proves the window changed.
  4. No candidate at all: the newest presence observation, reported as not
     active, so the loop can go idle.
- **Presence-model hysteresis** (same tool, same project): the session keeps
  reporting its current model unless *either* the same challenger model burned
  tokens in **2 consecutive polls while the current model burned none** in those
  polls, *or* the current model has not been seen at all inside `idleThresholdMs`
  (its source went stale). A one-off side call (title generation, a sub-agent on a
  cheaper model) therefore never flips the session; a real hand-over does, once,
  after ~60 s. A `null` model becoming known is adopted immediately (refinement,
  not a switch). This only affects the top-level `model`; every token is still
  attributed to the model that burned it in `usage`. Before this rule one project
  with several session files produced `session_end` / `session_start` pairs every
  poll (`opus-5 → sonnet-5 → fable` in 90 s).
- After `idleThresholdMs` without activity the daemon sends `session_end`, so
  server-side active time stops accruing.

`model` is `null` for tools without a log adapter (e.g. Cursor); the server
renders those as the tool name alone.

`git_commit` events (`ActivityEventType.GIT_COMMIT`) are part of the server's
data model but are not emitted by this scaffold — BUILD_PLAN.md's tracker
build order (steps 1-5) does not include commit-watching, and `GithubCommitDay`
is populated server-side from the GitHub API instead (ARCHITECTURE.md §2.12).

## Local checks

- `node ../scripts/probe-tracker-tick.js` (from `tracker/`, after `npm run build`)
  — two real ticks against a mock API; prints each tick's duration, each
  payload's presence and `usage`. Redirects `~/.vibehub` to a temp dir, tails
  the real logs.
- `npx tsx scripts/local-title-model-check.ts` — pure-function checks for the
  window-title → project parsing.
- `npx tsx scripts/local-quadcode-check.ts` — reads nothing at all. It holds the
  documented Quadcode record shape as an executable record and shows, on that shape
  alone, why it cannot date a request or a response, that the native adapter is inert,
  and what the opt-in receiver accepts in its place.
- `npm test` covers the receiver's projection in `test/attestedReceiver.test.ts`
  (pure functions, no filesystem), and `scripts/check-ai-only.mjs` covers it end to end
  against a synthetic HOME: off by default, dated-only, measured-or-unknown, no replay,
  no double-billing, read-only inbox, and consent withdrawal.
- `node scripts/local-attribution-check.js` — deterministic end-to-end
  attribution test with a fake Claude Code log (multiple models, `<synthetic>`)
  in isolated temp dirs; asserts `usage`, the legacy sums and the presence model,
  the model hysteresis (one side call → no switch; two polls alone → switch), and
  the `stop.request` shutdown (`session_end` after the last heartbeat, status
  `"offline"`).

## Privacy invariant

Local parsing may temporarily read complete records from `~/.claude/projects` and
`~/.codex/sessions` JSONL, which can contain prompts, code and tool output — those
contents are never saved to `status.json`/`queue.json` or sent to the server. Only
`projectAlias` (a name, derived from a folder **basename**, never a full path), `tool`,
`model`, token *counts*, and timestamps leave the local read into a payload or local
state file. See ARCHITECTURE.md §3.
