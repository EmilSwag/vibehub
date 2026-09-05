# vibehub-tracker

Node/TypeScript CLI that runs on a developer's machine, polls for known
coding-tool processes, and reports heartbeats to the VibeHub server. Full
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
`Seeing:  Claude Code (claude-fable-5-1, claude-opus-5), Cursor`. If the profile
shows a model you don't expect, this is where to check what was actually seen.

## Local files (`~/.vibehub/`)

| File | Written by | Purpose |
|---|---|---|
| `config.json` | `login`, `set` | `{ apiUrl, deviceToken, projectAliases, heartbeatIntervalMs?, idleThresholdMs?, toolProcessNames? }` |
| `status.json` | the daemon | current presence snapshot — the only file `vibehub/macos` reads (ARCHITECTURE.md §4.4); additionally carries `sources` (see below) |
| `queue.json` | the daemon | FIFO-ordered heartbeat events that failed to POST, retried on the next tick |
| `tracker.pid` | `start` | pid of the detached daemon, used by `stop`/`status` |
| `daemon.log` | the daemon | stdout/stderr of the detached process (for debugging `start`) |
| `stop.request` | `stop` | transient — asks the daemon to shut down cleanly; removed by whichever side finishes first |

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
- `estimated: true` on a `usage` entry means the counts were **derived, not read**.
  Quadcode chat logs carry no token numbers at all, so its adapter estimates from
  character counts (~4 chars per token, tool-result transcript excluded). The flag
  rides through to the server unchanged and never alters accounting — but anywhere
  those numbers are shown, including `vibehub-tracker status`, they are labelled
  **est.**. An estimate is never presented as measured.
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

Four sources feed one decision per tick. Log adapters win because they know
*what* happened; the process adapter only knows something is *open*.

| Adapter | Source | Gives |
|---|---|---|
| `claudeCode` | `~/.claude/projects/**/*.jsonl` (or `CLAUDE_CONFIG_DIR`) | project (from `cwd`), model, **real token counts per model** (input + cache read/creation, output), precise timestamps |
| `codex` | `~/.codex/sessions/**/*.jsonl` (or `CODEX_HOME`) | project, model, token deltas from running `token_count` totals, attributed to the model of the latest `turn_context` |
| `quadcode` | `<QuadcodeAI root>/apps/<Project>/.quadcodeai/.data/chats/*.files/*.jsonl` (or `QUADCODE_HOME`) | project (nearest git repo, else folder), model from `variations[].model_name`, **estimated** token counts — these logs contain no token numbers |
| `processes` | Windows: one PowerShell `Get-Process` call (see below); macOS/Linux `ps` + `lsof` on the editor's integrated-terminal shell | tool is open (Cursor, VS Code, Windsurf, Zed, Quadcode AI, ChatGPT, Grok), project from `"file - project - Cursor"` titles; never any tokens |

**Quadcode specifics.** The log's own timestamp is the turn *start* and the line is
only appended once the turn ends (one observed record spanned 3h47m), so the **file
append** is the activity signal, not the timestamp. Nothing is appended during a long
turn — the `processes` adapter carries presence then. Estimation strips
`<TOOL_RESULT>` spans (tool output) and keeps `<TOOL_RUN>` args (the model wrote
those); on a real record 99.3% of the message was tool transcript, so counting it raw
overstated output by ~138x. Media generation is not model-tagged: the log only ever
names the chat model, and a media call names a meta-section id whose model lives in a
file on disk. Logs embed base64 uploads inline, so appends over 8 MB and records over
2 MB are skipped rather than read.

**Windows process listing.** `tasklist /v` resolves every window title
synchronously and was measured at ~54 s per call on a busy machine — longer than
the 30 s tick. The adapter now runs a single
`powershell.exe -NoProfile -NonInteractive -Command "Get-Process | Where-Object { $_.MainWindowTitle -or ($n -contains $_.ProcessName) } | Select-Object ProcessName, Id, MainWindowTitle | ConvertTo-Json -Compress"`
where `$n` is the list of watched image names (`claude`, `codex`, `cursor`,
`code`, `windsurf`, `zed`, `genui`, `chatgpt`, `grok`, …). That returns every
process with a main window title (project parsing) **plus** the watched
title-less processes (the `claude` / `codex` CLIs have no window), as compact
JSON — a single match comes back as an object rather than an array, and
`ProcessName` carries no `.exe`; both are handled. Measured at ~0.3–0.4 s per
poll on the same machine. `tasklist` remains the fallback if PowerShell is
missing, fails, or exceeds a 20 s timeout.

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
- **Presence** (the one activity reported at the top level of the payload):
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
- `npx tsx scripts/local-quadcode-check.ts` — the Quadcode adapter end to end in a
  throwaway `QUADCODE_HOME` (never reads your real chats): estimation and
  `<TOOL_RESULT>` stripping, first-sighting priming (no replay), the append-not-
  timestamp activity rule, the `estimated` flag, oversized-record skipping, a media
  turn keeping the chat model, and all three project-alias cases.
- `node scripts/local-attribution-check.js` — deterministic end-to-end
  attribution test with a fake Claude Code log (multiple models, `<synthetic>`)
  in isolated temp dirs; asserts `usage`, the legacy sums and the presence model,
  the model hysteresis (one side call → no switch; two polls alone → switch), and
  the `stop.request` shutdown (`session_end` after the last heartbeat, status
  `"offline"`).

## Privacy invariant

No file path, file content, diff, or prompt text is ever read into a payload
sent to the server or written to `status.json` — only `projectAlias` (a name,
derived from a folder **basename**, never a full path), `tool`, `model`, token
*counts*, and timestamps. See ARCHITECTURE.md §3.
