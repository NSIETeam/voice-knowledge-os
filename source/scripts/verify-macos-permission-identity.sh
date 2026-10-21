#!/usr/bin/env bash
# Validate the app and helper's release signatures. Different designated
# requirements are normal for nested code; TCC follows responsible-process
# attribution, which must be verified from a real installed capture.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <App.app> <Developer ID Application identity>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$1"
if [[ "$APP_BUNDLE" != /* ]]; then
  APP_BUNDLE="$REPO_ROOT/$APP_BUNDLE"
fi
EXPECTED_IDENTITY="$2"
if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "error: app bundle missing: $APP_BUNDLE" >&2
  exit 1
fi

APP_EXECUTABLE_NAME=$(plutil -extract CFBundleExecutable raw -o - "$APP_BUNDLE/Contents/Info.plist")
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/$APP_EXECUTABLE_NAME"
CAPTURE_HELPER="$APP_BUNDLE/Contents/MacOS/audio-capture"

for executable in "$APP_EXECUTABLE" "$CAPTURE_HELPER"; do
  if [[ ! -f "$executable" ]]; then
    echo "error: permission-bearing executable missing: $executable" >&2
    exit 1
  fi
  codesign --verify --strict "$executable"
  details=$(codesign -dv --verbose=2 "$executable" 2>&1 || true)
  if grep -q 'Signature=adhoc' <<<"$details" || ! grep -qF "Authority=$EXPECTED_IDENTITY" <<<"$details"; then
    echo "error: $executable is not signed by the configured stable Developer ID identity" >&2
    exit 1
  fi
done

app_details=$(codesign -dv --verbose=2 "$APP_EXECUTABLE" 2>&1 || true)
helper_details=$(codesign -dv --verbose=2 "$CAPTURE_HELPER" 2>&1 || true)
app_identifier=$(sed -n 's/^Identifier=//p' <<<"$app_details" | head -n 1)
helper_identifier=$(sed -n 's/^Identifier=//p' <<<"$helper_details" | head -n 1)
configured_identifier=$(node -e "process.stdout.write(require('$REPO_ROOT/src-tauri/tauri.conf.json').identifier)")
if [[ "$app_identifier" != "$configured_identifier" || "$helper_identifier" != "$configured_identifier" ]]; then
  echo "error: app/helper code identifiers do not both match $configured_identifier" >&2
  exit 1
fi

app_team=$(sed -n 's/^TeamIdentifier=//p' <<<"$app_details" | head -n 1)
helper_team=$(sed -n 's/^TeamIdentifier=//p' <<<"$helper_details" | head -n 1)
if [[ -z "$app_team" || "$app_team" == "not set" || "$app_team" != "$helper_team" ]]; then
  echo "error: app and capture helper must be signed by the configured developer team" >&2
  exit 1
fi

echo "Release signatures verified for $app_identifier (team $app_team). Installed recording permission still requires runtime acceptance."
