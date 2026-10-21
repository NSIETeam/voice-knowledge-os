#!/usr/bin/env bash
# The same complete native preparation runs for dev, app-only and DMG builds.
# Do not put a helper build only in build-dmg.sh: `tauri build --bundles app`
# and a clean development checkout need every declared externalBin as well.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this native build lane is macOS-only; Windows needs its own validated capture/build lane" >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) BUILD_TRIPLE="aarch64-apple-darwin" ;;
  x86_64) BUILD_TRIPLE="x86_64-apple-darwin" ;;
  *) echo "error: unsupported build architecture" >&2; exit 1 ;;
esac

bash scripts/build-sidecar.sh
bash scripts/build-macos-speech.sh
bash scripts/build-diarize.sh
bash scripts/build-metallib.sh
bash scripts/build-mcp.sh

# Fail before Tauri can sign a missing/empty/stale placeholder as a bundle.
while IFS= read -r helper; do
  target="src-tauri/${helper}-${BUILD_TRIPLE}"
  if [[ ! -s "$target" || ! -x "$target" ]]; then
    echo "error: native helper missing, empty or not executable: $target" >&2
    exit 1
  fi
  if ! file "$target" | grep -q 'Mach-O.*executable'; then
    echo "error: native helper is not a Mach-O executable: $target" >&2
    exit 1
  fi
  codesign --verify --strict "$target"
done < <(node -e "for (const p of require('./src-tauri/tauri.conf.json').bundle.externalBin) console.log(p)")

if [[ ! -s src-tauri/resources/default.metallib ]]; then
  echo "error: required Metal library is missing" >&2
  exit 1
fi
echo "native build inputs verified ($BUILD_TRIPLE)"
