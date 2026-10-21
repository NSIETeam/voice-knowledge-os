#!/usr/bin/env bash
# Cut a new HoneyVoice release: build and verify a Developer ID-signed,
# notarized DMG, tag the commit, push the tag, and publish the installable DMG.
# In-app updater artifacts are not configured; users install updates manually.
#
# Prerequisites:
#   - .env.notarise present (Developer ID signing + Apple notarization)
#   - gh CLI authenticated (`gh auth status`)
#   - Working tree clean
#   - Versions in package.json + tauri.conf.json + Cargo.toml all match
#   - That version is greater than the latest GitHub release
#
# Usage: pnpm release   (or: ./scripts/release.sh)
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Sanity checks.
if [[ ! -f .env.notarise ]]; then
  echo "error: .env.notarise missing — required for signing + notarisation" >&2
  exit 1
fi

# Refuse an ad-hoc or partially configured release before touching GitHub.
# Do not print the sourced file: it contains signing/notarization credentials.
# shellcheck disable=SC1091
source .env.notarise
if [[ -z "${APPLE_API_KEY:-}" || -z "${APPLE_API_ISSUER:-}" || -z "${APPLE_API_KEY_PATH:-}" || ! -f "${APPLE_API_KEY_PATH:-/nonexistent}" ]]; then
  echo "error: .env.notarise must configure a valid App Store Connect notarization key" >&2
  exit 1
fi
CONFIG_IDENTITY=$(node -e "process.stdout.write(require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity || '')")
APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-$CONFIG_IDENTITY}"
if [[ "$APPLE_SIGNING_IDENTITY" != "Developer ID Application:"* ]]; then
  echo "error: a Developer ID Application identity is required; ad-hoc builds do not preserve macOS permissions" >&2
  exit 1
fi
if ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
  echo "error: configured Developer ID identity is not valid in the Keychain" >&2
  exit 1
fi
export APPLE_SIGNING_IDENTITY

if ! command -v gh >/dev/null; then
  echo "error: gh CLI not installed (brew install gh)" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh not authenticated (gh auth login)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree has uncommitted changes — commit or stash first" >&2
  git status --short
  exit 1
fi

# 2. Read + cross-check versions across the three files.
VERSION_PKG=$(node -p "require('./package.json').version")
VERSION_CONF=$(node -p "require('./src-tauri/tauri.conf.json').version")
VERSION_CARGO=$(awk -F\" '/^version *=/ {print $2; exit}' src-tauri/Cargo.toml)

if [[ "$VERSION_PKG" != "$VERSION_CONF" || "$VERSION_PKG" != "$VERSION_CARGO" ]]; then
  echo "error: version mismatch:" >&2
  echo "  package.json:       $VERSION_PKG" >&2
  echo "  tauri.conf.json:    $VERSION_CONF" >&2
  echo "  src-tauri/Cargo.toml: $VERSION_CARGO" >&2
  echo "  bump all three to the same value before releasing" >&2
  exit 1
fi

node scripts/check-release-notes.mjs "$VERSION_PKG"

VERSION="$VERSION_PKG"
TAG="v$VERSION"
PRODUCT_NAME=$(node -p "require('./src-tauri/tauri.conf.json').productName")
APP_BUNDLE_NAME="${PRODUCT_NAME}.app"
REPO_SLUG=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
echo "release: $TAG"

# Refuse to overwrite an existing release.
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "error: release $TAG already exists on GitHub — bump the version first" >&2
  exit 1
fi

# 3. Build (signs, notarises, staples).
# Set SKIP_BUILD=1 to reuse existing artifacts on disk — useful when
# recovering from a release-script failure that happened *after* a
# successful build, so we don't rebuild and re-notarise needlessly.
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "SKIP_BUILD=1 → reusing existing artifacts (no rebuild)"
else
  ./scripts/build-dmg.sh
fi

# 4. Locate the DMG by version; never guess based on modification time.

# The DMG's filename carries the version; only the arch suffix varies
# (aarch64 / x64), so glob that much and insist on exactly one match.
shopt -s nullglob
DMG_MATCHES=("src-tauri/target/release/bundle/dmg/${PRODUCT_NAME}_${VERSION}_"*.dmg)
shopt -u nullglob
if (( ${#DMG_MATCHES[@]} != 1 )); then
  echo "error: expected exactly one DMG named for $VERSION, found ${#DMG_MATCHES[@]}" >&2
  printf '  %s\n' "${DMG_MATCHES[@]:-(none)}" >&2
  echo "  run ./scripts/build-dmg.sh, and delete any DMG from another version" >&2
  exit 1
fi
DMG="${DMG_MATCHES[0]}"

# Check the signed bundle and notarization tickets even for SKIP_BUILD=1.
APP_BUNDLE="src-tauri/target/release/bundle/macos/${APP_BUNDLE_NAME}"
if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "error: app bundle missing: $APP_BUNDLE" >&2
  exit 1
fi
codesign --verify --deep --strict "$APP_BUNDLE"
./scripts/verify-macos-permission-identity.sh "$APP_BUNDLE" "$APPLE_SIGNING_IDENTITY"
APP_SIGNATURE=$(codesign -dv --verbose=2 "$APP_BUNDLE" 2>&1 || true)
if grep -q 'Signature=adhoc' <<<"$APP_SIGNATURE" || ! grep -qF "Authority=$APPLE_SIGNING_IDENTITY" <<<"$APP_SIGNATURE"; then
  echo "error: app bundle is not signed by the configured Developer ID identity" >&2
  exit 1
fi
xcrun stapler validate "$APP_BUNDLE"
xcrun stapler validate "$DMG"
echo "release artifact: $DMG"

# 5. Tag and push.
#
# The BRANCH goes first, then the tag. Pushing only the tag — which is what this
# did until v0.42.0 — leaves the version bump sitting unpushed on the local branch
# while the release itself looks complete: the tag resolves, the assets upload, the
# published. What breaks is everything that reads the branch. GitHub's main
# says the old version, a fresh clone can't reproduce the release it's tagged at,
# and the next release's "is the version bumped past the latest release?" guard
# compares against a tree that never got the last bump.
#
# Order matters for the same reason: a tag pushed ahead of its branch points at a
# commit the remote branch doesn't contain yet, so anyone fetching in that window
# sees a tag hanging off nothing.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push origin "$BRANCH"
git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"

# 6. Create GitHub release with the installable DMG.
gh release create "$TAG" \
  --title "$TAG" \
  --repo "$REPO_SLUG" \
  --notes "HoneyVoice $TAG for macOS. Download the DMG, open it, and drag HoneyVoice into Applications. Updates are installed manually from this release page." \
  "$DMG"

echo
echo "✅ Released $TAG"
echo "   https://github.com/$REPO_SLUG/releases/tag/$TAG"
