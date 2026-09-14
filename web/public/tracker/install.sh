#!/usr/bin/env bash
# VibeHub tracker — setup-only install for macOS / Linux.
#
#   curl -fsSL https://web-production-da778.up.railway.app/tracker/install.sh | bash -s -- <TRACKER_TOKEN>
#
# What it does: downloads the single-file tracker to ~/.vibehub/app and
# validates + saves your token to ~/.vibehub/config.json. That is the whole job.
#
# What it never does, on every code path:
#   - start, stop or restart the tracker daemon
#   - spawn a detached or background process (no nohup, no &, no disown)
#   - register OS autostart (launchd, systemd, cron, login items)
# Installing the tracker and allowing it to run in the background are two
# separate decisions and this script only makes the first one. There is no
# flag, argument or environment variable that turns a background start back on
# here: starting the tracker is a command you run yourself, printed at the end.
# See meta/plans/vibehub-tracker-explicit-start.md.
#
# Once you do start it, the tracker reads only local AI-tool logs (Claude Code,
# Codex) and window titles; no code, prompts or diffs ever leave your machine.
set -euo pipefail

TOKEN="${1:-${VIBEHUB_TOKEN:-}}"
WEB_URL="${VIBEHUB_WEB_URL:-https://web-production-da778.up.railway.app}"
API_URL="${VIBEHUB_API_URL:-https://server-production-cc06.up.railway.app}"
APP_DIR="$HOME/.vibehub/app"
BIN="$APP_DIR/vibehub-tracker.cjs"

if [ -z "$TOKEN" ]; then
  echo "usage: install.sh <TRACKER_TOKEN>   (create one in VibeHub → Settings → Tracker)" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install it from https://nodejs.org and re-run." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js $NODE_MAJOR found; 18+ is required." >&2
  exit 1
fi

mkdir -p "$APP_DIR"
echo "→ downloading tracker"
curl -fsSL --connect-timeout 20 --max-time 120 "$WEB_URL/tracker/vibehub-tracker.cjs" -o "$BIN"
# A 200 that isn't the tracker (a captive portal, or an SPA index.html served for
# an unknown path) would otherwise surface much later as a confusing node
# SyntaxError. Fail here, before the token is sent anywhere.
SIZE="$(wc -c <"$BIN" | tr -d '[:space:]')"
if [ "$SIZE" -lt 1024 ]; then
  echo "Downloaded $SIZE bytes from $WEB_URL/tracker/vibehub-tracker.cjs — that is not the tracker. Nothing was installed." >&2
  exit 1
fi

echo "→ saving token"
# `set -e` aborts here if the server rejects the token, so a failed login can
# never be reported as a successful install.
node "$BIN" login "$TOKEN" --api-url "$API_URL"

# Setup ends here, deliberately. No start, no stop, no autostart registration.
cat <<EOF

OK Installed.
  start:   node "$BIN" start
  status:  node "$BIN" status
  stop:    node "$BIN" stop
  start runs in the background until you stop it.
EOF
