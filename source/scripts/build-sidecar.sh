#!/usr/bin/env bash
# Build the Swift audio-capture sidecar and place it where Tauri expects.
# Skips the rebuild when nothing in audio-capture/ has changed — re-signing
# the binary on every dev launch invalidates the macOS TCC entry, forcing
# the user to re-grant Screen Recording / Microphone access each rebuild.
# Override the cache with FORCE_SIDECAR_REBUILD=1.
#
# Signs with APPLE_SIGNING_IDENTITY (Tauri's standard override) or the
# identity in src-tauri/tauri.conf.json, plus hardened runtime and the
# sidecar entitlements. Local builds use the explicit ad-hoc identity `-`.
set -euo pipefail

cd "$(dirname "$0")/.."

ARCH=$(uname -m)
case "$ARCH" in
  arm64)  TRIPLE="aarch64-apple-darwin" ;;
  x86_64) TRIPLE="x86_64-apple-darwin" ;;
  *) echo "unsupported arch $ARCH"; exit 1 ;;
esac

mkdir -p src-tauri/binaries
DEST="src-tauri/binaries/audio-capture-$TRIPLE"
STAMP="src-tauri/binaries/.audio-capture-$TRIPLE.stamp"
ENTITLEMENTS="src-tauri/sidecar.entitlements"

# Pull the Developer ID from tauri.conf.json so we have one source of truth.
CONFIG_IDENTITY=$(node -e "
  const c = require('./src-tauri/tauri.conf.json');
  process.stdout.write((c.bundle && c.bundle.macOS && c.bundle.macOS.signingIdentity) || '');
")
IDENTITY="${APPLE_SIGNING_IDENTITY:-$CONFIG_IDENTITY}"

# Source hash includes the entitlements + signing identity so changes to
# either invalidate the cache and force a re-sign.
SRC_HASH=$(
  {
    find audio-capture/Sources audio-capture/Package.swift -type f \
      \( -name '*.swift' -o -name 'Package.swift' \) -print0 \
      | sort -z \
      | xargs -0 shasum -a 256
    [[ -f "audio-capture/Info.plist" ]] && shasum -a 256 audio-capture/Info.plist
    [[ -f "$ENTITLEMENTS" ]] && shasum -a 256 "$ENTITLEMENTS"
    echo "identity:$IDENTITY"
  } | shasum -a 256 | awk '{print $1}'
)

FORCE="${FORCE_SIDECAR_REBUILD:-0}"
if [[ "$FORCE" != "1" && -f "$DEST" && -f "$STAMP" && "$(cat "$STAMP")" == "$SRC_HASH" ]]; then
  echo "sidecar unchanged, skipping rebuild ($DEST)"
  exit 0
fi

(
  cd audio-capture
  # SwiftPM does not treat a file referenced only through `-Xlinker` flags as
  # an input dependency. Remove the linked executable whenever SRC_HASH says
  # the embedded Info.plist or another sidecar input changed, or SwiftPM may
  # incorrectly reuse a binary with stale privacy-purpose strings.
  rm -f .build/release/audio-capture
  swift build -c release
)

cp audio-capture/.build/release/audio-capture "$DEST"
chmod +x "$DEST"

xattr -cr "$DEST" || true

if [[ "$IDENTITY" == "-" ]]; then
  echo "signing sidecar ad-hoc for local testing"
  codesign --force --sign - "$DEST"
elif [[ -n "$IDENTITY" ]] && security find-identity -v -p codesigning | grep -qF "$IDENTITY"; then
  echo "signing sidecar with: $IDENTITY"
  codesign --force --options runtime \
    --sign "$IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    --timestamp \
    "$DEST"
else
  echo "error: configured signing identity is not valid in the Keychain: $IDENTITY" >&2
  exit 1
fi

echo "$SRC_HASH" > "$STAMP"
echo "built: $DEST"
