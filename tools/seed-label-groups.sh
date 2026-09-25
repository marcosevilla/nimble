#!/usr/bin/env bash
# Seed Marco's C4 label taxonomy (spec 2026-09-25-c4-labels-search-design.md §0, decision 1).
# One-time, post-install, only with Marco's OK. Never run by a migration or on another profile.
# Idempotent: groups are reused by name, re-assigning is a no-op, archived labels stay archived.
#
#   tools/seed-label-groups.sh                                    # live profile; Nimble must be running (backs up first)
#   SKIP_BACKUP=1 tools/seed-label-groups.sh --profile <synthetic-profile-dir>   # rehearsal
#   tools/seed-label-groups.sh --dry-run                          # print the plan; writes nothing, no backup
#
# If any assignment fails (anything but "no label with this name", which is a
# warning), the script stops with exit 1 BEFORE archiving anything.
#
# Labels are matched by EXACT name only (Marco, 2026-09-25): the live DB has
# near-duplicates such as "admin" / "🛟 admin", and only the listed name is
# grouped. The emoji variants stay ungrouped, so with no open task they are
# archived by the final "unused" step like any other ungrouped label.
# Grouped labels are never archived (`dt label unused` never lists them).
#
# Extra arguments are passed to every dt call as global flags. Needs jq (macOS ships /usr/bin/jq).
set -euo pipefail

DT=${DT:-dt}
DRY_RUN=
EXTRA=()
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then DRY_RUN=1; else EXTRA+=("$arg"); fi
done
# ${EXTRA[@]+...}: an empty array under `set -u` is an error in macOS's bash 3.2.
dtj() { "$DT" --json ${EXTRA[@]+"${EXTRA[@]}"} "$@"; }

EFFORT=(deep quick)
# Exact live names (2026-09-25): errands and photography exist only with their
# emoji prefix; plain "admin" is kept and "🛟 admin" stays ungrouped (archived).
TYPE=(comms admin "🚗 errands" "📸 photography" health)
STATE=(waiting avoidance)
ASSIST=(needs-claude)
SYSTEM=(from-instinct nimble)

summary() {
  dtj label list | jq -r '.data | "  labels \(length) · archived \([.[] | select(.archived_at != null)] | length) · grouped \([.[] | select(.group != null)] | length)"'
  dtj label group list | jq -r '.data[] | "  group \(.name)\(if .exclusive then " · pick one" else "" end)\(if .system then " · system" else "" end)"'
}

group() {
  if [ -n "$DRY_RUN" ]; then
    local found
    found=$(dtj label group list | jq -r --arg n "$1" '[.data[] | select((.name | ascii_downcase) == ($n | ascii_downcase))] | length')
    if [ "$found" = "0" ]; then echo "  would create group $*"; else echo "  group $1 exists (flags only switch on: $*)"; fi
    return
  fi
  dtj label group create "$@" | jq -e '.ok' >/dev/null
}

FAILURES=0
PLANNED_IDS=()

# assign <GROUP> <exact label name>…  — resolves each name to an id with an
# exact, case-sensitive match, so "admin" never picks up "🛟 admin" or "Admin".
assign() {
  local target=$1 name id out labels groups current
  shift
  labels=$(dtj label list)
  groups=$(dtj label group list)
  for name in "$@"; do
    id=$(echo "$labels" | jq -r --arg n "$name" '[.data[] | select(.name == $n) | .id] | first // empty')
    if [ -z "$id" ]; then
      echo "  warning: skipped $name (no label with exactly this name)"
      continue
    fi
    PLANNED_IDS+=("$id")
    if [ -n "$DRY_RUN" ]; then
      current=$(echo "$labels" | jq -r --arg id "$id" --argjson g "$groups" \
        '.data[] | select(.id == $id) | .group as $gid | ([$g.data[] | select(.id == $gid) | .name] | first // "")')
      if [ "$(echo "$current" | tr '[:upper:]' '[:lower:]')" = "$(echo "$target" | tr '[:upper:]' '[:lower:]')" ]; then
        echo "  $name already in $target"
      else
        echo "  would put $name → $target"
      fi
      continue
    fi
    if out=$(dtj label group assign "$id" "$target"); then
      echo "  $name → $target"
    else
      echo "  FAILED $name → $target: $(echo "$out" | jq -r '.error.message' 2>/dev/null || echo "$out")" >&2
      FAILURES=$((FAILURES + 1))
    fi
  done
}

echo "Before:"
summary

if [ -n "$DRY_RUN" ]; then
  echo "Dry run: nothing is written and no backup is taken."
elif [ -z "${SKIP_BACKUP:-}" ]; then
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

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES assignment(s) failed. Stopping before archiving anything; fix and re-run (it is idempotent)." >&2
  exit 1
fi

echo "Archiving ungrouped labels with no open tasks (grouped labels are never archived)…"
if [ -n "$DRY_RUN" ]; then
  # Labels about to be grouped would no longer count as unused.
  planned_json=$(printf '%s\n' ${PLANNED_IDS[@]+"${PLANNED_IDS[@]}"} | jq -R . | jq -s 'map(select(. != ""))')
  dtj label unused | jq -r --argjson planned "$planned_json" \
    '[.data[] | select(.id as $id | ($planned | index($id)) == null) | .name] | "  would archive \(length): \(join(", "))"'
  echo "Dry run complete."
  exit 0
fi
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
