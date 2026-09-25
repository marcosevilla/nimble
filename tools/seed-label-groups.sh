#!/usr/bin/env bash
# Seed Marco's C4 label taxonomy (spec 2026-09-25-c4-labels-search-design.md §0, decision 1).
# One-time, post-install, only with Marco's OK. Never run by a migration or on another profile.
# Idempotent: groups are reused by name, re-assigning is a no-op, archived labels stay archived.
#
#   tools/seed-label-groups.sh                                    # live profile; Nimble must be running (backs up first)
#   SKIP_BACKUP=1 tools/seed-label-groups.sh --profile <synthetic-profile-dir>   # rehearsal
#
# Labels are matched by EXACT name only (Marco, 2026-09-25): the live DB has
# near-duplicates such as "admin" / "🛟 admin", and only the plain name is
# grouped. The emoji variants stay ungrouped, so with no open task they are
# archived by the final "unused" step like any other ungrouped label.
# Grouped labels are never archived (`dt label unused` never lists them).
#
# Extra arguments are passed to every dt call as global flags. Needs jq (macOS ships /usr/bin/jq).
set -euo pipefail

DT=${DT:-dt}
EXTRA=("$@")
# ${EXTRA[@]+...}: an empty array under `set -u` is an error in macOS's bash 3.2.
dtj() { "$DT" --json ${EXTRA[@]+"${EXTRA[@]}"} "$@"; }

EFFORT=(deep quick)
TYPE=(comms admin errands photography health)
STATE=(waiting avoidance)
ASSIST=(needs-claude)
SYSTEM=(from-instinct nimble)

summary() {
  dtj label list | jq -r '.data | "  labels \(length) · archived \([.[] | select(.archived_at != null)] | length) · grouped \([.[] | select(.group != null)] | length)"'
  dtj label group list | jq -r '.data[] | "  group \(.name)\(if .exclusive then " · pick one" else "" end)\(if .system then " · system" else "" end)"'
}

group() { dtj label group create "$@" | jq -e '.ok' >/dev/null; }

# assign <GROUP> <exact label name>…  — resolves each name to an id with an
# exact, case-sensitive match, so "admin" never picks up "🛟 admin" or "Admin".
assign() {
  local target=$1 name id out labels
  shift
  labels=$(dtj label list)
  for name in "$@"; do
    id=$(echo "$labels" | jq -r --arg n "$name" '[.data[] | select(.name == $n) | .id] | first // empty')
    if [ -z "$id" ]; then
      echo "  skipped $name: no label with exactly this name"
      continue
    fi
    if out=$(dtj label group assign "$id" "$target"); then
      echo "  $name → $target"
    else
      echo "  skipped $name: $(echo "$out" | jq -r '.error.message')"
    fi
  done
}

echo "Before:"
summary

if [ -z "${SKIP_BACKUP:-}" ]; then
  echo "Backing up first (Nimble must be running)…"
  dtj backup now | jq -e '.ok' >/dev/null || { echo "Backup failed. Nothing was changed." >&2; exit 1; }
fi

group EFFORT --pick-one
group TYPE
group STATE
group ASSIST
group SYSTEM --system
assign EFFORT "${EFFORT[@]}"
assign TYPE "${TYPE[@]}"
assign STATE "${STATE[@]}"
assign ASSIST "${ASSIST[@]}"
assign SYSTEM "${SYSTEM[@]}"

echo "Archiving ungrouped labels with no open tasks (grouped labels are never archived)…"
to_archive=$(dtj label unused | jq -r '.data[].id')
if [ -n "$to_archive" ]; then
  # Word splitting is intended: one id per argument.
  # shellcheck disable=SC2086
  dtj label archive $to_archive | jq -r '.data | "  archived \(length)"'
else
  echo "  nothing to archive"
fi

echo "After:"
summary
