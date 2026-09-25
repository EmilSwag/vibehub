# Sourced, not executed. Exports SDKROOT pointing at an SDK whose Swift module
# interfaces this `swiftc` can actually read.
#
# A Command Line Tools install can carry a newer SDK than its compiler (say a 27.0 beta
# SDK built by Swift 6.4 next to a Swift 6.3 compiler); `xcrun` picks the newest SDK
# regardless and every `import Foundation` then fails with "this SDK is not supported
# by the compiler". Honour an explicit SDKROOT; otherwise take xcrun's choice if its
# stdlib interface was written by the same compiler major.minor, else the newest one
# that was.

if [ -z "${SDKROOT:-}" ]; then
  _vh_compiler="$(swiftc --version 2>/dev/null | sed -n 's/.*Swift version \([0-9]*\.[0-9]*\).*/\1/p' | head -n 1)"
  _vh_sdk_matches() {
    local iface
    iface="$(ls "$1"/usr/lib/swift/Swift.swiftmodule/*.swiftinterface 2>/dev/null | head -n 1)"
    [ -n "$iface" ] && grep -q "swift-compiler-version: Apple Swift version $_vh_compiler" "$iface"
  }
  _vh_default="$(xcrun --show-sdk-path 2>/dev/null || true)"
  if [ -n "$_vh_default" ] && _vh_sdk_matches "$_vh_default"; then
    SDKROOT="$_vh_default"
  else
    for _vh_sdk in $(ls -d "$(dirname "${_vh_default:-/Library/Developer/CommandLineTools/SDKs/x}")"/MacOSX[0-9]*.sdk 2>/dev/null | sort -rV); do
      if _vh_sdk_matches "$_vh_sdk"; then SDKROOT="$_vh_sdk"; break; fi
    done
  fi
  SDKROOT="${SDKROOT:-$_vh_default}"
  unset _vh_compiler _vh_default _vh_sdk
  unset -f _vh_sdk_matches
fi
export SDKROOT
