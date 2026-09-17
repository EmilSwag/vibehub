# Installing the VibeHub tracker

One command per OS. Setup is idempotent: re-running it refreshes the tracker and the
saved device token without touching anything else on your machine.

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
| 1 Node.js | Reuses a system Node ≥ 18 if present. Otherwise downloads the pinned **v24.21.0** from `nodejs.org`, checks its SHA-256 against a hash baked into the script, and installs only the `node` binary + LICENSE into `~/.vibehub/runtime`. PATH is never modified. |
| 2 Tracker | Downloads `vibehub-tracker.cjs` (single file, no npm) into a staging dir, runs `node --check`, then atomically moves it into `~/.vibehub/app`. |
| 3 Token | Calls `GET /api/v1/tracker/verify` with the token in an `Authorization` header (never in a URL). Fails closed on anything but a valid `{ username }`. |
| 4 Config | `~/.vibehub/config.json`, mode `0600`, directory `0700`. |
| 5 Start | Only with `--start` / `-Start`. Spawns the background daemon and confirms it with an independent `status` call. No launchd / Task Scheduler / registry entries. |

Colours and ✓ glyphs appear only in an interactive UTF-8 terminal; `NO_COLOR=1` or a
non-TTY gives plain text. Every failure prints one red `✗` line plus a one-line hint and
exits non-zero. If the failure happens before step 5, the hint reads *Nothing was started*.

## 4. What the tracker reads and sends

- **Reads:** Claude Code (`~/.claude/projects/**/*.jsonl`) and Codex
  (`~/.codex/sessions/**/*.jsonl`) session logs. Nothing else — no process list, window
  titles, browser, keyboard/idle, Git, other AI tools (Quadcode, Cursor, ChatGPT are not
  tracked).
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

If the connector reused your system Node, replace the runtime path with plain `node`.
The web app's **Connect** sheet prints the exact commands for your device.

Rename or hide a project alias: `… vibehub-tracker.cjs set <path> "<alias>"`.

## 6. Uninstall

1. `… vibehub-tracker.cjs stop`
2. Delete `~/.vibehub` (Windows: `%USERPROFILE%\.vibehub`).
3. Optionally revoke the token in VibeHub → Settings → Tracker.

Nothing else was written outside that directory.

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
| Shows *Connected · idle* | Normal when no Claude Code / Codex session has produced tokens recently. |

## Requirements

- macOS 13.5+ (x64 / Apple Silicon) or Linux with glibc 2.28+ and kernel 4.18+
  (x64 / arm64); `bash` 3.2+, `curl`, `tar`, `shasum` or `sha256sum`.
- Windows 10+ (x64 / arm64), Windows PowerShell 5.1 or PowerShell 7.
- Outbound HTTPS to `web-production-da778.up.railway.app`,
  `server-production-cc06.up.railway.app` and, if Node is bootstrapped, `nodejs.org`.
