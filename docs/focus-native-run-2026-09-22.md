# Focus Queue — native test run and known bugs (2026-09-22)

Hands-on native run of the Focus Queue absorption (Tasks 1–9) on Marco's Mac, plus every known open bug at the time of writing. Companion to the full checklist in [focus-native-checklist.md](focus-native-checklist.md).

- **Branch:** `codex/focus-absorption`. The run started at `0e453ec`, and fixes were loaded live up to `fbdecb0`. Native fix 3 (`9e002d1`) was still in review and its fixes weren't loaded yet.
- **Profile:** synthetic only, at `/private/tmp/nimble-backup-test-focus` (it has the `synthetic-profile` marker file). The installed `/Applications/Nimble.app` and its data were never touched.
- **Nothing pushed or installed.**

## How to re-run

1. Create the profile. The directory name must start with `nimble-backup-test-` and sit under `/private/tmp`:
   `mkdir -p /private/tmp/nimble-backup-test-focus && printf 'nimble-synthetic-only\n' > /private/tmp/nimble-backup-test-focus/synthetic-profile`
2. Run the app from a **separate frozen worktree**, never from the one an agent is editing. The first run crashed because `tauri dev` rebuilt on another agent's half-finished Rust edit.
   `git worktree add --detach ../nimble-focus-test <commit>`
   Clone `node_modules` in with `cp -c -R`. Don't symlink it, or Vite blocks fonts that load from outside the worktree.
3. From `apps/desktop`:
   `CARGO_TARGET_DIR=<separate dir> NIMBLE_BACKUP_TEST_ROOT=/private/tmp/nimble-backup-test-focus npm run tauri dev`
4. Isolated test mode has no tray menu, no global shortcuts and no logger plugin, so the checklist items that need those have to be run another way.
5. To check results, read the synthetic DB, for example:
   `sqlite3 -readonly …/nimble.db "select status,work_ms,checkpoint_at from focus_sessions order by rowid desc limit 1; select recovery_reason from focus_runtime;"`

## Results

| ID | Checklist item | Check | Result |
|---|---|---|---|
| A | 1 | Pop out opens the companion right away and nothing starts | **PASS** after native fix 1 (it failed first: every task showed "Task no longer available") |
| B | 2 | Companion stays above other apps | **PASS** |
| C | 5, 6 | Title-bar drag works; expanded height stops at its bounds; footer stays pinned | **PASS** |
| D | 7 | Compact card-only mode refits and scales with width | **FAIL**: the timer digits were clipped vertically. Native fix 3 is pending, then a re-test |
| E | 33 | Running timer ticks about once a second and never jumps back | **PASS** |
| F | 17 | Space pauses a running timer and never resumes it | **PASS** |
| G | 16 | Alt+↑/↓ reorder keeps keyboard focus | **FAIL**: Up next had no row focus at all. Native fix 3 (roving focus) is pending, then a re-test |
| H | 28 | 1-minute timebox plays one chime at 0:00, then red overtime with no second chime | **PASS** |
| I | 29 | Completing the focused task plays one completion sound | **PASS** |
| J | 18, 20 | Closing the companion keeps timing; closing the last window pauses it and it never auto-resumes | **PASS**: the DB recorded "the last focus window was closed" |
| K | 22 | ⌘Q while running; after relaunch it is paused with the time up to the quit | **PASS**: ⌘Q sent via osascript; 41,481 ms matched Start→quit exactly; reason "Nimble quit"; still paused after relaunch |
| L | 25 | System sleep while running; after wake it is paused with no auto-resume | **NOT RUN**: needs Marco at the Mac |
| — | new | Visible queue entries (row icon and menu, task detail control) | **PASS** |

**Not run this pass:**
- 3: Spaces and full-screen apps
- 8–10: small or removed displays
- 12–14: shadow and popover sweep across themes
- 21: tray and ⌘⇧T, which isolated mode disables
- 23: `kill -9`
- 24: second process
- 26: `pmset sleepnow`
- 30–32: mute, no audio device, Pomodoro chimes

## Bugs found by the native run

| # | Bug | Status |
|---|---|---|
| N1 | The companion showed every queued task as "Task no longer available". **Cause:** the companion window mounts hidden at launch and read tasks once, and desktop task writes sent no event to other windows. | Fixed in `370e322`: every write now emits `nimble-data-changed`, and the companion re-reads when shown |
| N2 | Footer copy was unclear ("Queue these", "Browse candidates"). | Fixed in `370e322`: now "From: Today ▾", "Add N to queue" / "All added", and "Nimble only" |
| N3 | No visible way to queue a task from task rows or task detail. | Fixed in `8a4b444`, `5030d72`, `fbdecb0`: row icon and menu, task-detail Focus control, Undo on remove, hidden for completed tasks, friendly error text |
| N4 | The multi-select Focus control nested a `<button>` inside a `<button>`. | Fixed in `8a4b444` |
| N5 | The dev app crashed partway through the run. **Cause:** a test-setup error, since the app ran from the worktree being edited. | Process fixed: use a frozen test worktree |
| N6 | Compact companion clipped the timer digits. | Fix in `9e002d1` (timer line-height 1.2, rounding up the fit, measured 32px titlebar). Root cause unconfirmed; **re-test D natively** |
| N7 | No row focus in Up next, so Alt+Arrow was unusable. | Fix in `9e002d1` (roving focus). **Review found a critical bug:** Enter on a focused row completed the card's task in the main view. A fix round is in progress: guard Enter, add Undo for Delete, keep focus after promote |

## Known open bugs

Minor findings from the per-task reviews, still open. Each line says where the bug is and what it does. Items marked ✅ were fixed later on the branch.

### Worth fixing before daily use
- **Raw engine text still reaches users:**
  - `BulkActionBar` (its `messageOf`) and `focusQueueIntents` (`messageOf`) show raw engine errors.
  - `BulkActionBar` still offers Focus now on a completed selection.
  - Fix: route both through `focusEntryErrorMessage`.
- **The recovery dialog shows raw engine reason text** (Task 8). It should use friendly copy.
- **Task history total is partial until you click Show more** (50 per page). Label it as partial, or have the engine return a total. The completed tray also reads only page 1.
- **Undo after a remove re-adds the task at the end of the queue**, and it silently does nothing if another focus write is still pending.
- **The compact empty state still uses the old wording** (`FocusTaskCard.tsx:264`): "Pick a source below…" should become "Pick where to add tasks from below."
- **A second process silently turns off background sync.** Also, `acquire_profile_owner` returns None on any IO error that isn't WouldBlock (`lib.rs:71-86`). The app should show a visible reason.
- **The owner lock is only tried once, with a 1 s retry.** A restart while the old process is still exiting leaves the new process read-only for its whole life.
- **Pre-existing subtasks of local-only tasks** may already have queued Todoist creates. **Check live data before installing** (Task 6b).
- **Every task row reserves about 58px for the new actions**, and the icon mixes `aria-pressed` with an action label. Check visually on dense rows.
- **The timer is 48px against the 34px baseline, and amber and deep amber differ only by font weight.** Needs a visual review across themes.

### Correctness edge cases (rare)
- **Wake only broadcasts.** A heartbeat on wake would apply the gap pause immediately (`focus_window.rs:260`).
- **An interrupt after a gap pause overwrites the recovery reason** (`engine.rs:589`).
- **`begin_task_write` samples its clock before `BEGIN IMMEDIATE`,** so the display can step backwards under DB contention (`engine.rs:289-302`).
- **The display can flicker phantom time for 1–2 frames on a coalesced resume** (`focusDisplay.ts:101-103`).
- **If the heartbeat keeps failing while a boundary is due,** it retries and logs every 50 ms (`focus_window.rs:356-360`).
- **The restored-profile headless fallback drops `command_id`,** so a `dt` retry after an uncertain Create can duplicate the task.
- **`expectedDueDate` undefined means opposite things:** desktop refuses, web skips the check.
- **Errors in Turso pull chunks now abort the whole pull without saving the cursor,** and a persistent reconcile error blocks draining.
- **`sync.rs` effects-merge read errors skip `TaskWrite::abandon`.** Drop freezes the clock, and it recovers at the next checkpoint.
- **`convert_capture_to_task` doesn't emit `nimble-data-changed`,** so the companion only picks up the new task when it is refocused.
- **The Todoist push debounce now runs only in the main window's timer.** A 5-minute Rust interval and focus-gain sync back it up.
- **Bulk enqueue tags every entry with the Today source.** Group by `sourceForTask` instead.
- **A local-only parent with a stale `external_id` plus a pulled Todoist child** leaves a mixed tree. Changing a parent's policy doesn't cascade to its children.
- **`dt`'s lock check says "Nimble is running" when the lock file can't be read.**
- **The mute icon isn't synced across windows.** The behaviour is correct; only the icon is stale.
- **The companion only re-clamps on focus or visibility change,** not on move or scale change. Its position isn't remembered across launches.
- **A completion note can linger after you minimize within 2.5 s,** blocking Enter and `s`.
- **⇧F uses the Dashboard's inline `isInput` guard,** so it can toggle the queue behind dialogs.
- **Quick-add Enter ignores IME composition.** Quick-add also calls raw `onAction` instead of `run`.
- **`isUncertain` treats a definite storage error as uncertain,** causing one redundant retry.
- **Focus and web capability reads:**
  - Capabilities are read once per connection.
  - `onSnapshot` clears an action error on any invalidation read.
  - The `loading` flag races between two readers.
  - On web, `sessionFor` throws an untyped `TursoError`.
- **A cyclic parent link silently hides both tasks from candidates.**
- **Hidden-window work:** the display interval keeps firing while hidden, and the idle heartbeat opens a write transaction every 20 s.

### Test gaps
- **Rendered-path tests are missing** for:
  - the `FocusPlayMenu` hidden-for-completed path
  - the NavButton and ⇧F keydown path
  - the display hook's `setMemo(null)`
  - the display's 1 s slack boundary
- **The end-to-end desktop `execute_task` path isn't tested,** neither via FocusRuntime nor via the agent server's NativeTask dispatch.
- **The ack and card-order tests are weak.**

### Cleanup
- `FocusQueueTray.tsx` is about 490 lines; `FocusQuickAdd` is the natural piece to split out.
- "N done" appears in both the tray header and the footer.
- There is a stale comment in `tauri-window-stub.ts`.
- `mock-tauri.js` still seeds the retired focus settings.
- Pre-existing rustfmt drift in `task_tx.rs` and `focus_task_tx.rs`.

### ✅ Fixed later on the branch
- Promote button mislabelled "Focus now" (Task 8).
- `pending` not blocking repeat clicks (Task 8).
- BulkActionBar reporting refused completions as successes (Task 8).
- Start accepted without live timing (Task 9).
- External ID line shown on local-only tasks (Task 6b).
- Blank tray when no snapshot is loaded (Task 9).
- Phantom display time after pause (`1717317`).

## Next steps
1. Re-test **D** and **G** once native fix 3 clears review.
2. Run **L** (sleep) at the Mac.
3. Triage the "worth fixing before daily use" list: one fix batch, or fold it into the final whole-branch review.
4. Resume with **Task 10** (import).
