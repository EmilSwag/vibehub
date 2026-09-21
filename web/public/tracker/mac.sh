#!/bin/bash
#
# VibeHub for Mac — one-command installer.
#
#   curl -fsSL https://vibehub.app/tracker/mac.sh | bash
#
# Installs the SAME VibeHub.pkg the "Download for Mac" button offers, so both entrances
# land on one experience: the menu-bar app opens, you paste your tracker token once in
# the app, press Start, and from then on the tracker and the app launch at login by
# themselves (LaunchAgent + login item — both owned and removable from the app).
#
# Tokenless by design (FC4): this script never sees, asks for, or stores a token. The
# only inputs are two optional server URLs (VIBEHUB_API_URL / VIBEHUB_WEB_URL) for
# self-hosted setups; for vibehub.app they are not needed.
#
# What it does, in order:
#   1. asks the API which release is current   (GET /api/v1/mac/latest)
#   2. downloads VibeHub.pkg into a private temp dir
#   3. verifies its SHA-256 against the release checksum — aborts if either is missing
#   4. runs Apple's installer (asks for your password once, via sudo)
#   5. the package's postinstall opens VibeHub.app for you
#
# It reads nothing else on this Mac and does not touch ~/.vibehub except to write the
# optional server selection (handoff.json, 0600) when a non-default server was given.
set -euo pipefail

# Same defaults as connect.sh; the web's Mac tab passes both explicitly anyway.
DEFAULT_API_URL="https://server-production-cc06.up.railway.app"
DEFAULT_WEB_URL="https://web-production-da778.up.railway.app"
API_URL="${VIBEHUB_API_URL:-$DEFAULT_API_URL}"
WEB_URL="${VIBEHUB_WEB_URL:-$DEFAULT_WEB_URL}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
step() { printf '  \033[36m→\033[0m %s\n' "$1"; }
fail() { printf '\n  \033[31m✗ %s\033[0m\n' "$1" >&2; [ -n "${2:-}" ] && printf '    %s\n' "$2" >&2; exit 1; }

echo
bold "VibeHub for Mac"
echo

# ---- 0. preflight -------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS." "On Linux or Windows use the tracker: ${WEB_URL}/connect"
[ "${EUID}" -ne 0 ] || fail "Run this as your normal user, not as root." "The installer will ask for your password when it needs it."
for tool in curl shasum installer mktemp plutil; do
  command -v "$tool" >/dev/null 2>&1 || fail "Missing '$tool' — it ships with macOS, so this Mac looks unusual." "Install VibeHub.pkg by hand from ${WEB_URL}/connect instead."
done
case "$API_URL" in https://*|http://localhost*|http://127.0.0.1*) ;; *) fail "VIBEHUB_API_URL must be https:// (or localhost for development)." ;; esac
case "$WEB_URL" in https://*|http://localhost*|http://127.0.0.1*) ;; *) fail "VIBEHUB_WEB_URL must be https:// (or localhost for development)." ;; esac

TMP="$(mktemp -d -t vibehub-install)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# ---- 1. which release is current -----------------------------------------------------
step "Checking the current release…"
LATEST_JSON="$TMP/latest.json"
HTTP_CODE="$(curl -q --fail --silent --show-error --location --max-redirs 3 --proto '=https,http' \
  --connect-timeout 20 --max-time 60 -H 'Accept: application/json' \
  -o "$LATEST_JSON" -w '%{http_code}' "${API_URL}/api/v1/mac/latest" 2>/dev/null || true)"
if [ "$HTTP_CODE" = "404" ]; then
  fail "No Mac release is published yet." "Check ${WEB_URL}/connect — the Mac tab shows the status."
fi
[ "$HTTP_CODE" = "200" ] && [ -s "$LATEST_JSON" ] || fail "Could not reach ${API_URL} (HTTP ${HTTP_CODE:-000})." "Check your connection and try again."

# plutil is the JSON parser that is guaranteed on every Mac (no jq, no python assumption).
json_field() {
  plutil -extract "$1" raw -o - "$LATEST_JSON" 2>/dev/null || true
}
VERSION="$(json_field version)"
PKG_URL="$(json_field pkgUrl)"
SHA256="$(json_field sha256 | tr 'A-F' 'a-f')"
[ -n "$VERSION" ] && [ -n "$PKG_URL" ] || fail "The release answer was incomplete." "Try again in a minute, or download from ${WEB_URL}/connect."
case "$PKG_URL" in https://github.com/*|https://objects.githubusercontent.com/*|https://*.githubusercontent.com/*) ;; *) fail "Refusing an unexpected download host." "$PKG_URL" ;; esac
if ! printf '%s' "$SHA256" | grep -Eq '^[0-9a-f]{64}$'; then
  fail "This release has no checksum, so it will not be installed unverified." "Download VibeHub.pkg from ${WEB_URL}/connect if you want to proceed by hand."
fi
step "VibeHub ${VERSION}"

# ---- 2. download ----------------------------------------------------------------------
PKG="$TMP/VibeHub.pkg"
step "Downloading…"
curl -q --fail --silent --show-error --location --max-redirs 5 --proto '=https' \
  --connect-timeout 20 --max-time 600 -o "$PKG" "$PKG_URL" \
  || fail "Download failed." "$PKG_URL"
[ -s "$PKG" ] || fail "The download was empty."

# ---- 3. verify -------------------------------------------------------------------------
ACTUAL="$(shasum -a 256 "$PKG" | awk '{print $1}')"
[ "$ACTUAL" = "$SHA256" ] || fail "Checksum mismatch — the download does not match the published release, nothing was installed." "expected ${SHA256}
  got      ${ACTUAL}"
step "Checksum verified"

# ---- 3b. server selection for self-hosted setups (non-secret, 0600) -------------------
if [ "$API_URL" != "$DEFAULT_API_URL" ] || [ "$WEB_URL" != "$DEFAULT_WEB_URL" ]; then
  HANDOFF_DIR="$HOME/.vibehub"
  HANDOFF="$HANDOFF_DIR/handoff.json"
  if [ -L "$HANDOFF_DIR" ] || [ -L "$HANDOFF" ]; then
    fail "~/.vibehub or handoff.json is a symlink; refusing to write through it."
  fi
  mkdir -p "$HANDOFF_DIR" && chmod 700 "$HANDOFF_DIR"
  umask 077
  printf '{"apiUrl":"%s","webUrl":"%s"}\n' "$API_URL" "$WEB_URL" > "$HANDOFF"
  chmod 600 "$HANDOFF"
  step "Server selection saved for the app (${API_URL})"
fi

# ---- 4. install -------------------------------------------------------------------------
echo
step "Installing to /Applications — macOS will ask for your password."
# `</dev/null` matters: under `curl … | bash` the script itself IS bash's stdin, and any
# child that reads stdin would swallow the rest of this file. sudo still prompts on the
# terminal (/dev/tty), so the password ask is unaffected.
if ! sudo -p "  Password for %u: " installer -pkg "$PKG" -target / >"$TMP/installer.log" 2>&1 </dev/null; then
  fail "The installer did not finish." "$(tail -n 5 "$TMP/installer.log" 2>/dev/null)"
fi
[ -d "/Applications/VibeHub.app" ] || fail "Installer finished but /Applications/VibeHub.app is missing."

# ---- 5. hand over to the app ------------------------------------------------------------
# postinstall already opened it as you; this is a harmless second nudge in case the
# console-user lookup inside the root installer did not resolve.
open -a "/Applications/VibeHub.app" >/dev/null 2>&1 </dev/null || true

echo
bold "  ✓ VibeHub ${VERSION} is installed."
echo
echo "  Next, in the VibeHub menu-bar app:"
echo "    1. paste your tracker token   (${WEB_URL}/settings → Tracker)"
echo "    2. press Start                (tracker + app then launch at login on their own)"
echo
echo "  Turn everything off any time from the app; Off survives reinstalls."
echo
