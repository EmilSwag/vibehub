# Installing the VibeHub tracker

One command per OS. Setup is idempotent: re-running it refreshes the tracker and the
saved device token without touching anything else on your machine.

## macOS: VibeHub for Mac

On a Mac, install the app instead of the connector. `VibeHub.app` carries the tracker and
its own Node runtime, and lives in the menu bar (plus an optional notch island).

```bash
curl -fsSL https://web-production-da778.up.railway.app/tracker/mac.sh | bash
```

Or download it from VibeHub → **Connect VibeHub → macOS app**, or the `.pkg` from
[Releases](https://github.com/EmilSwag/vibehub/releases/latest). Both install the newest
`mac-v*` release (`GET /api/v1/mac/latest`); the command checks the published SHA-256
first and stops if it is missing or wrong.

Then open VibeHub → **Connect** → approve on the page that opens. No token is ever in the
download, the command or a URL. *Trouble?* takes a pasted device key instead.

| | |
|---|---|
| Requirements | macOS 13+, Apple Silicon or Intel. |
| Tracking starts | Only when you press **Start Tracking** in the app. Then it resumes at login until you switch off **Start with my Mac** — and off stays off across relaunch, reinstall and upgrade. |
| Installs | `/Applications/VibeHub.app`; after you start tracking, `~/Library/LaunchAgents/com.vibehub.tracker.plist`. |
| First launch blocked | System Settings → Privacy & Security → **Open Anyway** (older macOS: right-click → **Open**). |
| Releases | `mac-v*` tags of `github.com/EmilSwag/vibehub` (server env `MAC_RELEASE_REPO`). Before the first one the endpoint answers 404 and the web says *not released yet* — use the connector meanwhile. |

Everything below is the cross-platform connector (`connect.sh` / `connect.ps1`) — the path
for Linux and Windows, still available on macOS.

## 1. Get a device token

Press **Connect VibeHub** in the web app: it creates a token and prints the full command for
your OS. Treat the token like a password; revoke it in **Settings → Tracker** if a device is
lost.

## 2. Run the connector

### macOS / Linux

```bash
curl -fsSL https://web-production-da778.up.railway.app/tracker/connect.sh | VIBEHUB_TOKEN='<device token>' bash -s -- --start
```

Setup only (install, verify, save — do not start):

```bash
curl -fsSL https://web-production-da778.up.railway.app/tracker/connect.sh | VIBEHUB_TOKEN='<device token>' bash -s --
```

### Windows (PowerShell 5.1+)

```powershell
$env:VIBEHUB_TOKEN='<device token>'; & ([scriptblock]::Create((irm https://web-production-da778.up.railway.app/tracker/connect.ps1))) -Start; Remove-Item Env:VIBEHUB_TOKEN
```

Setup only: drop `-Start`.

> The **Connect VibeHub** sheet prints a hardened variant of the same command (`set -o
> pipefail`, pinned `--proto '=https'`, explicit `VIBEHUB_API_URL` / `VIBEHUB_WEB_URL`,
> token cleanup on Windows). Prefer copying that one.

## 3. What happens

```
VibeHub
Connecting this device
✓ [1/5] Node.js ready (v24.21.0, private runtime)
✓ [2/5] Tracker downloaded
✓ [3/5] Device token verified as @you
✓ [4/5] Configuration saved
✓ [5/5] Start running (pid 4242)
─── Installed in ~/.vibehub ─────────────────────────
  start:  '/Users/you/.vibehub/runtime/bin/node' '/Users/you/.vibehub/app/vibehub-tracker.cjs' start
  status: '/Users/you/.vibehub/runtime/bin/node' '/Users/you/.vibehub/app/vibehub-tracker.cjs' status
  stop:   '/Users/you/.vibehub/runtime/bin/node' '/Users/you/.vibehub/app/vibehub-tracker.cjs' stop

Open VibeHub — it turns green after the first ping.
────────────────────────────────────────────────────
Done in 6s.
```

| Step | Detail |
|---|---|
| 1 Node.js | Reuses a system Node ≥ 18 if present. Otherwise downloads the pinned **v24.21.0** from `nodejs.org`, checks its SHA-256 against a hash baked into the script, and installs only the `node` binary + LICENSE into `~/.vibehub/runtime`. Your PATH is never edited. |
| 2 Tracker | Downloads `vibehub-tracker.cjs` (single file, no npm) into a staging dir, runs `node --check`, then atomically moves it into `~/.vibehub/app`. |
| 3 Token | Calls `GET /api/v1/tracker/verify` with the token in an `Authorization` header (never in a URL). Fails closed on anything but a valid `{ username }`. |
| 4 Config | `~/.vibehub/config.json`, mode `0600`, directory `0700`. |
| 5 Start | Only with `--start` / `-Start`. Spawns the background daemon and confirms it with an independent `status` call. No launchd / Task Scheduler / registry entries. |
| Launcher | Writes a per-user `vibehub-tracker` command (`~/.local/bin`, or `%LOCALAPPDATA%\Programs\VibeHub` on Windows) so the commands below work by name. No administrator needed; a foreign file of that name is left untouched. If the folder is not on your PATH, the installer prints the line to add. |

`NO_COLOR=1` or a non-TTY gives plain text. Every failure prints one `✗` line with a hint
and exits non-zero; before step 5 that hint reads *Nothing was started*.

## 4. What the tracker reads and sends

- **Reads:** the session logs of Claude Code (`~/.claude/projects/**/*.jsonl`), Codex
  (`~/.codex/sessions/**/*.jsonl`) and Quadcode AI (its per-project chat JSONL), plus
  `~/.vibehub/attested.jsonl` — the inbox the Cursor/Windsurf hook writes to, read only
  while you have that hook installed. Nothing else: no process list, window titles,
  browser, keyboard/idle and no Git. ChatGPT in the browser or desktop app is **not**
  tracked — it leaves no local record to read.
- **Cursor and Windsurf are reported without being read.** Neither writes a session log
  we could parse, so instead their own hook mechanism runs one VibeHub command when an AI
  turn completes, and that command appends a single metadata line — tool, time, model id,
  project folder name. It is off until you install it:

  ```bash
  vibehub-tracker hooks install cursor
  vibehub-tracker hooks install windsurf
  vibehub-tracker hooks status
  vibehub-tracker hooks uninstall cursor
  ```

  Install merges into your own `~/.cursor/hooks.json` /
  `~/.codeium/windsurf/hooks.json`, keeping any hooks you already had, and backs the file
  up first. The prompt, the response, the transcript, the workspace path and your email
  are all available to that hook and none of them are read.
- **Tokens.** Claude Code and Codex report usage per turn, so their counts are real.
  Quadcode AI, Cursor and Windsurf report none, so VibeHub shows *tokens not reported*
  for them and leaves them out of the ≈$ estimate. Nothing is ever inferred from the
  length of a prompt or a reply.
- Parsing may temporarily read records that contain prompts, code and tool output. Those
  contents are not stored and not sent.
- **Sends:** tool, model, timestamps/duration, token counts and a bounded project alias.
  Plus a bodyless connection ping (`POST /api/v1/tracker/connection`) so VibeHub can
  show "connected" even when no AI session is running.
- Profiles and statistics are public. Live presence cards are visible to accepted friends.
- **Connected** = a recent server-accepted tracker connection. **Idle** = no recent
  supported AI activity — not an idle computer.

## 5. Manage

| | macOS / Linux | Windows |
|---|---|---|
| Start | `~/.vibehub/runtime/bin/node ~/.vibehub/app/vibehub-tracker.cjs start` | `& "$HOME\.vibehub\runtime\node.exe" "$HOME\.vibehub\app\vibehub-tracker.cjs" start` |
| Status | `… vibehub-tracker.cjs status` | `… vibehub-tracker.cjs status` |
| Stop | `… vibehub-tracker.cjs stop` | `… vibehub-tracker.cjs stop` |

With the launcher on your PATH the short form works everywhere:
`vibehub-tracker start` / `status` / `stop` / `hooks status`. If it is not, the connector
prints the exact line to add — an `export PATH=…` for your login shell, or on Windows (User
scope, no administrator; reopen the terminal afterwards):

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:LOCALAPPDATA\Programs\VibeHub", 'User')
```

Avoid `setx` — it truncates PATH at 1024 characters. If the connector reused your system
Node, replace the runtime path with plain `node`.

Rename or hide a project alias: `… vibehub-tracker.cjs set <path> "<alias>"`.

## 6. Uninstall

```bash
vibehub-tracker uninstall
```

Stops the daemon, removes the Cursor/Windsurf hook entries, clears the config and deletes
the launcher. The tracker files and Node runtime stay in `~/.vibehub`; the command prints
the one line that removes them.

Manually: `… vibehub-tracker.cjs stop`, then delete `~/.vibehub` (Windows:
`%USERPROFILE%\.vibehub`) and the launcher. Optionally revoke the token in Settings →
Tracker. Nothing else was written outside those paths and your own hook files.

**Mac app:** VibeHub → Settings → **Sign Out of This Mac** (stops the tracker, removes its
LaunchAgent and login item), quit, then move `/Applications/VibeHub.app` to the Trash.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Another setup may be in progress` | A previous run was interrupted. Remove only the empty `~/.vibehub/.connect.lock` directory and retry. |
| `Set VIBEHUB_TOKEN to a device token…` | Token missing or malformed in the environment. Copy it again from Settings → Tracker. |
| `Login failed` / `token rejected` | Token revoked or for another server. Mint a new one. Nothing was started. |
| `Automatic Node setup requires macOS 13.5+ / glibc 2.28+` | Install Node ≥ 18 yourself; the connector will reuse it. |
| `This is Git Bash/MSYS/Cygwin` / `WSL is not supported` | Use the Windows PowerShell command instead. |
| PowerShell: *running scripts is disabled* | The one-liner uses `irm` + `scriptblock`, which does not require changing the execution policy. If your org blocks it, download `connect.ps1` and run it with `powershell -ExecutionPolicy Bypass -File connect.ps1 -Start`. |
| Tracker runs, VibeHub still grey | Wait ~30 s for the first ping. Check `status`: `Connected: yes` plus a fresh server heartbeat is required. Corporate proxies that strip `Authorization` headers break this. |
| Shows *Connected · idle* | Normal when no supported tool has produced AI activity recently. |
| Cursor / Windsurf rows say *unknown* instead of a project | Working as intended, and not specific to hooks: a folder name is only ever sent once **you** map it in Settings → Projects. Until then every tool reports `unknown`, so no folder name leaves your machine by accident. |
| Cursor / Windsurf never appear | Run `vibehub-tracker hooks status`. If it reports the hook as missing, the IDE never ran it: re-run `hooks install`, then restart the IDE so it re-reads its hook file. Note that only a completed AI turn counts — opening the editor does not. |
| `vibehub-tracker: command not found` | The launcher's directory is not on your PATH — `~/.local/bin`, or `%LOCALAPPDATA%\Programs\VibeHub` on Windows. Add it as the installer printed and reopen the terminal, or call the launcher by its full path. |

## Requirements

- macOS 13.5+ (x64 / Apple Silicon) or Linux with glibc 2.28+ and kernel 4.18+
  (x64 / arm64); `bash` 3.2+, `curl`, `tar`, `shasum` or `sha256sum`.
- Windows 10+ (x64 / arm64), Windows PowerShell 5.1 or PowerShell 7.
- Outbound HTTPS to `web-production-da778.up.railway.app`,
  `server-production-cc06.up.railway.app` and, if Node is bootstrapped, `nodejs.org`.
