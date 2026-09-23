#!/usr/bin/env bash
# One-command production update: pull → build → swap bundle → clear WebKit cache → relaunch.
# Usage: npm run update-app   (from repo root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Nimble"
BUNDLE_ID="com.marcosevilla.daily-triage"

cd "$ROOT"
echo "▸ Pulling latest main…"
git pull --ff-only origin main || echo "⚠ pull skipped (dirty tree or diverged) — building local code as-is"

echo "▸ Installing deps…"
npm install

echo "▸ Building release bundle (this takes a few minutes)…"
cd apps/desktop
npm run tauri build -- --bundles app

# Exact app name in the Cargo workspace target — the bundle dir can contain stale pre-rebrand bundles.
# (No `find` here: under pipefail a missing search dir aborted the script silently after bundling.)
APP_SRC="$ROOT/target/release/bundle/macos/$APP_NAME.app"
if [ ! -d "$APP_SRC" ]; then
  echo "✗ Build output not found at $APP_SRC" >&2
  exit 1
fi

echo "▸ Installing to /Applications…"
osascript -e "quit app \"$APP_NAME\"" 2>/dev/null || true
sleep 2
rm -rf "/Applications/$APP_NAME.app"
ditto "$APP_SRC" "/Applications/$APP_NAME.app"

# Stale WebKit cache after a bundle swap causes a half-updated UI — always clear it.
echo "▸ Clearing WebKit cache…"
rm -rf "$HOME/Library/WebKit/$BUNDLE_ID"

echo "▸ Relaunching…"
open "/Applications/$APP_NAME.app"
echo "✓ Updated to $(git -C "$ROOT" rev-parse --short HEAD)"
