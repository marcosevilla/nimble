#!/usr/bin/env bash
# Build a frozen, read-only copy of one commit and serve it for browser QA.
# Tests never run against a worktree an agent is still editing: the copy is a
# `git archive` of an exact commit, built once, then served by `vite preview`.
#
#   tools/qa-frozen.sh <commit> <dest-dir> [port]
#
# <dest-dir> must be outside the repository (a scratch folder), so the build
# stamp can't pick up this checkout's HEAD. node_modules is borrowed by symlink
# from the checkout running the script. Prints the URL; the server keeps
# running in the background (pid in <dest-dir>/preview.pid).
set -euo pipefail

sha=${1:?commit}
dest=${2:?dest dir}
port=${3:-4610}
repo=$(git rev-parse --show-toplevel)
full=$(git -C "$repo" rev-parse --verify "$sha^{commit}")

case "$(cd "$(dirname "$dest")" 2>/dev/null && pwd)/" in
  "$repo"/*) echo "dest must be outside the repository" >&2; exit 1 ;;
esac

if [ -f "$dest/preview.pid" ]; then kill "$(cat "$dest/preview.pid")" 2>/dev/null || true; fi
rm -rf "$dest"
mkdir -p "$dest"
git -C "$repo" archive "$full" | tar -x -C "$dest"
ln -s "$repo/node_modules" "$dest/node_modules"
echo "$full" > "$dest/COMMIT"
chmod -R a-w "$dest/apps/desktop/src" "$dest/tools"

cd "$dest/apps/desktop"
npx vite build --logLevel warn >"$dest/build.log" 2>&1 || { cat "$dest/build.log" >&2; exit 1; }
nohup npx vite preview --port "$port" --strictPort >"$dest/preview.log" 2>&1 &
echo $! > "$dest/preview.pid"
for _ in $(seq 1 50); do
  curl -sf "http://localhost:$port/" >/dev/null && break
  sleep 0.2
done
curl -sf "http://localhost:$port/" >/dev/null || { cat "$dest/preview.log" >&2; exit 1; }
echo "frozen $full → http://localhost:$port"
