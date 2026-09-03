---
SECTION_ID: plans.vibehub_tracker_workstream
TYPE: plan
STATUS: in_progress
PRIORITY: high
---

# VibeHub Tracker Workstream

GOAL: Implement `vibehub/tracker` — the `vibehub-tracker` Node+TS CLI (`login`, `start`,
`set`, `status`, `stop`, `logout`) plus an offline heartbeat queue, per
`docs/ARCHITECTURE.md` §4 (tracker heartbeat protocol) and `docs/BUILD_PLAN.md` §6
(workstream build order). Contracts are frozen; scope is limited to `vibehub/tracker/`
(plus this plan file) — `server/`, `web/`, `macos/`, `docs/` are not touched.
TIMELINE: single session
ASSIGNEE: builder agent (Claude Code)

Templates checked (mandatory template-first workflow, per project CLAUDE.md): a
`developer` template type does not exist on this server — available types are
`skills: gamedev`, `skills: product`, `skills: quadcode.ai`, `tools: designer`,
`tools: gamedev`, `tools: motion designer`. Inspected `skills: quadcode.ai`
(`dev_edit_project_config_yaml`, `dev_plug_dynamic_ui_panel_into_qcai_ide`,
`dev_create_meta_ui_to_work_with_project_data_using_html_js`, `create_skill`) and
`skills: product` (`product_create_prd`) by name/description. None apply to a headless
Node/TS CLI backend build (they target QCAI IDE config/UI panels, PRDs, gamedev, design
and motion-design asset generation) — every step below is a custom implementation,
tagged `[skill: none]`.

## Task Checklist

### Foundations
- [ ] Shared types + path constants (`~/.vibehub/{config,status,queue,tracker.pid}.json`) [skill: none]
- [ ] `config.ts`: read/write `config.json` atomically, `0700` dir / `0600` file perms (best-effort on Windows) [skill: none]
- [ ] `statusFile.ts`: atomic temp-file+rename writer/reader for `status.json` per §4.4 [skill: none]
- [ ] `queue.ts`: offline heartbeat queue — FIFO JSON-backed persistence, capped size, flush-on-reconnect [skill: none]

### Detection & heartbeat
- [ ] `processDetector.ts`: per-OS process-list scan (win32 `tasklist`, darwin/linux `ps`) for configurable tool names; best-effort cwd resolution (`/proc/<pid>/cwd` on Linux, `lsof` on macOS, degrade to `"unknown"` alias on Windows/failure) — documented in `tracker/README.md` [skill: none]
- [ ] `heartbeat.ts`: builds/POSTs the §4.3 wire body via global `fetch`, session_start/session_end transitions, idle detection (`IDLE_THRESHOLD_MS`), queue-flush-then-send ordering, privacy invariant (never send path/content/diff/prompt) [skill: none]
- [ ] `daemon.ts`: detached background loop (`start`) via hidden `run-loop` subcommand + pid file; graceful `stop` (SIGTERM, best-effort session_end, status → offline) [skill: none]

### CLI surface (`src/index.ts`, commander)
- [ ] `login <deviceToken> [--api-url]` → writes `config.json` [skill: none]
- [ ] `set <projectFolder> <alias|hidden>` → updates `projectAliases` map [skill: none]
- [ ] `start` → spawns/attaches daemon, requires prior login [skill: none]
- [ ] `status` → pretty-prints `status.json` + daemon liveness; must not throw when never configured [skill: none]
- [ ] `stop` → stops daemon if running [skill: none]
- [ ] `logout` → stops daemon, clears `config.json`, resets status to offline [skill: none]

### Docs & verification
- [ ] `tracker/README.md`: adapter table, daemon approach, offline-queue behavior, manual test steps (seed token from `server/prisma/seed.ts` per BUILD_PLAN §2.2) [skill: none]
- [ ] `npm install` at repo root (workspaces) succeeds [skill: none]
- [ ] `npm run build --workspace tracker` (tsc) succeeds with no type errors [skill: none]
- [ ] `npx . status` (inside `tracker/`) runs clean on a fresh machine (no config/status file) [skill: none]

## Success Criteria
- [ ] All six subcommands implemented and wired
- [ ] Offline heartbeat queue persists and replays events without loss or reordering
- [ ] No file path, file content, diff, or prompt text ever leaves the process (privacy invariant, ARCHITECTURE.md §3)
- [ ] `status.json` schema matches ARCHITECTURE.md §4.4 exactly
- [ ] Only files under `vibehub/tracker/` and this plan file touched — `server/`, `web/`, `macos/`, `docs/` untouched
