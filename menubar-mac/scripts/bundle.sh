#!/usr/bin/env bash
#
# Build VibeHubMenuBar and assemble a runnable, ad-hoc signed .app + zip.
#
#   ./scripts/bundle.sh
#
# Output: dist/VibeHub MenuBar.app and dist/VibeHub-MenuBar-macOS.zip
#
# Ad-hoc signing (`-s -`) means no Developer ID and no notarisation: Gatekeeper will
# refuse a double-click on first launch, and the user has to right-click → Open once.
# That is a deliberate trade (documented in README.md), not an oversight.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="VibeHub MenuBar"
BINARY="VibeHubMenuBar"
DIST="$ROOT/dist"
APP="$DIST/$APP_NAME.app"
ZIP="$DIST/VibeHub-MenuBar-macOS.zip"

echo "==> swift build (release)"
swift build -c release --package-path "$ROOT"
BUILT="$(swift build -c release --package-path "$ROOT" --show-bin-path)/$BINARY"
test -x "$BUILT" || { echo "no binary at $BUILT" >&2; exit 1; }

echo "==> validating Info.plist"
plutil -lint "$ROOT/Resources/Info.plist"

echo "==> assembling $APP_NAME.app"
rm -rf "$DIST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILT" "$APP/Contents/MacOS/$BINARY"
cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"
# Classic 8-byte type/creator stamp. Harmless, and some tooling still looks for it.
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> icon"
ICONSET="$(mktemp -d)/AppIcon.iconset"
swift "$ROOT/scripts/make-icon.swift" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> ad-hoc codesign"
codesign --force --deep -s - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> zip"
# ditto, not `zip`: it preserves the signature and resource forks that a plain zip drops.
( cd "$DIST" && ditto -c -k --sequesterRsrc --keepParent "$APP_NAME.app" "$ZIP" )

echo
echo "built: $APP"
echo "zip:   $ZIP"
