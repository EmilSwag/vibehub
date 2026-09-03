#!/usr/bin/env bash
# VibeHub tracker — one-line install for macOS / Linux.
#
#   curl -fsSL https://web-production-da778.up.railway.app/tracker/install.sh | bash -s -- <TRACKER_TOKEN>
#
# What it does: downloads the single-file tracker, saves your token to
# ~/.vibehub/config.json, and starts the background daemon. The tracker reads
# only local AI-tool logs (Claude Code, Codex) and window titles; no code,
# prompts or diffs ever leave your machine.
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
curl -fsSL "$WEB_URL/tracker/vibehub-tracker.cjs" -o "$BIN"

echo "→ saving token"
node "$BIN" login "$TOKEN" --api-url "$API_URL"

echo "→ starting daemon"
node "$BIN" stop >/dev/null 2>&1 || true
node "$BIN" start

cat <<EOF

✓ VibeHub tracker is running.
  Open your VibeHub tab — the "Connect your tools" card flips to Connected
  within ~30 seconds. Claude Code tokens and Cursor/VS Code/Quadcode sessions
  are counted automatically.

  status:  node $BIN status
  stop:    node $BIN stop
  restart after reboot:  node $BIN start
EOF
