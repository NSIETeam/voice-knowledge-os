#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "$(uname -m)" in
  arm64) TRIPLE="aarch64-apple-darwin" ;;
  x86_64) TRIPLE="x86_64-apple-darwin" ;;
  *) echo "unsupported architecture" >&2; exit 1 ;;
esac
mkdir -p src-tauri/binaries
DEST="src-tauri/binaries/macos-speech-$TRIPLE"
STAMP="src-tauri/binaries/.macos-speech-$TRIPLE.stamp"
IDENTITY="${APPLE_SIGNING_IDENTITY:-$(node -e "process.stdout.write(require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity || '')")}"
SRC_HASH=$(
  {
    find macos-speech/Sources macos-speech/Package.swift -type f \
      \( -name '*.swift' -o -name 'Package.swift' \) -print0 |
      sort -z | xargs -0 shasum -a 256
    echo "identity:$IDENTITY"
  } | shasum -a 256 | awk '{print $1}'
)
if [[ "${FORCE_SIDECAR_REBUILD:-0}" != "1" && -s "$DEST" && -f "$STAMP" && "$(cat "$STAMP")" == "$SRC_HASH" ]]; then
  echo "macOS Speech helper unchanged, skipping rebuild"
  exit 0
fi
(
  cd macos-speech
  swift build -c release --product macos-speech
)
cp macos-speech/.build/release/macos-speech "$DEST"
chmod +x "$DEST"
xattr -cr "$DEST" || true
if [[ "$IDENTITY" == "-" ]]; then
  codesign --force --sign - "$DEST"
elif [[ -n "$IDENTITY" ]] && security find-identity -v -p codesigning | grep -qF "$IDENTITY"; then
  codesign --force --options runtime --sign "$IDENTITY" --timestamp "$DEST"
else
  echo "configured signing identity is not valid in the Keychain: $IDENTITY" >&2
  exit 1
fi
echo "$SRC_HASH" > "$STAMP"
echo "built: $DEST"
