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

## Local files (`~/.vibehub/`)

| File | Written by | Purpose |
|---|---|---|
| `config.json` | `login`, `set` | `{ apiUrl, deviceToken, projectAliases, heartbeatIntervalMs?, idleThresholdMs?, toolProcessNames? }` |
| `status.json` | the daemon | current presence snapshot — the only file `vibehub/macos` reads (ARCHITECTURE.md §4.4) |
| `queue.json` | the daemon | FIFO-ordered heartbeat events that failed to POST, retried on the next tick |
| `tracker.pid` | `start` | pid of the detached daemon, used by `stop`/`status` |
| `daemon.log` | the daemon | stdout/stderr of the detached process (for debugging `start`) |

Directory is created `0700`, files `0600`, on platforms with POSIX permission
bits. Windows has no equivalent bit, so this degrades silently there.

## Daemon model

`start` spawns a **detached** copy of the same CLI entry point invoked with the
hidden `run-loop` command, writes its pid to `tracker.pid`, and returns
immediately. `run-loop` is what actually polls on `HEARTBEAT_INTERVAL_MS` and
sends heartbeats; it is not meant to be run directly. `stop` sends `SIGTERM` to
the pid on file; the daemon's signal handler ends any open session
(`session_end`, best-effort — queued if the network is down), writes
`status.json` back to `"offline"`, and exits.

## Offline heartbeat queue

Every heartbeat/session event first tries a direct POST. On failure (network
down, server unreachable) the event is appended to `queue.json` instead of
being dropped. Each tick flushes the queue **before** sending the current
event, delivering strictly in FIFO order and stopping at the first event that
still fails — so ordering is preserved and nothing is skipped ahead of an
earlier failure. The queue is capped at 500 entries (oldest dropped first) so
an extended offline stretch can't grow the file without bound.

## Detection adapters (`src/adapters/`, merged by `src/detector.ts`)

Three sources feed one decision per tick. Log adapters win because they know
*what* happened; the process adapter only knows something is *open*.

| Adapter | Source | Gives |
|---|---|---|
| `claudeCode` | `~/.claude/projects/**/*.jsonl` (or `CLAUDE_CONFIG_DIR`) | project (from `cwd`), model, **real token counts** (input + cache read/creation, output), precise timestamps |
| `codex` | `~/.codex/sessions/**/*.jsonl` (or `CODEX_HOME`) | project, model, token deltas from running `token_count` totals |
| `processes` | Windows `tasklist /v` window titles; macOS/Linux `ps` + `lsof` on the editor's integrated-terminal shell | tool is open (Cursor, VS Code, Windsurf, Zed, Quadcode AI, ChatGPT), project from `"file - project - Cursor"` titles |

Rules:
- Log files are tailed incrementally from the byte offset where they were first
  seen, so restarting the tracker never re-counts old sessions. Claude Code writes
  one line per streamed content block with the same `message.id`; those are
  de-duplicated before counting.
- "Active" requires timestamped evidence inside `idleThresholdMs` (default 5 min):
  a log line, or a window title that changed. An editor left open with a static
  title decays to idle; `claude`/`codex` processes alone never count as active
  (their logs do).
- Token deltas from *every* observed session are summed into the next heartbeat,
  even if a different tool is the "current" activity.
- After `idleThresholdMs` without activity the daemon sends `session_end`, so
  server-side active time stops accruing.

`model` is `"unknown"` only for tools without a log adapter (e.g. Cursor).

`git_commit` events (`ActivityEventType.GIT_COMMIT`) are part of the server's
data model but are not emitted by this scaffold — BUILD_PLAN.md's tracker
build order (steps 1-5) does not include commit-watching, and `GithubCommitDay`
is populated server-side from the GitHub API instead (ARCHITECTURE.md §2.12).

## Privacy invariant

No file path, file content, diff, or prompt text is ever read into a payload
sent to the server or written to `status.json` — only `projectAlias` (a name,
derived from a folder **basename**, never a full path), `tool`, `model`, token
*counts*, and timestamps. See ARCHITECTURE.md §3.
