# vibehub-tracker

Node/TypeScript CLI that runs on a developer's machine, reads local Claude Code
and Codex session logs, and reports heartbeats to the VibeHub server. Full
protocol: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §4. Build order
this scaffold followed: [`../docs/BUILD_PLAN.md`](../docs/BUILD_PLAN.md) §6.

## Commands

```
vibehub-tracker login <deviceToken> [--api-url <url>]   # write ~/.vibehub/config.json
vibehub-tracker set <projectFolder> <alias|hidden>       # remap or hide a project's display name
vibehub-tracker start [--no-autostart]                   # spawn the background heartbeat daemon, and start it at login from now on
vibehub-tracker status                                    # pretty-print ~/.vibehub/status.json
vibehub-tracker stop                                      # stop the daemon
vibehub-tracker autostart enable|disable|status [--dry-run]  # start at login: register, remove, or report
vibehub-tracker logout                                    # stop the daemon, deregister autostart, remove config.json
vibehub-tracker uninstall                                 # logout, plus remove the hooks and the `vibehub-tracker` command it owns
```

`start` requires a device token from a prior `login`. For local testing, seed one
via `npm run db:seed` inside `server/` (prints a raw `TrackerToken`; see
BUILD_PLAN.md §2.2) and pass it to `login`.

## Starting at login

`start` also registers the tracker to start again at every login, so it survives a
reboot without anyone re-running anything. Installing does **not**: `install.{ps1,sh}`
and `connect.{ps1,sh}` are setup-only by contract (`web/scripts/test-installers.mjs`
fails if an install produces a LaunchAgent, a `.plist`, a Startup entry or a `.lnk`).
Starting a background tracker is the user's decision, and this is what it registers.

One user-scope file per platform, in the place that platform documents for it. No
elevation, nothing system-wide, nothing hidden — `autostart status` prints the exact
path, and deleting that file by hand is a supported way to turn it off.

| Platform | File | Mechanism |
|---|---|---|
| macOS | `~/Library/LaunchAgents/com.vibehub.tracker.plist` | launchd, `RunAtLoad`, `KeepAlive { SuccessfulExit: false }`, `ThrottleInterval 30` |
| Linux | `~/.config/autostart/vibehub-tracker.desktop` (honours `XDG_CONFIG_HOME`) | XDG autostart |
| Windows | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\VibeHub Tracker.vbs` | Startup folder, run by `wscript` so no console window appears |

What the OS launches is the hidden `serve` command, never `start`: it runs the loop in
that process, owns `tracker.pid`, and knows how to defer to or take over a daemon that
is already running (see "Daemon model" below).

`autostart disable` removes the file **and** records the choice in `config.json`
(`autostart: { enabled: false }`), which `start` honours — otherwise the next `start`
would silently put the login entry back. `logout` and `uninstall` deregister it too: a
login entry with no `config.json` would wake a credential-less daemon at every boot.

A registration this install did not write is reported and left alone, never
overwritten. On macOS that specifically protects the Mac app, which writes the same
`com.vibehub.tracker` label from Swift and drives it from its own "Track at login"
switch.

`status` also prints a `Seeing:` line — every tool and raw model id the daemon
observed in the last 10 minutes, e.g.
`Seeing:  Claude Code (claude-fable-5-1, claude-opus-5), Codex (gpt-5-codex)`. If the
profile shows a model you don't expect, this is where to check what was actually seen.

## Local files (`~/.vibehub/`)

| File | Written by | Purpose |
|---|---|---|
| `config.json` | `login`, `set`, `autostart` | `{ apiUrl, deviceToken, projectAliases, heartbeatIntervalMs?, idleThresholdMs?, toolProcessNames?, autostart? }` |
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

**Cursor and Windsurf have no adapter here, and never will.** They are reported through
that same receiver, from records their own hook systems ask a separate producer to write
(`vibehub-tracker hooks install cursor` — see "Cursor and Windsurf" below and
ARCHITECTURE.md §4.7). Nothing in `src/` opens a Cursor or Windsurf file, directory,
process or window.

| Adapter | Source | Gives | Active? |
|---|---|---|---|
| `claudeCode` | `~/.claude/projects/**/*.jsonl` (or `CLAUDE_CONFIG_DIR`) | project (from `cwd`), model, **real token counts per model** (input + cache read/creation, output), precise timestamps | Yes |
| `codex` | `~/.codex/sessions/**/*.jsonl` (or `CODEX_HOME`) | project, model, token deltas from running `token_count` totals, attributed to the model of the latest `turn_context` | Yes |
| `attested` | `~/.vibehub/attested.jsonl`, written by a separate producer you installed — VibeHub's own Cursor / Windsurf hook is one | whatever that producer states: dated activity, an allowlisted model or null, and token counts **only** when it marks them measured | Only when opted in |
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

The tools you can consent to are `quadcode`, `cursor` and `windsurf` — and every one of
them is tokenless, so even a producer's measured claim contributes activity and model
only. The measured path stays implemented for a future tool that has a real counter.

Turn it on in `~/.vibehub/config.json` (for Cursor and Windsurf, `hooks install` writes
this entry for you):

```json
{ "attestedMetadata": { "enabled": true, "tools": ["quadcode", "cursor", "windsurf"] } }
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
- `tool` may only be a receiver-eligible id, and only one you actually listed — consent
  is per tool. Listing `claude-code` or `codex` is a config error, not a wider receiver:
  those must come from their own logs.
- `recordId` is deduplicated, and the reader primes at EOF, so a retry, a restart or a
  rewritten file never replays or double-bills.
- Withdrawing consent removes the receiver and clears its state on the next tick.

`vibehub-tracker status` prints a `Receiver:` line whenever it is on.

## Cursor and Windsurf (opt-in hooks)

Both products publish an official hook system that runs a command you choose at points in
their agent loop. VibeHub ships such a command, and one code path covers both vendors.

```
vibehub-tracker hooks install cursor
vibehub-tracker hooks install windsurf
vibehub-tracker hooks install cursor --dry-run   # shows the exact file, writes nothing
vibehub-tracker hooks status
vibehub-tracker hooks uninstall cursor
```

`install` does two things at once, because either alone is useless: it registers the hook
in **your** config (`~/.cursor/hooks.json`, `~/.codeium/windsurf/hooks.json`) and it adds
the tool to `attestedMetadata` so the tracker will read what the hook writes. Restart the
IDE afterwards. Nothing is automatic — no part of this tracker looks for an installed IDE,
and `login`, `start` and upgrades never touch a vendor file.

| | Cursor | Windsurf |
|---|---|---|
| File written | `~/.cursor/hooks.json` | `~/.codeium/windsurf/hooks.json` |
| Events | `afterAgentResponse`, `stop` | `pre_user_prompt`, `post_cascade_response` |
| You get | activity, the model when its id is one this tracker knows, and your project folder's name | same |
| You do not get | token counts — neither product reports any | same |

What leaves the hook process is one line per event, and this is all of it:

```json
{ "v": 1, "tool": "cursor", "recordId": "574655f5-e803-41d4-8319-f295a03688a3",
  "occurredAt": "2026-09-21T09:14:22.104Z", "model": "claude-opus-5",
  "projectHint": "demo-project" }
```

The vendor hands the hook much more than that — the prompt, the conversation and
generation ids, your full workspace paths, your e-mail, a transcript path, and on Windsurf
the entire response — and none of it is read. `recordId` is random, not derived from
anything the vendor sent. `projectHint` is the **last segment** of the workspace path and
never the path itself, treated exactly like the folder name Claude Code and Codex logs
already provide, so your own `vibehub-tracker set <folder> <alias>` and `hidden` overrides
still apply. Windsurf's two events document no path, so those records usually carry no
project at all.

There is no `measured` flag and no token field anywhere in that line — not zero, absent.
Cursor's `beforeSubmitPrompt` (which carries your prompt) and Windsurf's
`post_cascade_response_with_transcript` (which writes the whole conversation to disk) are
never subscribed to, and a payload claiming one of them is dropped. Cursor's
`sessionStart`/`sessionEnd` were subscribed briefly and are retired — a session boundary is
not a turn, and `sessionEnd` can fire hours after the last model call.

If an older VibeHub left hooks on retired events, `hooks status` lists them as **stale** and
re-running `hooks install` clears them. Your own entries are never touched, on any event.

Because neither tool reports tokens, `cursor` and `windsurf` are **tokenless**: a usage
entry naming one is rejected (not zeroed) by the tracker and by the server, and a day
spent only in them reports unknown tokens and unknown cost — never `0`, never an estimate.

Your hook file stays yours: other entries, other events and unknown keys are preserved, a
file the installer does not recognise aborts the operation instead of being rewritten, and
the original is copied to `hooks.json.vibehub-backup` the first time it changes.

**Removing VibeHub removes its command too.** The installers put a `vibehub-tracker` shim
on your PATH (`~/.local/bin` for the terminal connector, `/usr/local/bin` for the Mac app).
Nothing runs when you delete an app, so the shim checks its own install root: once
`VibeHub.app` or `~/.vibehub` is gone it **deletes itself** and says so, leaving nothing
dangling on PATH. An interrupted upgrade is different - the root is still there, so it
keeps the command and tells you to reinstall. `vibehub-tracker uninstall` does the same
deliberately while everything still works: it stops the daemon, removes the hooks it wrote
from Cursor and Windsurf, withdraws consent, removes `config.json`, and removes its own
shim - never a command by that name that is not ours, and never one belonging to a
different VibeHub install. The hook
command prints nothing and always exits 0 — including when it records nothing at all — so
it cannot interrupt your editor.

### Windows

The connector installs `vibehub-tracker.cmd` into `%LOCALAPPDATA%\Programs\VibeHub` -
per user, no administrator, and runnable from both `cmd` and PowerShell. If that directory
is not on your PATH, `connect.ps1` prints the exact line to add it for your account:

```
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:LOCALAPPDATA\Programs\VibeHub", 'User')
```

then reopen the terminal. The directory goes in **resolved** - `connect.ps1` substitutes
your own absolute path before printing, and the form above resolves it the same way,
because `SetEnvironmentVariable` stores a user PATH as `REG_SZ`: a literal
`%LOCALAPPDATA%` would sit there unexpanded and match nothing. (`setx` works too but
truncates PATH at 1024 characters, which is why it is not the advice.)

The hook that Cursor and Windsurf store on Windows points at that `.cmd`, not at
`node.exe` + the bundle: a vendor spawns hook commands through `cmd`, and two quoted paths
in a row are not parseable there - measured, not assumed. Paths inside the launcher are
written as `%USERPROFILE%\...`, so a home directory with non-ASCII characters still works
whatever the console code page is. Deleting `~/.vibehub` disarms it the same way as
everywhere else: the next run removes the command itself.

Times: Cursor publishes no timestamp, so the record is stamped when the hook fires.
Windsurf's own `timestamp` is used when it is a real, fresh, zoned instant, and otherwise
the record is stamped now — a timestamp with no timezone is never "fixed" by assuming
yours, and the tracker's receiver rejects such a record rather than repairing it.

Full contract: `../docs/ARCHITECTURE.md` §4.7.

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
  below were written when `processes` could also feed candidates; no adapter reports a
  window title or a process any more, so "window title changed" and "process-only"
  candidates do not occur at all. The same tool/project hysteresis applies across every
  live source — Claude Code, Codex, Quadcode, and anything arriving through the opt-in
  receiver:
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
- `npx tsx scripts/local-quadcode-check.ts` — reads nothing at all. It holds the
  documented Quadcode record shape as an executable record and shows, on that shape
  alone, why it cannot date a request or a response, that the native adapter is inert,
  and what the opt-in receiver accepts in its place.
- `npm test` covers the receiver's projection in `test/attestedReceiver.test.ts`
  (pure functions, no filesystem), and `scripts/check-ai-only.mjs` covers it end to end
  against a synthetic HOME: off by default, dated-only, measured-or-unknown, no replay,
  no double-billing, read-only inbox, and consent withdrawal.
- **Retired (2026-09-21):** `local-title-model-check.ts` and
  `local-attribution-check.js`. Both drove behaviour that later hardening deliberately
  removed — window-title parsing (the helpers are inert stubs now) and a custom
  `CLAUDE_CONFIG_DIR` (a non-default root disables the source), so both were permanently
  red. Their coverage that still means something now lives in `scripts/check-ai-only.mjs`:
  no title may become a project, per-message model attribution with two models in one
  file, a `<synthetic>` record contributing nothing, and the detector's tool/project
  hysteresis. `stop.request` shutdown is covered by `test/serve.test.ts`.

## Privacy invariant

Local parsing may temporarily read complete records from `~/.claude/projects` and
`~/.codex/sessions` JSONL, which can contain prompts, code and tool output — those
contents are never saved to `status.json`/`queue.json` or sent to the server. Only
`projectAlias` (a name, derived from a folder **basename**, never a full path), `tool`,
`model`, token *counts*, and timestamps leave the local read into a payload or local
state file. See ARCHITECTURE.md §3.
