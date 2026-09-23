# Nimble — Open loops

Updated 2026-09-22 (Focus Queue: all 12 plan tasks implemented, Task 12 verification recorded; awaiting final whole-branch review + Marco's 30-min human checklist; design facelift loop 1, Stage B merged). Earlier: 2026-09-21 installed Google OAuth repair and verified first live sync. Current status below supersedes earlier installation snapshots.

## Focus Queue absorption — 2026-09-22 (implementation complete; verification + live gates open)

- [x] Marco approved the architecture: native tasks, deliberately ordered durable queue, one authoritative durable timer/session engine across main and companion windows, full shipped Focus Queue capability coverage, optional Nimble Pomodoro, previewed import and reversible daily trial. Follow-up: preserve Focus Queue layout, interaction and information hierarchy as much as practical within Nimble's current design system.
- [x] Draft and self-review the [replacement architecture spec](docs/superpowers/specs/2026-09-22-focus-queue-absorption-design.md). The August integration plan is historical; it incorrectly assumes existing session persistence and conflates scheduling duration with focus budgets.
- [x] Marco approved the full written spec, including §2 defaults and §4 source-UI mapping/deviations.
- [x] Prepare the [12-task implementation plan](docs/superpowers/plans/2026-09-22-focus-queue-absorption.md), with schema/transaction/timer/provider/UI/companion/import/delivery gates. Marco explicitly authorized execution immediately after planning; no repeat plan/method approval needed.
- [x] Implement and independently review Tasks 1–4: schema/domain, atomic native task transactions, durable queue/timer engine, backup/safe restore/ordered replication. Code through `0a6117e`; [verification evidence](docs/focus-queue-verification.md) records tests and review fixes.
- [x] Task 5 (resumed 2026-09-22): one managed desktop FocusService behind thin Tauri commands; `DataProvider.focus` on desktop and read-only web replica; provider-root `nimble-focus-changed` bridge; desktop task commands, app-handled `dt` RPC and incoming Todoist/Turso/Calendar applies routed through the service. Commits `a0f0272`, `e5a9baf`; reviewed (one fix round). 412 Rust, 110 frontend tests, desktop/web builds pass. Foundation checkpoint (Tasks 1–5) reached.
- [x] Task 6: pure focus helpers (`focusModel` timer presentation, `focusSources` Today/project/local-only candidates with section-lane project order, `focusPrompt`) and the provider-backed `useFocusCache` store (snapshot/capabilities/error only; same-envelope `retryFocusCommand`). Commits `3f86cfd`, `976f4a5`; reviewed (one fix round). 143 frontend tests, desktop build pass.
- [x] Decided 2026-09-22: keep the “Nimble Focus” prompt header; `task-assist` recognizes it and routes by the prompt’s route lines.
- [x] Task 6b: children of local-only tasks stay local-only; copied prompt names the exact write-back route (`task-assist` skill updated to match). `082ae9a`.
- [x] Task 7: focus card, Up next queue, source picker, timebox picker, completed tray, inline quick-add, local-only rename/duplicate/delete-Undo, visible Copy assistant context. `3d8282a`, `0e71c8a`.
- [x] Task 8: every entry point routes through the engine (multi-select enqueues; Focus now = explicit start; celebration never auto-starts; Space pauses only a running timer); legacy interval timer and start/end commands removed; per-task history with Recorded/Imported provenance; permanent Focus queue nav icon + ⇧F. `b48ee12`, `4d5172c`.
- [x] Task 9: always-on-top companion (`?window=focus`, own minimal capability), Rust 20 s heartbeat + boundary-timed wakes, sleep/quit/last-surface-close pause, sleep-inclusive clock, profile owner lock (non-owner refuses writes and sync), owner-only durable chime incl. Pomodoro, 1 s display-only tick. Live timing ON. `0321931`, `a6b78fc`. 221 frontend / 427 Rust tests, builds pass.
- [x] Display phantom-time fix `1717317` (reviewed).
- [x] Native hands-on run 2026-09-22 — results + every known open bug: [`docs/focus-native-run-2026-09-22.md`](docs/focus-native-run-2026-09-22.md). 10/12 pass. Native fixes `370e322` (companion task sync + footer copy), `8a4b444`/`5030d72`/`fbdecb0` (visible queue entries) reviewed.
- [x] **Native fix 3** (`9e002d1` + round 1 `fbda5de` + `1b2917a`): compact timer clipping (D) and Up next roving focus (G). Scoped re-review 2026-09-22 approved; its one worthwhile minor (removing the last Up next row dropped focus to body, so Enter completed the card task) fixed in `1b2917a` (269/269, build). Remaining minors for final review: completion acknowledgement swallows Enter on a row; rename state breaks row aria-labelledby. Test worktree advanced to `1b2917a` and relaunched (scratchpad native-dev-5.log).
- [x] Re-tested natively 2026-09-22: D, G (after `484cfb1` row ring on `:focus`) and L all pass. Native run is now 12/12 pass. Test worktree at `484cfb1`.
- [ ] Triage the run doc’s “Worth fixing before daily use” list (one batch or fold into final whole-branch review).
- [x] Task 10 import preview/commit (`64ee0a4`, `4572010`) and Task 11 optional time delivery + pending reconciliation (`ec0956a`, `fd75a2f`, `95bbb53`), each reviewed.
- [x] Task 12 verification (see [verification record](docs/focus-queue-verification.md) → Task 12): 477 Rust (1 ignored native-seed helper), 279 frontend, desktop/web builds, zero new lint findings; synthetic backup → import → repeat → isolated restore → rollback rehearsal test exact to the ms; native crash-restart, `kill -9` and second-process checks at `95bbb53`; 46 review-state renders at `~/Developer/second-brain/outputs/2026/2026-09-23-nimble-focus-review-states.html`. F-IDs: 4 automated, 5 native, 10 pending-human, 7 manual-live.
- [ ] **Next (controller): final whole-branch code/spec review** of `codex/focus-absorption`, fold in the run doc's "Worth fixing before daily use" list.
- [ ] **Marco: human checklist H1–H9 (~30 min)** in the verification record (visual/popovers vs legacy app, drag, two-window race, delete/Undo during B, offline batch add, mute + Pomodoro chimes, clipboard, `pmset sleepnow`, Spaces).
- [ ] Known intermittent (pre-existing, not focus): `backup_git::tests::backup_git_process_timeout_missing_tool_and_bounded_sanitized_output` fails under load (timeout beats output limit).
- [ ] Live gates, in order, each separately approved — none started: source/build vs installed parity; check pre-existing children of local-only tasks for queued Todoist creates; install; Marco's final paused Focus Queue snapshot → reviewed import; decisions on real pending close/comment operations; optional enabling of the time-comment bridge; signed-in web read check; ~14 days daily use; real rollback rehearsal; separate app-retirement decision. Todoist C1–C5 and Instinct ownership unchanged. No merge, push, deployment or installation.
- [ ] **Restored-profile runbook:** a profile restored from backup stays inert (no Todoist/Turso sync, backups or reminders; focus read-only) until it is explicitly activated on the Mac that will own it — Settings → Backups → “Activate restored profile”, or `dt backup activate` with the app running. Activate only after the original Mac has stopped using that data. Activation is idempotent, starts nothing, keeps paused focus totals and quarantined deliveries for review, and is refused while another Nimble process or device owns the profile.
- [ ] **Branch complete, merge decision pending (2026-09-23).** Tasks 1–12 reviewed; final whole-branch review fixed (C1 recurring double-advance, I2 replica heartbeat growth, I3 transactional migrations, I4 restore activation, import duplicate count, Undo labels) — `e8cf35d..570ac7c`, 488 Rust / 280 frontend. Human checklist H1–H9 in `docs/focus-queue-verification.md` still to run.
- [ ] Known gaps before daily use/install: (1) after restore activation the web focus view stays on the old owner's replica (Turso upsert filters old epoch) — fix before relying on web focus after a restore; (2) restore activation has no separate confirmation step; (3) Todoist-recurring tasks with no local `recurrence_rule` close outright on completion — check real data (EDD) before install; (4) a stale recurring Focus card (task completed elsewhere) must be removed and re-added; (5) no other desktop may still run v20 against Turso.
- [ ] Before future migration, verify source/installed parity, pause/quit Focus Queue for final snapshot, preview/deduplicate all saved state and reconcile pending close/comment intents. Roughly two weeks of accepted daily use precedes a separate reversible app-retirement decision; Todoist C1–C5 and Instinct ownership remain unchanged.

## Design facelift — 2026-09-22 (loop 1, PAUSED before Stage C)

Plan `docs/audit-findings/2026-09-22-loop1-plan.md` · audit brief `docs/audit-findings/2026-09-22-audit-brief.md` · baseline scorecard `docs/audit-findings/2026-09-22-scorecard.md` (grid 2.41/5, 45 P1 · 87 P2 · 42 P3) · before/after page `~/Developer/second-brain/outputs/2026/2026-09-22-nimble-facelift-before-after.html`.

- [x] Loop 1 audit: 8 surface agents + cross-cutting agent → `docs/audit-findings/<surface>/2026-09-22-loop1.md`. Mock harness `tools/mock-tauri.js` now covers all 143 commands.
- [x] Gate approved by Marco: all three stages; past-due dates go neutral.
- [x] Stage A merged (`1c2caa7`): focus ring 1.44→4.2:1 light / 6.1:1 dark, global `:focus-visible`, `prefers-reduced-motion`, semantic color roles, `lib/shortcuts.ts` registry, `?` help, `g`-prefix nav, typography doc = live 8-token scale.
- [x] Stage B merged, all six themes reviewed by fresh Opus reviewers and merged into main at `cc0263a` (97/97 frontend tests, desktop + web builds green): B2 no-guilt copy, B1 color semantics (palette literals 86→1 comment), B5 settings IA (5,559→4,663px, scroll-spy nav), B4 shell (no nested buttons, `--hover` token, hit areas), B3a Tasks/Inbox keyboard rows, B3b Docs/Goals/Session keyboard + states.
- [ ] **Next: Marco says go on Stage C** (one PageFrame/SectionTitle/EmptyState on six pages — not Tasks/detail — plus motion tokens for ~45 literal durations, `Dashboard.tsx` scroller `flex-col` so sticky headers stick). Or re-score first.
- [ ] Re-score step (loop N.5) not run: after-columns in the scorecard are empty; take a combined screenshot set of main.
- [x] Pushed 2026-09-22 (`5f290d0`, facelift A+B included; Vercel is not Git-linked, so no deploy). Still not installed to /Applications.
- [ ] Prune worktrees when done: `.worktrees/facelift-{a,b1-color,b2-no-guilt,b3a-rows-tasks-inbox,b3b-docs-goals-session,b4-shell,b5-settings-ia}` (all merged).
- [ ] Update `docs/audit-loop-playbook.md` with this run's lessons at final wrap (tabs not windows; pin subagent model; integrator agent per rebase; key-guard lesson).

Queued for Marco (Rust or decisions):
- Rust: drop `ical_feed_url` from `REQUIRED_SETTINGS` (`nimble-core/src/db/settings.rs`) so setup can be skippable — frontend gate kept until then.
- Rust: `set_review_complete` escape hatch; `dueOnOrBefore` filter for a Today "Still open" group; energy-history query for the sparkline; soft-delete/restore for task/label/route/doc undo; habit `log()` intensity.
- Decide: New Goal dialog preselects a color so every goal gets one — default to none?
- Decide: amend `ux-intent.md` §2.7 to describe the Cmd+K palette (not a docked bar); two-step review (no triage step) is intended?
- Figma: task-detail edit models, PageFrame on Tasks/detail, row inline editing for priority/due/labels/project, settings sub-pages, bingo card/compass. `chrono-node` for NL dates needs dependency approval.
- Deferred minors (loop 2): row focus drops to page after a status pick moves groups; due/label popovers lack finalFocus; Up-next toast Start doesn't guard an active session; low-contrast informational marks; Todoist dot + Urgent reuse `--destructive`; 17 off-grid spacing sites in settings children; mock doesn't persist habit/capture mutations.

## Session wrap — 2026-09-21

- Context refresh saved locally: outer AGENTS.md/CLAUDE.md, repository CLAUDE.md, verification records, agent-access guide, locked-decisions status, implementation plans and historical-roadmap pointers. The 11 shared documents match between main and the OAuth repair worktree; the repair plan is updated in that worktree only.
- [x] Marco authorized commit/push. Context refresh committed (`600d3b3`, `c56f57a`), OAuth repair merged into main (`b3211dd`) and pushed to GitHub on 2026-09-21. Remote main and repair branch verified after push. Main's merge tree exactly matches the freshly tested repair tree: 330 Rust tests, eight frontend tests, desktop/web builds passed.
- Outer AGENTS.md/CLAUDE.md snapshots are versioned under `docs/context/`; the active outer files remain outside Git. Installed runtime remains `af39e29`; source is now integrated into main. Worktrees are retained for continuity.
- Vercel production rechecked Ready: `dpl_9aNWreqb49Ho9KocRGypNDu8BLnE`, deployed from `49254e9`. Main's later `3e4a061` contains documentation only; repair remains desktop-local. No deployment performed during wrap.
- Todoist pointer lookup failed twice with HTTP401. Could not verify/update the single Nimble open-loops pointer; after reconnect, search before creating and prepend the dated status while preserving description/labels. This local file is the fallback handoff. No live task changes made.
- Separate security follow-up: an unrelated Figma credential appeared in a process diagnostic earlier in this session; Marco was informed. Rotation/revocation remains unverified. Never reproduce the credential or repeat broad process-command diagnostics.

## Start here

- [x] **Google Calendar connected and first live sync verified (2026-09-21).** Marco completed secret setup/consent. Installed Nimble reports Connected to Nimble and secret saved in Keychain. Sync now succeeded; read-only SQLite confirms a dedicated calendar, America/Los_Angeles timezone, initialized sync cursor, last sync 2026-09-22T05:31:58Z, no error/retry state. No tasks are published yet. Next acceptance: publish one chosen test reminder and confirm the physical phone notification, then verify two-way edits. Repair source was subsequently merged and pushed in `b3211dd`; see wrap record above.
- [x] Install approved Google repair, preserving all 1,125 tasks, 63 projects, 25 labels and 150 captures with full-row hashes and schema20 integrity verified after relaunch. Rollback app/data: `~/Library/Application Support/Nimble Rollbacks/20260921-222607-google-oauth`. CLI unchanged.
- Google setup preserved: project **Nimble** (`nimble-509404`); approved terms accepted; Calendar API enabled; External/testing with Marco as sole test user; only `calendar.app.created` declared; approved Desktop client **Nimble Mac** created and public ID saved in Nimble. The initial token exchange failed; the installed repair resolved it, and connection/calendar creation plus first sync are verified. No billing enabled. Reuse this project/client; testing-mode token lifetime and physical-phone acceptance remain open.
- [x] Fix Google setup and reminder timezone Save buttons with explicit submit types; all three actual-render regression tests pass.

- [x] Live Mac banner test passed (2026-09-21): Marco confirmed "ok reminder showed up." Native submission for temporary task `76f54a61-2149-46d5-9c15-70b8c007fba8` succeeded at 21:43:41 PDT. A retry was scheduled for 21:46; after Marco's confirmation, the task was completed with app refresh acknowledged. Google publishing stayed off.

- [x] Push merged main (`49254e9`) to GitHub and deploy web production on 2026-09-21. Vercel deployment `dpl_9aNWreqb49Ho9KocRGypNDu8BLnE` is Ready at https://nimble-web-marco-sevilla-projects.vercel.app. Login form and anonymous API protection verified; signed-in web acceptance remains open because production password exports were empty and the browser was logged out. See [deployment verification](docs/c2-c3-verification.md#production-web-deployment--2026-09-21).

- [x] Merge C2/C3 into `main`: only `NEXT.md` conflicted; preserved the complete implementation and installation record. This merge established the C2/C3 baseline; the installed app now additionally includes the OAuth repair below. Merged verification: 320 Rust tests, five interface tests, desktop and web builds passed. Naming: **Nimble Agent Tools** (`dt`); workflow activation remains below.

- [x] Installed signed C2/C3 update into `/Applications/Nimble.app` and `dt` into `~/.local/bin/dt` on 2026-09-21. App reopened, schema20 integrity passed, and all preexisting task/project/label/section/capture fields are unchanged. New local and private online backup succeeded; isolated restore verification passed. Rollback: `~/Library/Application Support/Nimble Rollbacks/20260921-210436-c23`. Google was disconnected at this installation checkpoint and is now connected after the repair; workflow routing remains unactivated. The C2/C3 baseline is integrated into `main`.

- C2/C3 implementation from `codex/c2-c3-reminders-agents` is integrated into `main`; native synthetic CLI refresh, reminder submission, restart catch-up and backup/restore checks passed. All 320 Rust tests, desktop/web builds and final review passed. Production app is updated; Google connection and initial sync subsequently passed with the OAuth repair (330 Rust tests and eight frontend tests). See [combined verification](docs/c2-c3-verification.md).

- [x] Review the [coordinated C2/C3 implementation plan](docs/superpowers/plans/2026-09-21-c2-c3-coordination.md): reminders and local assistant access will develop concurrently with separate subagents and one owner for shared database, backup, and app integration. Plan approved and implementation built 2026-09-21 in `codex/c2-c3-reminders-agents`; remaining live activation is listed below.

- [x] Install signed release from `codex/c1-backup-restore` (`e196d1c`) into `/Applications/Nimble.app`; reopened successfully, existing task/project counts preserved, first local backup succeeded.
- [x] Fast-forward the tested feature branch into main; reran the full Rust suite: 279 passed.
- [x] Build and open standalone Nimble Backup Test; native Back up now, Verify latest backup, and Open backup folder all passed using an isolated empty test profile.
- [x] Implement C1 tasks 1–7: local snapshots, portable export, isolated recovery, conservative pruning, private Git publication, scheduling, and Settings controls.
- [x] Verify 279 Rust tests, desktop/web builds, targeted frontend lint, snapshot recovery and export recovery after local Git retrieval. Independent integration review approved with no remaining blockers. See [verification record](docs/c1-verification.md).
- [x] Create and connect private `marcosevilla/nimble-backups`; first upload acknowledged at 2026-09-21 19:47 PDT, commit `f696a7884a0c922738f9fbc786ecc3c29d7974b3`.
- Approved [spec](docs/superpowers/specs/2026-09-21-c1-backup-restore-design.md) and [plan](docs/superpowers/plans/2026-09-21-c1-backup-restore.md). Work is isolated in `codex/c1-backup-restore`, based on `2b0421a`.
- Canonical decisions: [Todoist replacement](docs/todoist-replacement-decisions.md), dated 2026-08-25. Its C1–C5 order supersedes the older R1–R5 plan.

## Next execution order

**C2 phone test — deferred mid-run by Marco, 2026-09-22.** Task `Phone test` (`8e8e2785-a6d6-4a32-b387-9a68723c546e`, due 14:45, 1-min reminder) is still open and linked; reuse it for the retest. Results so far:
- Event reached the Nimble Google calendar ✅, but only after a manual Settings → Phone alerts → Sync now. Read-only DB shows the 60s background tick flips: 21:36:17Z `google_full_resync_needed` (410 on incremental list, token cleared), 21:37:18Z full sync OK. Suspect it alternates on every other tick. Not yet confirmed, no fix written. Investigate `run_once` 410 path (`nimble-core/src/integrations/google_calendar.rs:109`) and propose a fix before editing.
- Phone did not ding ❌. Google event had the correct `popup` 1-min override and was still at 14:45 at alert time, so it's most likely phone notification settings (which app: Google Calendar vs Apple Calendar + syncselect is unknown). Event was moved to 14:50 at 21:45:20Z while Nimble was quit; unclear who moved it (Marco?). The next sync will pull that change into the task.
- Retest: ask which calendar app → check its notification settings → task 10 min out, 5-min reminder → Sync now → quit Nimble → wait. Then do two-way edits (phone rename → Mac; Mac time change → phone; complete → event removed).

1. Finish C2 live acceptance: publish one disposable timed task, confirm the physical phone alert, and verify edits in both directions. Check restart/reconnect behavior and testing-mode token longevity; keep real deadline reminders on the existing fallback until acceptance passes.
2. Finish C3 activation: review/approve assistant routing, test a parent task with three subtasks, labels and due date in the app, and confirm signed-in web propagation. Preserve Instinct ownership and avoid duplicate fallback writes.
3. Build C4: grouped labels (ENERGY / TIME / TYPE / CREATIVE) and indexed task-title/description search, including completed tasks.
4. Proceed to C5 import and a 2–4 week trial only after the remaining acceptance gates pass; keep Todoist operational meanwhile.

## Code track — agreed order

- [x] **C1: Safety net activation.** Implemented, tested, installed, merged into main, and first private online backup acknowledged.
- [ ] **C2: Reminders activation.** Code implemented: desktop reminders, persistent catch-up, dedicated-calendar OAuth and two-way reconciliation, schema20 label-group storage. Tests/review pass. Installed and verified; Marco confirmed the live Mac reminder banner on 2026-09-21. Google setup/consent and first sync now verified; remaining: physical-phone alert/two-way test.
- [ ] **C3: Agent access activation.** CLI, JSON commands, private app socket and workflow proposals implemented; native open-task refresh verified. `dt` is installed on PATH and backup RPC is verified. Remaining: approve/activate actual assistant routing, and verify live web propagation. Todoist remains the fallback, without duplicate writes after uncertain results.
- [ ] **C4: Labels and search.** Restore ENERGY / TIME / TYPE / CREATIVE grouping; indexed task-title and description search including completed tasks.
- [ ] **C5: Import and cutover.** Preserve first-class task fields; import active tasks plus the last 12 months completed; archive full history; use Nimble for 2–4 weeks before deciding on cutover. Downgrade Todoist to free only when ready.

## Design track — Marco in Figma

- [ ] Task detail with inline field editors first.
- [ ] Grouped label picker and row metadata.
- [ ] Recurrence controls and project section lanes.
- [ ] Reminder affordance and search results.

## Verification still open

- [ ] Live recurrence exit test: verify the intended biweekly recurrence twice in a row. Unit-test coverage is not this exit test.
- [x] Isolated backup/restore exit test: both routes verified, including canonical export equality; no live activation.
- [x] Implementation checks: `cargo test --workspace --offline`, desktop `npm run build`, web `npm run build:web`, and targeted lint passed. Rerun appropriate checks if integration changes the code.
- [x] Refresh CLAUDE.md test/provider guidance and point current state here. `docs/buildplan.md` remains a historical March snapshot.
- [ ] Review older R1 soak follow-ups and reliability deferrals before cutover; the locked-decisions doc is the starting point, not proof those checks passed.

## Deferred / boundaries

- Durable conflict journal is explicitly deferred from C1; production restore activation and remote reconciliation remain required before the broader Todoist cutover. Private online backups are configured at `marcosevilla/nimble-backups`.

- Native Expo app remains dormant; the web client is the phone path.
- [Focus Queue absorption](docs/superpowers/specs/2026-09-22-focus-queue-absorption-design.md) has written-spec approval and implementation authorization (see above). It remains separate from the Todoist-cutover critical path. Count-up/timeboxes and optional Pomodoro share one ledger; the August integration plan is historical.
- Keep Todoist operational until the safety, reminder, agent-access, and trial-period gates pass.

## What is here

- `apps/desktop/`: React/TypeScript frontend, Tauri desktop shell, and shared web frontend.
- `nimble-core/`: Rust business logic, SQLite, integrations, and Turso sync.
- `packages/types/`: shared TypeScript models and DataProvider contract.
- `apps/mobile/`: preserved dormant Expo app.
- `docs/`: decisions, specs, plans, design research, and historical audits; `tools/`: development and app-update helpers.
