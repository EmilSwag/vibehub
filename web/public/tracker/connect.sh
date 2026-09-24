#!/usr/bin/env bash
# VibeHub device connector. Setup only unless the caller explicitly passes --start.
# Kept separate from install.sh: legacy callers never acquire start permission.
# Pins: official nodejs.org v24.21.0 SHASUMS256.txt, checked 2026-09-16.
# Keep LF-only. No runtime/hash/origin override for Node is supported.
set +x
set +v
VIBEHUB_START_TS=$(date +%s 2>/dev/null || echo 0)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then VIBEHUB_COLOR=1; else VIBEHUB_COLOR=0; fi
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *UTF-8*|*utf8*|*UTF8*) VIBEHUB_UTF8=1 ;; *) VIBEHUB_UTF8=0 ;; esac
if [ "$VIBEHUB_COLOR" = 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_RESET=$'\033[0m'
else
  C_BOLD=''; C_DIM=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_RESET=''
fi
if [ "$VIBEHUB_UTF8" = 1 ]; then
  G_CHECK=$'\xe2\x9c\x93'; G_CROSS=$'\xe2\x9c\x97'; G_DASH=$'\xe2\x80\x94'; B_H=$'\xe2\x94\x80'
else
  G_CHECK='+'; G_CROSS='x'; G_DASH='-'; B_H='-'
fi
box_rule() { local n="$1" ch="$2" out='' i=0; while [ "$i" -lt "$n" ]; do out="$out$ch"; i=$((i + 1)); done; printf '%s' "$out"; }
printf '%s\n' "${C_BOLD}VibeHub${C_RESET}"
printf '%s\n' 'Connecting this device'

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

vibehub_connect_main() (
  set -euo pipefail
  umask 077
  TOKEN="${VIBEHUB_TOKEN:-}"
  unset VIBEHUB_TOKEN NODE_OPTIONS NODE_PATH
  WEB_URL="${VIBEHUB_WEB_URL:-https://web-production-da778.up.railway.app}"
  API_URL="${VIBEHUB_API_URL:-https://server-production-cc06.up.railway.app}"
  START=0
  STAGE=''
  LOCK=''
  ATTEMPTED_START=0
  NODE_VERSION='v24.21.0'
  NODE_ORIGIN='https://nodejs.org/dist'
  NODE=''

  fail() {
    printf '%s%s%s VibeHub: %s\n' "$C_RED" "$G_CROSS" "$C_RESET" "$1" >&2
    if [ "$ATTEMPTED_START" -eq 0 ]; then
      printf '%s%s%s\n' "$C_DIM" 'Nothing was started.' "$C_RESET" >&2
    else
      printf '%s%s%s\n' "$C_DIM" 'A start was attempted; check its status before retrying.' "$C_RESET" >&2
    fi
    exit 1
  }
  cleanup() {
    TOKEN=''
    unset VIBEHUB_TOKEN
    if [ -n "$STAGE" ]; then rm -rf -- "$STAGE"; fi
    if [ -n "$LOCK" ]; then rmdir -- "$LOCK" 2>/dev/null || true; fi
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP

  # A deliberately narrow origin grammar: no credentials, paths, query or fragment.
  # HTTP is allowed only for the three literal loopback development hosts.
  origin() {
    local value="$1" scheme host port label rest
    local pattern='^(https?)://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[::1\])(:([0-9]{1,5}))?/?$'
    [[ "$value" =~ $pattern ]] || fail 'Use an HTTPS deployment origin, without a path or credentials.'
    scheme="${BASH_REMATCH[1]}"; host="${BASH_REMATCH[2]}"; port="${BASH_REMATCH[5]:-}"
    if [ -n "$port" ]; then
      [ "$((10#$port))" -ge 1 ] && [ "$((10#$port))" -le 65535 ] || fail 'Invalid deployment port.'
    fi
    host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
    if [ "$scheme" = http ]; then
      case "$host" in localhost|127.0.0.1|'[::1]') ;; *) fail 'HTTP is allowed only on loopback for development.' ;; esac
    fi
    if [ "$host" != '[::1]' ]; then
      rest="$host"
      while :; do
        label="${rest%%.*}"
        [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] && [ "${#label}" -le 63 ] || fail 'Invalid deployment hostname.'
        [ "$rest" != "$label" ] || break
        rest="${rest#*.}"
      done
    fi
    printf '%s' "${value%/}"
  }

  # curl -q ignores personal .curlrc. No redirects, TLS relaxation or secret argv.
  # The token is supplied to curl on stdin, not in its process arguments.
  download() {
    local url="$1" target="$2" limit="$3" seconds="$4" credential="${5:-}" code size
    if ! code="$( { if [ -n "$credential" ]; then printf 'header = "Authorization: Bearer %s"\n' "$credential"; fi; } |
      curl -q --fail --silent --show-error --proto '=https,http' --max-redirs 0 \
        --connect-timeout 20 --max-time "$seconds" --max-filesize "$limit" \
        --config - --output "$target" --write-out '%{http_code}' "$url" 2>/dev/null)"; then
      fail 'Download or token verification failed (network, HTTP error or timeout). Retry when the selected service is available.'
    fi
    case "$code" in 2[0-9][0-9]) ;; *) fail 'The selected service returned a non-success response; redirects are not followed.' ;; esac
    size="$(wc -c < "$target" | tr -d '[:space:]')"
    [ "$size" -gt 0 ] && [ "$size" -le "$limit" ] || fail 'Download was empty or exceeded its size limit.'
  }

  compatible_node() {
    local version
    [ -f "$1" ] && [ -x "$1" ] || return 1
    version="$("$1" --version 2>/dev/null)" || return 1
    [[ "$version" =~ ^v([0-9]+)\.[0-9]+\.[0-9]+$ ]] || return 1
    [ "${BASH_REMATCH[1]}" -ge 18 ]
  }

  sha256() {
    local result
    if command -v sha256sum >/dev/null 2>&1; then
      result="$(sha256sum < "$1")" || return 1
    elif command -v shasum >/dev/null 2>&1; then
      result="$(shasum -a 256 < "$1")" || return 1
    else
      fail 'A SHA-256 utility (shasum or sha256sum) is required. Nothing unverified will run.'
    fi
    printf '%s' "${result%% *}"
  }

  bootstrap_node() {
    local archive hash name candidate version libc kernel major minor
    case "$PLATFORM-$ARCH" in
      darwin-x64) hash='1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097' ;;
      darwin-arm64) hash='bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057' ;;
      linux-x64) hash='6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff' ;;
      linux-arm64) hash='724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5' ;;
      *) fail 'No verified Node runtime is available for this platform.' ;;
    esac
    if [ "$PLATFORM" = darwin ]; then
      version="$(sw_vers -productVersion 2>/dev/null)" || fail 'Could not verify the macOS version.'
      [[ "$version" =~ ^([0-9]+)\.([0-9]+)(\.[0-9]+)?$ ]] || fail 'Could not verify the macOS version.'
      major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"
      [ "$major" -gt 13 ] || { [ "$major" -eq 13 ] && [ "$minor" -ge 5 ]; } || fail 'Automatic Node setup requires macOS 13.5 or newer.'
    else
      libc="$(getconf GNU_LIBC_VERSION 2>/dev/null)" || fail 'Automatic Node setup requires GNU/Linux with glibc 2.28+. musl/Alpine is not supported.'
      [[ "$libc" =~ ^glibc\ ([0-9]+)\.([0-9]+)$ ]] || fail 'Could not verify glibc; no runtime was installed.'
      major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"
      [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 28 ]; } || fail 'Automatic Node setup requires glibc 2.28 or newer.'
      kernel="$(uname -r)"
      [[ "$kernel" =~ ^([0-9]+)\.([0-9]+) ]] || fail 'Could not verify the Linux kernel.'
      major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"
      [ "$major" -gt 4 ] || { [ "$major" -eq 4 ] && [ "$minor" -ge 18 ]; } || fail 'Automatic Node setup requires Linux kernel 4.18 or newer.'
    fi
    command -v tar >/dev/null 2>&1 || fail 'tar is required to unpack the private Node runtime.'
    name="node-$NODE_VERSION-$PLATFORM-$ARCH"
    archive="$STAGE/node.tar.gz"
    printf '  %s%s%s\n' "$C_DIM" "Downloading private Node.js $NODE_VERSION ($PLATFORM-$ARCH) from nodejs.org, SHA-256 verified before use" "$C_RESET"
    download "$NODE_ORIGIN/$NODE_VERSION/$name.tar.gz" "$archive" 201326592 180
    [ "$(sha256 "$archive")" = "$hash" ] || fail 'Node SHA-256 mismatch. The download was not extracted or executed; retry with a fresh command.'
    # Extract only the two pinned archive members we need, never npm or shell hooks.
    tar -xzf "$archive" -C "$STAGE" --no-same-owner "$name/bin/node" "$name/LICENSE" 2>/dev/null || fail 'Node archive is incomplete or could not be unpacked.'
    candidate="$STAGE/$name/bin/node"
    [ ! -L "$candidate" ] && [ -f "$candidate" ] && [ ! -L "$STAGE/$name/bin" ] || fail 'Unexpected Node archive layout.'
    [ -f "$STAGE/$name/LICENSE" ] && [ ! -L "$STAGE/$name/LICENSE" ] || fail 'Node license is missing from the archive.'
    chmod 700 "$candidate"
    version="$("$candidate" --version 2>/dev/null)" || fail 'The verified Node runtime cannot run on this OS (check OS and system library support). The previous runtime was kept.'
    [ "$version" = "$NODE_VERSION" ] || fail 'Downloaded Node reported the wrong version. The previous runtime was kept.'
    mkdir -p "$RUNTIME/bin"
    [ ! -L "$RUNTIME/bin" ] && [ -d "$RUNTIME/bin" ] || fail 'Runtime bin directory must not be a symbolic link.'
    [ ! -L "$RUNTIME/bin/node" ] && { [ ! -e "$RUNTIME/bin/node" ] || [ -f "$RUNTIME/bin/node" ]; } || fail 'Unexpected existing runtime path.'
    # Same-filesystem file rename: a failed download/probe never replaces working Node.
    # Install the license first so its failure cannot replace a working executable.
    mv -f -- "$STAGE/$name/LICENSE" "$RUNTIME/LICENSE" || fail 'Could not install the Node license. The previous runtime was kept.'
    mv -f -- "$candidate" "$RUNTIME/bin/node" || fail 'Could not promote Node. The previous runtime was kept.'
    NODE="$RUNTIME/bin/node"
  }

  controls() {
    local verb label rule_top rule_bottom
    rule_top="$(box_rule 3 "$B_H") Installed in ~/.vibehub $(box_rule 22 "$B_H")"
    rule_bottom="$(box_rule 52 "$B_H")"
    printf '%s\n' "${C_BOLD}${rule_top}${C_RESET}"
    for verb in start status stop; do
      case "$verb" in start) label='start:  ' ;; status) label='status: ' ;; stop) label='stop:   ' ;; esac
      printf '  %s' "$label"
      printf '%q %q %s\n' "$NODE" "$BIN" "$verb"
    done
    printf '\n'
    case "$SHIM_STATE" in
      0)
        printf '%s\n' "${C_BOLD}Command installed${C_RESET} ${G_DASH} $SHIM"
        if vibehub_shim_on_path "$SHIM_DIR"; then
          printf '  %s\n' 'vibehub-tracker status'
          printf '  %s\n' 'vibehub-tracker hooks install cursor'
          printf '  %s\n' 'vibehub-tracker hooks install windsurf'
        else
          printf '  %s%s%s\n' "$C_YELLOW" "$SHIM_DIR is not on your PATH. Add it, then reopen the terminal:" "$C_RESET"
          printf '    %s\n' "echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $(vibehub_shell_rc)"
          printf '  %s%s%s\n' "$C_DIM" "(that is the file your login shell actually reads; on a Mac a login bash reads ~/.bash_profile, not ~/.bashrc)" "$C_RESET"
          printf '  %s\n' 'Until then, call it by path:'
          printf '    %q %s\n' "$SHIM" 'hooks install cursor'
        fi
        printf '  %s%s%s\n' "$C_DIM" "Deleting ~/.vibehub disables it; remove $SHIM to clean up." "$C_RESET"
        ;;
      1) printf '%s\n' "${C_YELLOW}${G_DASH}${C_RESET} A different vibehub-tracker already exists at $SHIM ${G_DASH} left untouched; use the commands above."; ;;
      *) printf '%s\n' "${C_YELLOW}${G_DASH}${C_RESET} Could not create $SHIM ${G_DASH} use the commands above."; ;;
    esac
    printf '\n'
    printf '%s\n' "Open VibeHub ${G_DASH} it turns green after the first ping."
    printf '%s%s%s\n' "$C_DIM" 'Connection is confirmed in VibeHub only after a fresh server heartbeat, not by this command.' "$C_RESET"
    printf '%s\n' "${C_BOLD}${rule_bottom}${C_RESET}"
  }

  for arg in "$@"; do
    case "$arg" in --start) [ "$START" -eq 0 ] || fail 'Pass --start only once.'; START=1 ;; *) fail 'Unknown option. Use --start to explicitly allow background tracking, or omit it for setup only.' ;; esac
  done
  WEB_URL="$(origin "$WEB_URL")"
  API_URL="$(origin "$API_URL")"
  [ -n "${HOME:-}" ] && [[ "$HOME" = /* ]] && [ "$HOME" != / ] && [ -d "$HOME" ] || fail 'An existing absolute HOME directory is required; do not run as an administrator.'
  case "$(uname -s)" in
    Darwin) PLATFORM=darwin ;;
    Linux) PLATFORM=linux; case "$(uname -r)" in *[Mm]icrosoft*|*WSL*) fail 'WSL is not supported by this device connector. Use the Windows PowerShell command from VibeHub.' ;; esac ;;
    MINGW*|MSYS*|CYGWIN*) fail 'This is Git Bash/MSYS/Cygwin. Use the Windows PowerShell command from VibeHub; no Linux binary will be installed.' ;;
    *) fail 'Unsupported operating system. Use Windows PowerShell on Windows, or a supported macOS/Linux terminal.' ;;
  esac
  case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) fail 'Only x64 and arm64 devices are supported. No runtime was installed.' ;; esac
  command -v curl >/dev/null 2>&1 || fail 'curl is required; this connector does not install system packages.'

  if [ -z "$TOKEN" ]; then
    printf '%s\n' "${C_BOLD}Pairing this device with VibeHub${C_RESET}"
    HOSTNAME_LABEL="$(hostname 2>/dev/null || echo "My Device")"
    PAIR_PAYLOAD="{\"deviceName\":\"$HOSTNAME_LABEL\",\"os\":\"$PLATFORM\"}"
    PAIR_RESP="$(curl -q --fail --silent --show-error --proto '=https,http' -H 'Content-Type: application/json' -d "$PAIR_PAYLOAD" "$API_URL/api/v1/tracker/pair/request" 2>/dev/null)" || fail 'Could not reach pairing service.'
    DEVICE_CODE="$(printf '%s' "$PAIR_RESP" | sed -n 's/.*"deviceCode":"\([^"]*\)".*/\1/p')"
    USER_CODE="$(printf '%s' "$PAIR_RESP" | sed -n 's/.*"userCode":"\([^"]*\)".*/\1/p')"
    VERIFY_URI="$(printf '%s' "$PAIR_RESP" | sed -n 's/.*"verificationUri":"\([^"]*\)".*/\1/p')"
    [ -n "$DEVICE_CODE" ] && [ -n "$USER_CODE" ] || fail 'Invalid pairing response from server.'
    printf '  Opening browser to approve pairing...\n'
    printf '  Code: %s%s%s\n' "$C_BOLD" "$USER_CODE" "$C_RESET"
    printf '  If browser does not open, visit: %s\n' "$VERIFY_URI"
    if [ "$PLATFORM" = darwin ]; then
      open "$VERIFY_URI" 2>/dev/null || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$VERIFY_URI" 2>/dev/null || true
    fi
    printf '  Waiting for approval in your browser...\n'
    PAIR_START_TS=$(date +%s 2>/dev/null || echo 0)
    while :; do
      sleep 2
      NOW_TS=$(date +%s 2>/dev/null || echo 0)
      if [ $((NOW_TS - PAIR_START_TS)) -gt 300 ]; then
        fail 'Pairing timed out. Run the command again to retry.'
      fi
      POLL_RESP="$(curl -q --fail --silent --show-error --proto '=https,http' -H 'Content-Type: application/json' -d "{\"deviceCode\":\"$DEVICE_CODE\"}" "$API_URL/api/v1/tracker/pair/poll" 2>/dev/null || echo '{}')"
      POLL_STATUS="$(printf '%s' "$POLL_RESP" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
      if [ "$POLL_STATUS" = "approved" ]; then
        TOKEN="$(printf '%s' "$POLL_RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
        APPROVED_USER="$(printf '%s' "$POLL_RESP" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
        printf '%s%s%s Approved by @%s!\n' "$C_GREEN" "$G_CHECK" "$C_RESET" "$APPROVED_USER"
        break
      elif [ "$POLL_STATUS" = "expired" ]; then
        fail 'Pairing code expired. Run the command again to retry.'
      fi
    done
  elif ! [[ "$TOKEN" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]+$ ]] || [ "${#TOKEN}" -lt 8 ] || [ "${#TOKEN}" -gt 512 ]; then
    fail 'Set VIBEHUB_TOKEN to a device token from VibeHub Settings > Tracker.'
  fi
  BASE="$HOME/.vibehub"
  APP="$BASE/app"
  BIN="$APP/vibehub-tracker.cjs"
  RUNTIME="$BASE/runtime"
  for dir in "$BASE" "$APP" "$RUNTIME" "$RUNTIME/bin"; do
    [ ! -L "$dir" ] && { [ ! -e "$dir" ] || [ -d "$dir" ]; } || fail 'The install directories must be real directories, not symbolic links.'
  done
  mkdir -p "$BASE"
  [ -O "$BASE" ] || fail 'The install directory must belong to your account.'
  chmod 700 "$BASE"
  if ! mkdir "$BASE/.connect.lock" 2>/dev/null; then
    fail 'Another setup may be in progress. Wait for it; if it was interrupted, remove only the empty ~/.vibehub/.connect.lock directory and retry.'
  fi
  LOCK="$BASE/.connect.lock"
  STAGE="$(mktemp -d "$BASE/.connect.XXXXXXXX")"
  for file in "$BIN" "$BASE/config.json" "$RUNTIME/bin/node" "$RUNTIME/LICENSE"; do
    [ ! -L "$file" ] && { [ ! -e "$file" ] || [ -f "$file" ]; } || fail 'Unexpected existing tracker/config/runtime path; no setup was attempted.'
  done

  printf '%s\n' "${C_BOLD}What this does${C_RESET}"
  while IFS= read -r vibehub_disclosure_line; do
    printf '  %s%s%s\n' "$C_DIM" "$vibehub_disclosure_line" "$C_RESET"
  done <<'DISCLOSURE'
One device installation covers supported tools. It does not install AI apps or connect their accounts.
Local reads: session logs (JSONL) of Claude Code (~/.claude/projects), Codex (~/.codex/sessions) and Quadcode AI only; no other apps, processes, windows, browsing or Git are read.
Cursor and Windsurf are off until you run 'vibehub-tracker hooks install cursor' or 'vibehub-tracker hooks install windsurf'. Their own hook then writes tool, time, model and project name to ~/.vibehub/attested.jsonl, which is read only while that hook is installed. No prompt, response, transcript, path or email is read.
Tokens: measured for Claude Code and Codex. Quadcode AI, Cursor and Windsurf report none, so none are shown and none are estimated.
Parsing may temporarily read records containing prompts, code and tool output. These contents are not saved or sent.
Uploads: tool, model, timing, token counts and a bounded project alias only.
Profiles and statistics, including recent activity, are public. Live presence cards are shared with accepted friends.
Connected means a recent server-accepted tracker connection. Idle means no recent supported AI activity, not an idle computer.
This does not fix the collector's privacy limitations. Setup updates the saved device token; a running tracker may pick it up.
DISCLOSURE
  if [ "$START" -eq 1 ]; then
    printf '  %s%s%s\n' "$C_DIM" '--start allows background tracking until stopped or reboot. The tracker start command can replace an older running tracker. No OS autostart is added.' "$C_RESET"
  else
    printf '  %s%s%s\n' "$C_DIM" 'Setup only: no start, stop or restart is requested.' "$C_RESET"
  fi

  if compatible_node "$RUNTIME/bin/node"; then
    NODE="$RUNTIME/bin/node"; NODE_SOURCE='private runtime'
  else
    NODE="$(type -P node || true)"
    if [ -z "$NODE" ] || ! compatible_node "$NODE"; then bootstrap_node; NODE_SOURCE='private runtime'; else NODE_SOURCE='system Node'; fi
  fi
  # Resolve PATH entries relative to the caller before printing reusable commands.
  NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")"
  NODE_VERSION_DISPLAY="$("$NODE" --version 2>/dev/null || printf unknown)"
  printf '%s\n' "${C_GREEN}${G_CHECK}${C_RESET} [1/5] Node.js ready ($NODE_VERSION_DISPLAY, $NODE_SOURCE)"
  STAGED_BIN="$STAGE/vibehub-tracker.cjs"
  download "$WEB_URL/tracker/vibehub-tracker.cjs" "$STAGED_BIN" 8388608 120
  [ "$(wc -c < "$STAGED_BIN" | tr -d '[:space:]')" -ge 1024 ] || fail 'The response is too small to be the tracker. The existing app was kept.'
  "$NODE" --check "$STAGED_BIN" >/dev/null 2>&1 || fail 'The downloaded tracker failed its syntax check. The existing app was kept.'
  printf '%s\n' "${C_GREEN}${G_CHECK}${C_RESET} [2/5] Tracker downloaded"

  # Fail closed before login: the legacy CLI otherwise saves on an offline/5xx response.
  download "$API_URL/api/v1/tracker/verify" "$STAGE/verify.json" 16384 20 "$TOKEN"
  VERIFIED_USERNAME="$("$NODE" -e '/* vibehub-connect-verify */ try { const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); if (!o || typeof o.username !== "string" || !o.username.trim()) process.exit(1); process.stdout.write(o.username); } catch { process.exit(1); }' "$STAGE/verify.json" 2>/dev/null)" || fail 'The selected server did not return a valid token verification response.'
  printf '%s\n' "${C_GREEN}${G_CHECK}${C_RESET} [3/5] Device token verified as @$VERIFIED_USERNAME"
  if ! LOGIN_OUTPUT="$("$NODE" "$STAGED_BIN" login "$TOKEN" --api-url "$API_URL" 2>&1)"; then
    fail 'Login failed. No start was requested. Check your device token and selected server, then retry.'
  fi
  # A second verification can fail between preflight and login; never start on "saved anyway".
  if ! printf '%s\n' "$LOGIN_OUTPUT" | grep -q '^Logged in as '; then
    fail 'Login did not confirm token verification. Configuration may have been saved, but no start was requested; retry when the server is available.'
  fi
  printf '%s\n' "${C_GREEN}${G_CHECK}${C_RESET} [4/5] Configuration saved"
  TOKEN=''; unset VIBEHUB_TOKEN
  mkdir -p "$APP"
  mv -f -- "$STAGED_BIN" "$BIN" || fail 'Could not promote the tracker download. No start was requested.'

  # Everything VibeHub documents is `vibehub-tracker <command>`, so make that name real.
  # Never fatal: the explicit node+path commands printed below always work, and a
  # `vibehub-tracker` that is not ours is left exactly where it is.
  SHIM_DIR="$HOME/.local/bin"
  SHIM="$SHIM_DIR/vibehub-tracker"
  SHIM_STATE=0
  vibehub_write_shim "$SHIM" "$BASE" "$NODE" "$BIN" || SHIM_STATE=$?

  # vibehub-start-anchor: explicit tracker start begins below
  if [ "$START" -eq 1 ]; then
    ATTEMPTED_START=1
    if ! START_OUTPUT="$("$NODE" "$BIN" start 2>&1)"; then
      fail 'Tracker start failed. Setup remains installed; inspect it with the status command above. No connection was confirmed.'
    fi
    # Current CLI has zero-exit failure branches. Require both an acknowledged start
    # (or already-running process) and an independent local status, not exit 0 alone.
    if ! printf '%s\n' "$START_OUTPUT" | grep -Eq '^Tracker (started \(pid [1-9][0-9]*\)|is already running \(pid [1-9][0-9]*\))'; then
      fail 'Tracker did not acknowledge a successful start. Use the status command above; no connection was confirmed.'
    fi
    if ! STATUS_OUTPUT="$("$NODE" "$BIN" status 2>&1)"; then fail 'Could not check tracker startup. Use the status command above.'; fi
    if ! printf '%s\n' "$STATUS_OUTPUT" | grep -Eq '^Daemon:[[:space:]]+running \(pid [1-9][0-9]*\)'; then
      fail 'Tracker is not running after start. Use the status command above; no connection was confirmed.'
    fi
    if printf '%s\n' "$STATUS_OUTPUT" | grep -Eqi '^Connected: no.*token rejected'; then
      fail 'The running tracker reports a rejected token. Use the status/stop commands above; no connection was confirmed.'
    fi
    if [[ "$START_OUTPUT" =~ pid\ ([1-9][0-9]*)\) ]]; then START_PID="${BASH_REMATCH[1]}"; else START_PID='?'; fi
    printf '%s\n' "${C_GREEN}${G_CHECK}${C_RESET} [5/5] Start running (pid $START_PID)"
  else
    printf '%s\n' "${C_YELLOW}${G_DASH}${C_RESET} [5/5] Start skipped (setup only)"
  fi
  controls
  VIBEHUB_END_TS=$(date +%s 2>/dev/null || echo "$VIBEHUB_START_TS")
  printf '%s\n' "Done in $((VIBEHUB_END_TS - VIBEHUB_START_TS))s."
)
vibehub_connect_main "$@"
