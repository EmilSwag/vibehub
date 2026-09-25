#!/usr/bin/env bash
#
# Fallback compiler driver for machines where SwiftPM itself cannot start — e.g. a
# Command Line Tools install whose `swift-package` binary and `usr/lib/swift/pm/*`
# frameworks come from different releases (dyld: "Symbol not found … BuildServerProtocol").
# `swiftc` is unaffected, and this package has one target and no dependencies, so a
# direct invocation builds exactly what `swift build` would.
#
#   ./scripts/swiftc-build.sh <arch> <debug|release> <out-dir>
#
# Prints the built binary's path on stdout (last line). `bundle.sh` uses this only
# when `swift build --version` fails; CI (a healthy Xcode toolchain) never reaches it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${1:?usage: swiftc-build.sh <arch> <debug|release> <out-dir>}"
CONFIG="${2:?usage: swiftc-build.sh <arch> <debug|release> <out-dir>}"
OUT="${3:?usage: swiftc-build.sh <arch> <debug|release> <out-dir>}"

# shellcheck source=scripts/select-sdk.sh
. "$ROOT/scripts/select-sdk.sh"

case "$CONFIG" in
  debug) FLAGS=(-Onone -g -D DEBUG) ;;
  release) FLAGS=(-O -whole-module-optimization) ;;
  *) echo "swiftc-build: config must be debug or release" >&2; exit 1 ;;
esac

mkdir -p "$OUT"
swiftc \
  -sdk "$SDKROOT" \
  -target "$ARCH-apple-macosx13.0" \
  -swift-version 5 \
  -parse-as-library \
  -module-name VibeHub \
  "${FLAGS[@]}" \
  "$ROOT"/Sources/VibeHub/*.swift \
  -o "$OUT/VibeHub" 1>&2
printf '%s/VibeHub\n' "$OUT"
