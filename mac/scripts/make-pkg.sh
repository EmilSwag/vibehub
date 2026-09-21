#!/usr/bin/env bash
#
# Builds VibeHub.pkg from an already-built dist/VibeHub.app (run scripts/bundle.sh
# first — CI runs both in sequence). pkgbuild wraps the .app plus the postinstall
# script into a component package; productbuild wraps that into the distribution-style
# installer with welcome/license/conclusion, plus the light/dark background artwork
# when the files exist (this script degrades gracefully without either).
#
#   ./scripts/make-pkg.sh
#
# Signing (both optional; see mac/README.md for the CI secrets that set them):
#   VIBEHUB_PKG_SIGN_IDENTITY — a "Developer ID Installer: Name (TEAMID)" identity.
#     Note this is a *different* certificate type from bundle.sh's
#     VIBEHUB_SIGN_IDENTITY ("Developer ID Application"), by Apple's own requirement.
#   VIBEHUB_NOTARY_PROFILE — a keychain profile name already stored via
#     `xcrun notarytool store-credentials` (local/dev use). In CI, set
#     VIBEHUB_NOTARY_KEY_ID / VIBEHUB_NOTARY_ISSUER_ID / VIBEHUB_NOTARY_KEY_PATH
#     instead (an App Store Connect API key, which needs no interactive setup). Either
#     way, when notarisation runs, the result is stapled to the pkg.
#
# Output: dist/VibeHub.pkg, dist/VibeHub.pkg.sha256
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
APP="$DIST/VibeHub.app"
COMPONENT_PKG="$DIST/VibeHub-component.pkg"
FINAL_PKG="$DIST/VibeHub.pkg"
IDENTIFIER="com.vibehub.menubar.pkg"
SIGN_IDENTITY="${VIBEHUB_PKG_SIGN_IDENTITY:-}"

test -d "$APP" || { echo "make-pkg: $APP is missing — run scripts/bundle.sh first" >&2; exit 1; }

VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")"
echo "==> version $VERSION"

echo "==> pkgbuild: component package"
chmod +x "$ROOT/pkg/scripts/postinstall"
COMPONENT_ROOT="$(mktemp -d)/root"
mkdir -p "$COMPONENT_ROOT/Applications"
ditto "$APP" "$COMPONENT_ROOT/Applications/VibeHub.app"
pkgbuild \
  --root "$COMPONENT_ROOT" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --scripts "$ROOT/pkg/scripts" \
  --install-location / \
  "$COMPONENT_PKG"

echo "==> staging installer resources"
RESOURCES="$(mktemp -d)/resources"
mkdir -p "$RESOURCES"
cp "$ROOT/pkg/resources/welcome.html" "$RESOURCES/welcome.html"
cp "$ROOT/pkg/resources/conclusion.html" "$RESOURCES/conclusion.html"
cp "$ROOT/../LICENSE" "$RESOURCES/license.txt"
# Installer artwork. `background.png`/`@2x` (Lumi, lane D) is the ink mark, drawn for
# the light Installer window. `background-dark.png`/`@2x` is the paper mark on the same
# transparent tile — the same brand asset (`assets/branding/vibehub-mark-1024-paper.png`)
# resampled to the same content size and position — for Dark Mode, where the ink mark
# read as near-invisible. Each element is emitted only when its file exists: no light
# file → a plainer installer; no dark file → no <background-darkAqua> at all, rather
# than one pointing at the ink mark as before.
BACKGROUND_XML=""
if [ -f "$ROOT/pkg/resources/background.png" ]; then
  cp "$ROOT/pkg/resources/background.png" "$RESOURCES/background.png"
  [ -f "$ROOT/pkg/resources/background@2x.png" ] && cp "$ROOT/pkg/resources/background@2x.png" "$RESOURCES/background@2x.png"
  BACKGROUND_XML="$BACKGROUND_XML"'    <background file="background.png" mime-type="image/png" alignment="bottomleft" scaling="none"/>'$'\n'
else
  echo "note: pkg/resources/background.png not present — building without light installer artwork"
fi
if [ -f "$ROOT/pkg/resources/background-dark.png" ]; then
  cp "$ROOT/pkg/resources/background-dark.png" "$RESOURCES/background-dark.png"
  [ -f "$ROOT/pkg/resources/background-dark@2x.png" ] && cp "$ROOT/pkg/resources/background-dark@2x.png" "$RESOURCES/background-dark@2x.png"
  BACKGROUND_XML="$BACKGROUND_XML"'    <background-darkAqua file="background-dark.png" mime-type="image/png" alignment="bottomleft" scaling="none"/>'$'\n'
else
  echo "note: pkg/resources/background-dark.png not present — Dark Mode Installer gets no background"
fi

DISTRIBUTION="$(mktemp -d)/Distribution.xml"
sed "s/__VERSION__/$VERSION/" "$ROOT/pkg/Distribution.xml" > "$DISTRIBUTION"
if [ -n "$BACKGROUND_XML" ]; then
  # Insert the elements before the closing tag with plain shell (no python3 needed):
  # `sed '$d'` drops the last line — asserted to be the closing tag on its own line, so
  # a reformatted descriptor fails loudly instead of being silently truncated — then
  # the elements and the closing tag are appended.
  LAST_LINE="$(tail -n 1 "$DISTRIBUTION")"
  [ "$LAST_LINE" = "</installer-gui-script>" ] || {
    echo "make-pkg: pkg/Distribution.xml must end with </installer-gui-script> on its own line" >&2
    exit 1
  }
  { sed '$d' "$DISTRIBUTION"; printf '%s' "$BACKGROUND_XML"; echo '</installer-gui-script>'; } > "$DISTRIBUTION.new"
  mv "$DISTRIBUTION.new" "$DISTRIBUTION"
fi

echo "==> productbuild: distribution package"
PACKAGE_STAGE="$(mktemp -d)"
cp "$COMPONENT_PKG" "$PACKAGE_STAGE/VibeHub-component.pkg"
PRODUCTBUILD_ARGS=(--distribution "$DISTRIBUTION" --resources "$RESOURCES" --package-path "$PACKAGE_STAGE")
if [ -n "$SIGN_IDENTITY" ]; then
  PRODUCTBUILD_ARGS+=(--sign "$SIGN_IDENTITY")
fi
productbuild "${PRODUCTBUILD_ARGS[@]}" "$FINAL_PKG"

echo "==> sha256"
shasum -a 256 "$FINAL_PKG" | awk '{print $1}' > "$FINAL_PKG.sha256"

if [ -n "${VIBEHUB_NOTARY_PROFILE:-}" ]; then
  echo "==> notarising (keychain profile)"
  xcrun notarytool submit "$FINAL_PKG" --keychain-profile "$VIBEHUB_NOTARY_PROFILE" --wait
  xcrun stapler staple "$FINAL_PKG"
elif [ -n "${VIBEHUB_NOTARY_KEY_ID:-}" ] && [ -n "${VIBEHUB_NOTARY_ISSUER_ID:-}" ] && [ -n "${VIBEHUB_NOTARY_KEY_PATH:-}" ]; then
  echo "==> notarising (App Store Connect API key)"
  xcrun notarytool submit "$FINAL_PKG" \
    --key "$VIBEHUB_NOTARY_KEY_PATH" --key-id "$VIBEHUB_NOTARY_KEY_ID" --issuer "$VIBEHUB_NOTARY_ISSUER_ID" --wait
  xcrun stapler staple "$FINAL_PKG"
fi

echo
echo "built:  $FINAL_PKG"
echo "sha256: $(cat "$FINAL_PKG.sha256")  ($FINAL_PKG.sha256)"
