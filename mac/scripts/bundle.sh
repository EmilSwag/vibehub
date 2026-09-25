#!/usr/bin/env bash
#
# Build VibeHub (universal: arm64 + x86_64) and assemble a runnable .app + zip, with
# the private Node runtime and the tracker CLI embedded so the app can run the tracker
# on its own — no separate install step.
#
#   ./scripts/bundle.sh
#
# Output: dist/VibeHub.app and dist/VibeHub-macOS.zip
#
# Signing: ad-hoc (`-s -`) unless VIBEHUB_SIGN_IDENTITY is set (a Developer ID
# Application identity string, e.g. "Developer ID Application: Name (TEAMID)"), in
# which case that identity signs the bundle instead — see mac/README.md for the CI
# secrets that set it. Ad-hoc means no Developer ID and no notarisation: Gatekeeper
# refuses a double-click on first launch, and the user has to right-click -> Open once.
# That is a deliberate trade for an unsigned build, not an oversight.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="VibeHub"
BINARY="VibeHub"
DIST="$ROOT/dist"
APP="$DIST/$APP_NAME.app"
ZIP="$DIST/VibeHub-macOS.zip"
SIGN_IDENTITY="${VIBEHUB_SIGN_IDENTITY:--}"

# Also used by `swift make-icon.swift` below: without it a CLT carrying an SDK newer
# than its compiler cannot even import Foundation.
. "$ROOT/scripts/select-sdk.sh"

# SwiftPM can be broken while swiftc is fine (a CLT whose swift-package binary and pm
# frameworks are from different releases dies in dyld before doing anything); fall
# back to a direct swiftc build of the one target rather than failing the bundle.
if swift build --version >/dev/null 2>&1; then USE_SWIFTPM=1; else USE_SWIFTPM=0; fi

build_arch() {
  local arch="$1" bin_path
  if [ "$USE_SWIFTPM" = 0 ]; then
    echo "   (SwiftPM unavailable — building with swiftc against $SDKROOT)" >&2
    bash "$ROOT/scripts/swiftc-build.sh" "$arch" release "$ROOT/.build/swiftc/$arch-release" | tail -n 1
    return
  fi
  # Newer toolchains print "Building for production..." on stdout before the path, so
  # only the last line is the answer (CI run 35547297231 died on exactly that).
  bin_path="$(swift build -c release --arch "$arch" --package-path "$ROOT" --show-bin-path 2>/dev/null | tail -n 1)"
  swift build -c release --arch "$arch" --package-path "$ROOT" 1>&2
  printf '%s/%s' "$bin_path" "$BINARY"
}

echo "==> swift build (release, arm64 + x86_64)"
ARM64_BIN="$(build_arch arm64)"
X86_64_BIN="$(build_arch x86_64)"
test -x "$ARM64_BIN" || { echo "no arm64 binary at $ARM64_BIN" >&2; exit 1; }
test -x "$X86_64_BIN" || { echo "no x86_64 binary at $X86_64_BIN" >&2; exit 1; }

echo "==> lipo: universal $BINARY"
UNIVERSAL_DIR="$(mktemp -d)"
lipo -create -output "$UNIVERSAL_DIR/$BINARY" "$ARM64_BIN" "$X86_64_BIN"
lipo -info "$UNIVERSAL_DIR/$BINARY"

echo "==> validating Info.plist"
plutil -lint "$ROOT/Resources/Info.plist"

echo "==> assembling $APP_NAME.app"
rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$UNIVERSAL_DIR/$BINARY" "$APP/Contents/MacOS/$BINARY"
cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"
# Classic 8-byte type/creator stamp. Harmless, and some tooling still looks for it.
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> icon"
ICONSET="$(mktemp -d)/AppIcon.iconset"
swift "$ROOT/scripts/make-icon.swift" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> embedding tracker (private Node runtime + vibehub-tracker.cjs)"
bash "$ROOT/scripts/embed-tracker.sh" "$APP/Contents/Resources/tracker"

echo "==> codesign ($([ "$SIGN_IDENTITY" = '-' ] && echo ad-hoc || echo "$SIGN_IDENTITY"))"
# --deep re-signs every nested Mach-O (including the embedded, lipo'd node binary,
# whose own signature doesn't survive lipo intact) under one identity.
codesign --force --deep -s "$SIGN_IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> zip"
# ditto, not `zip`: it preserves the signature and resource forks that a plain zip drops.
( cd "$DIST" && ditto -c -k --sequesterRsrc --keepParent "$APP_NAME.app" "$ZIP" )

echo
echo "built: $APP"
echo "zip:   $ZIP"
