#!/usr/bin/env bash
#
# Downloads the pinned private Node.js runtime for both Apple Silicon and Intel,
# verifies each archive's SHA-256, lipos the two `node` binaries into one universal
# executable, and stages it plus the tracker's bundled CLI
# (`web/public/tracker/vibehub-tracker.cjs`) into the given directory as
# `node/bin/node`, `node/LICENSE` and `vibehub-tracker.cjs` — the exact layout
# `TrackerManager.swift` expects under `Contents/Resources/tracker/`.
#
#   ./scripts/embed-tracker.sh <destination-directory>
#
# Pins MUST match web/public/tracker/connect.sh and runtime-manifest.json exactly —
# this is the same private-runtime contract the one-command installer uses, just
# embedded at build time instead of fetched at install time. Bump all three together.
#
# bash 3.2-safe on purpose (no associative arrays): macOS still ships 3.2 as
# `/bin/bash`, and `env bash` may resolve to it for a dev without Homebrew's bash on
# PATH. `web/public/tracker/connect.sh` follows the same rule for the same reason.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:?usage: embed-tracker.sh <destination-directory>}"

NODE_VERSION='v24.21.0'
NODE_ORIGIN='https://nodejs.org/dist'

node_sha256() {
  case "$1" in
    arm64) printf '%s' 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057' ;;
    x64) printf '%s' '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097' ;;
    *) echo "embed-tracker: unsupported arch '$1'" >&2; exit 1 ;;
  esac
}

CJS_SOURCE="$ROOT/../web/public/tracker/vibehub-tracker.cjs"
test -f "$CJS_SOURCE" || {
  echo "embed-tracker: missing $CJS_SOURCE (a lane B/C build artifact — run 'npm run bundle' in tracker/ first)" >&2
  exit 1
}

CACHE="${VIBEHUB_NODE_CACHE:-$ROOT/.cache/node}"
mkdir -p "$CACHE"

fetch_node_binary() {
  local arch="$1" hash cached name archive stage
  hash="$(node_sha256 "$arch")"
  name="node-$NODE_VERSION-darwin-$arch"
  cached="$CACHE/$name-node"
  if [ -f "$cached" ]; then
    printf '%s' "$cached"
    return
  fi
  echo "==> downloading $name" >&2
  archive="$(mktemp -d)/node.tar.gz"
  curl -fsSL --max-time 180 -o "$archive" "$NODE_ORIGIN/$NODE_VERSION/$name.tar.gz"
  local actual
  actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
  [ "$actual" = "$hash" ] || {
    echo "embed-tracker: SHA-256 mismatch for $name (got $actual, want $hash) — refusing to use it" >&2
    exit 1
  }
  stage="$(mktemp -d)"
  tar -xzf "$archive" -C "$stage" --no-same-owner "$name/bin/node" "$name/LICENSE"
  cp "$stage/$name/bin/node" "$cached"
  cp "$stage/$name/LICENSE" "$CACHE/$name-LICENSE"
  chmod 700 "$cached"
  printf '%s' "$cached"
}

ARM64_NODE="$(fetch_node_binary arm64)"
X64_NODE="$(fetch_node_binary x64)"

mkdir -p "$DEST/node/bin"
echo "==> lipo: universal node binary"
lipo -create -output "$DEST/node/bin/node" "$ARM64_NODE" "$X64_NODE"
chmod 755 "$DEST/node/bin/node"
lipo -info "$DEST/node/bin/node"
cp "$CACHE/node-$NODE_VERSION-darwin-arm64-LICENSE" "$DEST/node/LICENSE"

cp "$CJS_SOURCE" "$DEST/vibehub-tracker.cjs"

echo "embedded: $DEST/node/bin/node"
echo "embedded: $DEST/vibehub-tracker.cjs"
