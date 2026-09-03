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

## Process detection adapters

MVP detection is process-list based, per ARCHITECTURE.md §4.2. The exact
per-OS mechanism (a builder-agent decision the spec explicitly defers):

| OS | Process list | Working-directory lookup |
|---|---|---|
| Linux | `ps -axo pid=,comm=` | `readlink /proc/<pid>/cwd` |
| macOS | `ps -axo pid=,comm=` | `lsof -a -p <pid> -d cwd -Fn` |
| Windows | `tasklist /fo csv /nh` | not available without extra tooling — degrades to `projectAlias: "unknown"` |

`toolProcessNames` defaults to `["claude", "cursor", "code"]` and is matched
case-insensitively as a substring (so `Code.exe` matches `code`); override via
`toolProcessNames` in `config.json`. When multiple configured tools are
running at once, the first match from the OS's process list wins — the spec's
"most recently active" ordering isn't derivable from a plain process list
without extra OS-specific instrumentation, so this is a known MVP limitation.

Model name detection (tool-specific log/session-file adapters, ARCHITECTURE.md
§4.2) is not implemented in this scaffold — `model` is always reported as
`"unknown"`, which is an explicitly allowed value in the wire format. Token
counts (`tokensInputDelta`/`tokensOutputDelta`) are likewise always `0` until a
real adapter exists; wiring one up is a natural follow-up once a specific
tool's local log format is chosen to parse.

`git_commit` events (`ActivityEventType.GIT_COMMIT`) are part of the server's
data model but are not emitted by this scaffold — BUILD_PLAN.md's tracker
build order (steps 1-5) does not include commit-watching, and `GithubCommitDay`
is populated server-side from the GitHub API instead (ARCHITECTURE.md §2.12).

## Privacy invariant

No file path, file content, diff, or prompt text is ever read into a payload
sent to the server or written to `status.json` — only `projectAlias` (a name,
derived from a folder **basename**, never a full path), `tool`, `model`, token
*counts*, and timestamps. See ARCHITECTURE.md §3.
