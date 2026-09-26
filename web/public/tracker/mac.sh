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

# >>> vibehub-shim v1 -- keep byte-identical in connect.sh, mac.sh and mac/pkg/scripts/postinstall
# Writes the `vibehub-tracker` command, so the documented commands (status, stop,
# `hooks install cursor`) work by name instead of only as `<node> <path-to>.cjs`.
#
#   vibehub_write_shim <shim path> <install root> <node path> <tracker .cjs path>
#     0  written, or already exactly this
#     1  refused: something that is not our shim is already there (never clobbered)
#     2  could not write (permissions, read-only prefix)
#
# Removal parity, which is the point of the <install root> argument. Neither entrance has
# an uninstaller that runs on removal: a .pkg has none, and dragging VibeHub.app to the
# Trash runs nothing at all. So the shim carries the check itself:
#   - install root gone (app trashed, ~/.vibehub deleted) -> it DELETES ITSELF, then says
#     so. Nothing dangling is left behind on PATH, and a second invocation is impossible
#     because the file is no longer there.
#   - root still present but the runtime is incomplete (interrupted upgrade) -> it does
#     NOT remove itself, because a reinstall is about to repair it; it just says which
#     file is missing.
# `vibehub-tracker uninstall` does the same job from the other side, deliberately, while
# the install is still healthy.
#
# Re-running an installer rewrites the same path in place: one file, never a second copy,
# and an upgrade that moves the runtime is just a rewrite. A file without our marker is
# left untouched, whoever owns it.
VIBEHUB_SHIM_MARK='# vibehub-tracker shim v1 (managed by VibeHub; safe to delete)'
vibehub_shim_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
vibehub_write_shim() {
  vibehub_shim_path="$1"; vibehub_shim_root="$2"; vibehub_shim_node="$3"; vibehub_shim_cjs="$4"
  [ -n "$vibehub_shim_path" ] && [ -n "$vibehub_shim_root" ] || return 2
  [ -n "$vibehub_shim_node" ] && [ -n "$vibehub_shim_cjs" ] || return 2
  [ ! -L "$vibehub_shim_path" ] || return 1
  if [ -e "$vibehub_shim_path" ]; then
    [ -f "$vibehub_shim_path" ] || return 1
    grep -qF "$VIBEHUB_SHIM_MARK" "$vibehub_shim_path" 2>/dev/null || return 1
  fi
  mkdir -p "$(dirname "$vibehub_shim_path")" 2>/dev/null || return 2
  vibehub_shim_tmp="$vibehub_shim_path.vibehub-new.$$"
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' "$VIBEHUB_SHIM_MARK"
    printf '%s\n' '# Rewritten by every VibeHub install. Removes itself once VibeHub is gone.'
    printf 'VIBEHUB_ROOT=%s\n' "$(vibehub_shim_quote "$vibehub_shim_root")"
    printf 'VIBEHUB_NODE=%s\n' "$(vibehub_shim_quote "$vibehub_shim_node")"
    printf 'VIBEHUB_CJS=%s\n' "$(vibehub_shim_quote "$vibehub_shim_cjs")"
    printf '%s\n' 'if [ ! -d "$VIBEHUB_ROOT" ]; then'
    printf '%s\n' '  rm -f -- "$0" 2>/dev/null'
    printf '%s\n' '  if [ -e "$0" ]; then'
    printf '%s\n' '    printf "vibehub-tracker: VibeHub is gone; remove this command:  sudo rm -f %s\n" "$0" >&2'
    printf '%s\n' '  else'
    printf '%s\n' '    printf "vibehub-tracker: VibeHub was removed, so this command removed itself.\n" >&2'
    printf '%s\n' '  fi'
    printf '%s\n' '  exit 127'
    printf '%s\n' 'fi'
    printf '%s\n' 'if [ ! -x "$VIBEHUB_NODE" ] || [ ! -f "$VIBEHUB_CJS" ]; then'
    printf '%s\n' '  printf "vibehub-tracker: this VibeHub install is incomplete.\n" >&2'
    printf '%s\n' '  printf "  missing: %s\n" "$VIBEHUB_CJS" >&2'
    printf '%s\n' '  printf "  reinstall VibeHub to repair it.\n" >&2'
    printf '%s\n' '  exit 127'
    printf '%s\n' 'fi'
    printf '%s\n' 'exec "$VIBEHUB_NODE" "$VIBEHUB_CJS" "$@"'
  } >"$vibehub_shim_tmp" 2>/dev/null || { rm -f "$vibehub_shim_tmp" 2>/dev/null; return 2; }
  chmod 755 "$vibehub_shim_tmp" 2>/dev/null || true
  mv -f "$vibehub_shim_tmp" "$vibehub_shim_path" 2>/dev/null || { rm -f "$vibehub_shim_tmp" 2>/dev/null; return 2; }
  return 0
}
# `exec` above is deliberate: stdin, stdout, stderr and the exit code pass straight
# through, which is what `login --token-stdin` and the IDE hook command depend on.
vibehub_shim_on_path() {
  case ":${PATH:-}:" in *":$1:"*) return 0 ;; *) return 1 ;; esac
}

# Which file a PATH line has to go in to survive a new terminal.
#
# macOS Terminal and iTerm start LOGIN shells. A login bash reads ~/.bash_profile (then
# ~/.bash_login, ~/.profile) and does NOT read ~/.bashrc - so the usual ">> ~/.bashrc"
# advice is silently useless on a Mac. Linux terminals start non-login interactive shells,
# where ~/.bashrc is the right file. zsh reads ~/.zshrc either way.
vibehub_shell_rc() {
  vibehub_rc_shell="${1:-${SHELL:-}}"
  case "$vibehub_rc_shell" in
    *zsh) printf '%s' "$HOME/.zshrc" ;;
    *bash)
      if [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then printf '%s' "$HOME/.bash_profile"
      else printf '%s' "$HOME/.bashrc"; fi ;;
    *) printf '%s' "$HOME/.profile" ;;
  esac
}
# <<< vibehub-shim v1

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
  -o "$LATEST_JSON" -w '%{http_code}' "${API_URL}/api/v1/mac/latest" 2>/dev/null </dev/null || true)"
if [ "$HTTP_CODE" = "404" ]; then
  fail "No Mac release is published yet." "Check ${WEB_URL}/connect — the Mac tab shows the status."
fi
[ "$HTTP_CODE" = "200" ] && [ -s "$LATEST_JSON" ] || fail "Could not reach ${API_URL} (HTTP ${HTTP_CODE:-000})." "Check your connection and try again."

# plutil is the JSON parser that is guaranteed on every Mac (no jq, no python assumption).
json_field() {
  plutil -extract "$1" raw -o - "$LATEST_JSON" 2>/dev/null </dev/null || true
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
  --connect-timeout 20 --max-time 600 -o "$PKG" "$PKG_URL" </dev/null \
  || fail "Download failed." "$PKG_URL"
[ -s "$PKG" ] || fail "The download was empty."

# ---- 3. verify -------------------------------------------------------------------------
ACTUAL="$(shasum -a 256 "$PKG" </dev/null | awk '{print $1}')"
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
  fail "The installer did not finish." "$(tail -n 5 "$TMP/installer.log" 2>/dev/null </dev/null)"
fi
[ -d "/Applications/VibeHub.app" ] || fail "Installer finished but /Applications/VibeHub.app is missing."

# ---- 5. hand over to the app ------------------------------------------------------------
# postinstall already opened it as you; this is a harmless second nudge in case the
# console-user lookup inside the root installer did not resolve.
open -a "/Applications/VibeHub.app" >/dev/null 2>&1 </dev/null || true

echo
# ---- 4b. the `vibehub-tracker` command --------------------------------------------------
# The pkg's postinstall already wrote this command into YOUR ~/.local/bin, owned by you -
# never into /usr/local/bin, and never as root. That is what lets an ordinary Finder
# delete of VibeHub.app take the command with it: the shim notices its app is gone and
# removes itself, with no password and no leftovers. Writing it again here is a harmless
# in-place rewrite, and the fallback for an older pkg. No token is involved either way.
APP_BUNDLE="/Applications/VibeHub.app"
APP_TRACKER="$APP_BUNDLE/Contents/Resources/tracker"
USER_SHIM="$HOME/.local/bin/vibehub-tracker"
SHIM_PATH=""
SHIM_HINT=""
if vibehub_write_shim "$USER_SHIM" "$APP_BUNDLE" "$APP_TRACKER/node/bin/node" "$APP_TRACKER/vibehub-tracker.cjs"; then
  SHIM_PATH="$USER_SHIM"
  vibehub_shim_on_path "$HOME/.local/bin" || SHIM_HINT="path"
else
  SHIM_HINT="none"
fi
if [ -n "$SHIM_PATH" ]; then step "Command ready: vibehub-tracker"; fi

bold "  ✓ VibeHub ${VERSION} is installed."
echo
case "$VERSION" in
  1.0.*|0.*)
    echo "  Next, in the VibeHub menu-bar app:"
    echo "    1. open VibeHub from Applications (or menu bar)"
    echo "    2. paste your device key (from ${WEB_URL}/connect) into the app"
    echo "    3. press Start                (tracker + app then launch at login on their own)"
    ;;
  1.1.*)
    echo "  Next, in the VibeHub menu-bar app:"
    echo "    1. click 'Connect in Browser' to sign in with one click"
    echo "    2. press Start                (tracker + app then launch at login on their own)"
    ;;
  *)
    echo "  Next: open VibeHub, click Connect, approve in the browser. Done."
    echo "  (It starts at login on its own.)"
    ;;
esac
echo
echo "  If macOS blocks first launch:"
echo "    System Settings → Privacy & Security → scroll down and click 'Open Anyway'."
echo
case "$SHIM_HINT" in
  path)
    echo "  The 'vibehub-tracker' command is installed, but ~/.local/bin is not on your PATH."
    echo "  Add it, then reopen the terminal:"
    echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $(vibehub_shell_rc)"
    echo "  (a login bash on macOS reads ~/.bash_profile, not ~/.bashrc; zsh reads ~/.zshrc)"
    echo
    ;;
  none)
    echo "  The 'vibehub-tracker' command could not be installed; something that is not"
    echo "  ours already owns that name, or the location is not writable. Nothing was"
    echo "  overwritten. The menu-bar app is unaffected."
    echo
    ;;
esac
echo "  Optional, once the app is connected - count Cursor / Windsurf turns too:"
echo "    vibehub-tracker hooks install cursor"
echo "    vibehub-tracker hooks install windsurf"
echo "  Activity and model only; neither tool reports token counts."
echo
echo "  Deleting VibeHub.app removes the command too: the next time it runs it notices"
echo "  the app is gone and deletes itself. No password, nothing left behind. To remove"
echo "  it right now instead:  rm -f ~/.local/bin/vibehub-tracker"
echo
echo "  Turn everything off any time from the app; Off survives reinstalls."
echo
