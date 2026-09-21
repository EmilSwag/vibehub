# Installing the VibeHub tracker

One command per OS. Setup is idempotent: re-running it refreshes the tracker and the
saved device token without touching anything else on your machine.

## macOS: VibeHub for Mac

On a Mac, install the app instead of the connector. `VibeHub.app` carries the tracker and
its private Node runtime, lives in the menu bar, and — once you start tracking inside the
app — brings the tracker back at every login. Turning it off in the app keeps it off,
across relaunch, reinstall and upgrade.

Two entrances, one package, **neither carrying a device token**:

1. **Download.** VibeHub → **Settings → Tracker → macOS app → Download VibeHub for Mac**.
2. **One command:**

   ```bash
   curl -fsSL https://web-production-da778.up.railway.app/tracker/mac.sh | bash
   ```

Both resolve the newest `mac-v*` release through `GET /api/v1/mac/latest`, install the
same `VibeHub.pkg` and open the app. The command verifies the release's published SHA-256
first and stops rather than installing when that checksum is missing or does not match.

The app asks for a device token on first launch. Create one on that same **macOS app**
tab — *Create a device key* — and paste it into the app. The token is issued only when
you press that button, is shown once, and is not saved in the browser. It is never in the
download, in the command, in a URL or in the environment.

| | |
|---|---|
| Requirements | macOS 13 or later, Apple Silicon or Intel. |
| Releases come from | `github.com/EmilSwag/vibehub` — the `mac-v*` tags. Server-side this is `MAC_RELEASE_REPO`. |
| Installs | `/Applications/VibeHub.app` plus, after you start tracking, `~/Library/LaunchAgents/com.vibehub.tracker.plist`. |
| Tracking starts | Only when you start it in the app — installing and opening track nothing. |
| First launch blocked | Open it once from Finder with right-click → **Open**. |
| Not released yet | Before the first `mac-v*` release the endpoint answers 404 and Settings says *not released yet* instead of offering a dead button. Use the connector below on that Mac meanwhile. |

Everything from section 1 onward describes the cross-platform connector
(`connect.sh` / `connect.ps1`) — the path for Linux and Windows, still available on macOS.

## 1. Get a device token

VibeHub → **Settings → Tracker → New token**. Treat it like a password: it is the only
thing that lets a device report as you. Revoke it there if a device is lost.

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

> The web app (Home → **Connect**) generates a hardened variant of the same command:
> `set -o pipefail`, no redirects, pinned `--proto '=https'`, explicit
> `VIBEHUB_API_URL` / `VIBEHUB_WEB_URL`, and token cleanup in a `finally` block on
> Windows. Prefer that one when you can copy from the app.

## 3. What happens

```
VibeHub
Connecting this device
What this does
  One device installation covers supported tools. It does not install AI apps or connect their accounts.
  Local reads: Claude Code (~/.claude/projects) and Codex (~/.codex/sessions) session logs (JSONL) only; …
  Uploads: tool, model, timing, token counts and a bounded project alias only.
  …
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
| Launcher | A small `vibehub-tracker` command is written so the commands below work by name — `~/.local/bin/vibehub-tracker` on macOS and Linux, `%LOCALAPPDATA%\Programs\VibeHub\vibehub-tracker.cmd` on Windows (per user, so no administrator is needed to install it *or* to remove it). It is ours and rewritten in place on every re-install; a file of that name the installer does not recognise is left untouched. If that directory is not already on your PATH, the installer says so and prints both the line to add and the full-path form to use meanwhile. |

Colours and ✓ glyphs appear only in an interactive UTF-8 terminal; `NO_COLOR=1` or a
non-TTY gives plain text. Every failure prints one red `✗` line plus a one-line hint and
exits non-zero. If the failure happens before step 5, the hint reads *Nothing was started*.

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

With the launcher's directory on your PATH the short form works everywhere:
`vibehub-tracker start` / `status` / `stop` / `hooks status`. That directory is
`~/.local/bin` on macOS and Linux and `%LOCALAPPDATA%\Programs\VibeHub` on Windows. If it
is not on your PATH the connector prints the exact line to add it — an `export PATH=…`
line for the file your login shell really reads, or on Windows

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:LOCALAPPDATA\Programs\VibeHub", 'User')
```

which is the User scope, so no administrator is needed; reopen the terminal afterwards.
(The directory has to go in resolved, as above — a literal `%LOCALAPPDATA%` would be stored
unexpanded and the entry would never match anything. The connector prints the line with
your own absolute path already substituted.)
(`setx` would also work but truncates PATH at 1024 characters, so it is not the advice.)
If the connector reused your system Node, replace the runtime path with plain `node`. The
web app's **Connect** sheet prints the exact commands for your device.

Rename or hide a project alias: `… vibehub-tracker.cjs set <path> "<alias>"`.

## 6. Uninstall

```bash
vibehub-tracker uninstall
```

That stops the daemon, removes the Cursor/Windsurf hook entries from your own hook files,
clears the saved config and deletes its launcher. The downloaded tracker, the private Node
runtime and the metadata inbox stay where they are, and the command prints the one line
that removes them — deleting a directory on your behalf is not something an uninstaller
should decide silently.

Manually, if you prefer: `… vibehub-tracker.cjs stop`, then delete `~/.vibehub`
(Windows: `%USERPROFILE%\.vibehub`) and the launcher —
`~/.local/bin/vibehub-tracker`, or `%LOCALAPPDATA%\Programs\VibeHub\vibehub-tracker.cmd`
on Windows. Optionally revoke the token in VibeHub → Settings → Tracker. If you delete
`~/.vibehub` and forget the launcher, it removes itself the next time it is run rather
than sitting on your PATH as a broken command.

Outside those two paths and your own hook files, nothing was written.

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
