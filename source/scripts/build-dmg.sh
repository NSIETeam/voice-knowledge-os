#!/usr/bin/env bash
# Build a distributable HoneyVoice.dmg for sharing with users.
# Output lands in src-tauri/target/release/bundle/dmg/.
#
# When .env.notarise is present, the build is signed with Developer ID and
# notarised via an App Store Connect API key. Without it, an unset signing
# identity produces an ad-hoc local-test build. Ad-hoc app and helper binaries
# have build-specific signatures; an enabled System Settings switch may name
# an older responsible app build and does not prove current recording access.
set -euo pipefail

cd "$(dirname "$0")/.."

# Source signing and notarization secrets if present. Do not echo them.
if [[ -f .env.notarise ]]; then
  # shellcheck disable=SC1091
  source .env.notarise
  if [[ -z "${APPLE_API_KEY:-}" || -z "${APPLE_API_ISSUER:-}" || -z "${APPLE_API_KEY_PATH:-}" || ! -f "${APPLE_API_KEY_PATH:-/nonexistent}" ]]; then
    echo "error: .env.notarise must configure a valid App Store Connect notarization key" >&2
    exit 1
  fi
  if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    APPLE_SIGNING_IDENTITY=$(node -e "process.stdout.write(require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity || '')")
  fi
  if [[ "$APPLE_SIGNING_IDENTITY" != "Developer ID Application:"* ]]; then
    echo "error: .env.notarise requires a Developer ID Application signing identity" >&2
    exit 1
  fi
  if ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
    echo "error: configured Developer ID identity is not valid in the Keychain" >&2
    exit 1
  fi
  export APPLE_SIGNING_IDENTITY
  echo "notarisation: enabled"
else
  echo "notarisation: skipped (no .env.notarise)"
fi

# Keep Tauri, the app bundle, and sidecars on one signing identity. Tauri's
# APPLE_SIGNING_IDENTITY environment variable overrides tauri.conf.json.
CONFIG_IDENTITY=$(node -e "
  const c = require('./src-tauri/tauri.conf.json');
  process.stdout.write((c.bundle && c.bundle.macOS && c.bundle.macOS.signingIdentity) || '');
")
APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-$CONFIG_IDENTITY}"
if [[ -n "${APPLE_API_KEY:-}" ]]; then
  if [[ -z "$APPLE_SIGNING_IDENTITY" || "$APPLE_SIGNING_IDENTITY" == "-" ]]; then
    echo "error: notarisation requires a Developer ID identity (APPLE_SIGNING_IDENTITY)" >&2
    exit 1
  fi
  if ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
    echo "error: signing identity is not valid in the Keychain" >&2
    exit 1
  fi
fi
export APPLE_SIGNING_IDENTITY

# Tauri's beforeBuildCommand owns the complete native chain, including MCP
# and Metal. App-only builds and this DMG wrapper must not diverge.
pnpm tauri build

# Fail before publishing a DMG if the actual app bundle is unsealed or the
# bundler skipped code signing. This also ensures the DMG receives the same
# signed app that was just verified, instead of a later manual re-sign.
APP_BUNDLE="src-tauri/target/release/bundle/macos/HoneyVoice.app"
if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "error: app bundle missing: $APP_BUNDLE" >&2
  exit 1
fi
codesign --verify --deep --strict "$APP_BUNDLE"
if [[ "$APPLE_SIGNING_IDENTITY" == "-" ]]; then
  APP_SIGNATURE=$(codesign -dv "$APP_BUNDLE" 2>&1 || true)
  grep -q 'Signature=adhoc' <<<"$APP_SIGNATURE" || {
    echo "error: local app bundle is not ad-hoc signed" >&2
    exit 1
  }
  echo "warning: local-test-only ad-hoc build; macOS may retain an older app build's permission grant. Keep one installed copy and re-authorize that exact app after replacement." >&2
else
  APP_SIGNATURE=$(codesign -dv "$APP_BUNDLE" 2>&1 || true)
  grep -qF "Authority=$APPLE_SIGNING_IDENTITY" <<<"$APP_SIGNATURE" || {
    echo "error: app bundle is not signed by configured identity" >&2
    exit 1
  }
  ./scripts/verify-macos-permission-identity.sh "$APP_BUNDLE" "$APPLE_SIGNING_IDENTITY"
fi

OUT_DIR="src-tauri/target/release/bundle/dmg"
DMG=$(ls -t "$OUT_DIR"/*.dmg 2>/dev/null | head -n1 || true)

if [[ -z "$DMG" ]]; then
  echo "build finished but no DMG found in $OUT_DIR" >&2
  exit 1
fi

# Tauri's bundler notarises and staples the .app inside the DMG, but doesn't
# submit the DMG itself for its own ticket. Stapling the DMG too means
# Gatekeeper accepts it cleanly when downloaded directly (web links etc.),
# not just after the .app is extracted.
if [[ -n "${APPLE_API_KEY:-}" ]]; then
  if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
    echo "DMG already stapled, skipping"
  else
    echo "Submitting DMG for notarisation…"
    xcrun notarytool submit "$DMG" \
      --key "$APPLE_API_KEY_PATH" \
      --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" \
      --wait
    xcrun stapler staple "$DMG"
    xcrun stapler validate "$DMG"
  fi
fi

echo
echo "DMG ready: $DMG"
if [[ -n "${APPLE_API_KEY:-}" ]]; then
  echo "Signed, notarised, and stapled. Teammates can double-click to install."
elif [[ "$APPLE_SIGNING_IDENTITY" == "-" ]]; then
  echo "Local test build only: ad-hoc signatures do not provide stable macOS privacy identity. Do not distribute as a HoneyVoice release."
else
  echo "Developer ID signed but not notarised. First launch needs right-click → Open."
fi
