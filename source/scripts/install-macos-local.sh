#!/usr/bin/env bash
# Install one local HoneyVoice copy. Preserve previous bundles for rollback;
# never remove application data or modify macOS privacy grants.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then CHECK_ONLY=1; shift; fi
SOURCE="${1:-$ROOT/src-tauri/target/release/bundle/macos/HoneyVoice.app}"
TARGET="/Applications/HoneyVoice.app"
USER_COPY="$HOME/Applications/HoneyVoice.app"
EXPECTED_ID="com.miraphant.voice-memory"

[[ -d "$SOURCE" && ! -L "$SOURCE" ]] || { echo "error: candidate app missing or symlinked" >&2; exit 1; }
[[ "$SOURCE" != "$TARGET" && "$SOURCE" != "$USER_COPY" ]] || { echo "error: source must be a built candidate" >&2; exit 1; }
APP_ID=$(plutil -extract CFBundleIdentifier raw -o - "$SOURCE/Contents/Info.plist")
VERSION=$(plutil -extract CFBundleShortVersionString raw -o - "$SOURCE/Contents/Info.plist")
[[ "$APP_ID" == "$EXPECTED_ID" ]] || { echo "error: unexpected candidate bundle identifier" >&2; exit 1; }
codesign --verify --deep --strict "$SOURCE"

for installed in "$TARGET" "$USER_COPY"; do
  [[ ! -L "$installed" ]] || { echo "error: refusing symlinked installation: $installed" >&2; exit 1; }
  if [[ -e "$installed" ]]; then
    installed_id=$(plutil -extract CFBundleIdentifier raw -o - "$installed/Contents/Info.plist")
    [[ "$installed_id" == "$EXPECTED_ID" ]] || { echo "error: unexpected app at $installed" >&2; exit 1; }
  fi
done
echo "Candidate: HoneyVoice $VERSION"
echo "Install location: $TARGET"
if [[ "$CHECK_ONLY" == 1 ]]; then exit 0; fi

for installed in "$TARGET" "$USER_COPY"; do
  if pgrep -fx "$installed/Contents/MacOS/humla" >/dev/null; then
    echo "error: quit HoneyVoice before installing ($installed)" >&2
    exit 1
  fi
done

BACKUP_ROOT="$HOME/Library/Application Support/HoneyVoice-install-backups"
mkdir -p "$BACKUP_ROOT"
BACKUP_DIR=$(mktemp -d "$BACKUP_ROOT/install.XXXXXX")
STAGE=$(mktemp -d "/Applications/.honeyvoice-install.XXXXXX")
COMMITTED=0
rollback() {
  if [[ "$COMMITTED" == 0 ]]; then
    if [[ -d "$BACKUP_DIR/system-HoneyVoice.app.disabled" && ! -e "$TARGET" ]]; then
      mv "$BACKUP_DIR/system-HoneyVoice.app.disabled" "$TARGET"
    fi
    if [[ -d "$BACKUP_DIR/user-HoneyVoice.app.disabled" && ! -e "$USER_COPY" ]]; then
      mv "$BACKUP_DIR/user-HoneyVoice.app.disabled" "$USER_COPY"
    fi
    echo "Installation incomplete; previous bundles restored where possible. Inspect $BACKUP_DIR and $STAGE" >&2
  fi
}
trap rollback EXIT

ditto "$SOURCE" "$STAGE/HoneyVoice.app"
codesign --verify --deep --strict "$STAGE/HoneyVoice.app"
if [[ -d "$TARGET" ]]; then mv "$TARGET" "$BACKUP_DIR/system-HoneyVoice.app.disabled"; fi
if [[ -d "$USER_COPY" ]]; then mv "$USER_COPY" "$BACKUP_DIR/user-HoneyVoice.app.disabled"; fi
[[ ! -e "$TARGET" ]] || { echo "error: target appeared during install" >&2; exit 1; }
mv "$STAGE/HoneyVoice.app" "$TARGET"
COMMITTED=1
rmdir "$STAGE"
echo "Installed HoneyVoice $VERSION at $TARGET"
echo "Previous applications are recoverable from: $BACKUP_DIR"
echo "Notes, recordings, credentials, and privacy settings were not modified."

