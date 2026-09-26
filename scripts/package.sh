#!/usr/bin/env bash
# Builds dist/openkbs-snap-<version>.zip (Chrome Web Store upload / GitHub release asset)
# and dist/openkbs-snap.zip (stable name for the download page).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
PKG=$(node -p "require('./package.json').version")
if [ "$VERSION" != "$PKG" ]; then echo "manifest.json ($VERSION) and package.json ($PKG) versions differ" >&2; exit 1; fi
npm run --silent check
rm -rf dist && mkdir -p dist
zip -q -r "dist/openkbs-snap-$VERSION.zip" manifest.json bg.js content.js console-hook.js popup.html popup.js panel.html panel.js panel.css ui.css lib icons -x 'icons/icon.svg' -x '.DS_Store'
cp "dist/openkbs-snap-$VERSION.zip" dist/openkbs-snap.zip
echo "dist/openkbs-snap-$VERSION.zip ($(du -h dist/openkbs-snap.zip | cut -f1))"
