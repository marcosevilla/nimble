# Nimble — Open loops

Updated 2026-09-22 (Focus Queue architecture approved; written spec awaiting review; design facelift loop 1, Stage B merged). Earlier: 2026-09-21 installed Google OAuth repair and verified first live sync. Current status below supersedes earlier installation snapshots.

## Focus Queue absorption — 2026-09-22 (written review gate)

- [x] Marco approved the architecture: native tasks, deliberately ordered durable queue, one authoritative durable timer/session engine across main and companion windows, full shipped Focus Queue capability coverage, optional Nimble Pomodoro, previewed import and reversible daily trial. Follow-up: preserve Focus Queue layout, interaction and information hierarchy as much as practical within Nimble's current design system.
- [x] Draft and self-review the [replacement architecture spec](docs/superpowers/specs/2026-09-22-focus-queue-absorption-design.md). The August integration plan is historical; it incorrectly assumes existing session persistence and conflates scheduling duration with focus budgets.
- [ ] **Next: Marco reviews the written spec**, particularly the proposed shared-queue/source-view behavior, pause-on-sleep recovery, desktop-only live ownership/web read-only support, temporary opt-in Todoist time-comment bridge, and listed UI/interaction deviations. These defaults were not previously approved.
- [ ] After written-spec approval, prepare a separate bounded implementation plan for review and execution selection. No product implementation, install, live import/replay, external writes or app retirement performed in this documentation stage.
- [ ] Before future migration, verify source/installed parity, pause/quit Focus Queue for final snapshot, preview/deduplicate all saved state and reconcile pending close/comment intents. Roughly two weeks of accepted daily use precedes a separate reversible app-retirement decision; Todoist C1–C5 and Instinct ownership remain unchanged.

## Design facelift — 2026-09-22 (loop 1, PAUSED before Stage C)

Plan `docs/audit-findings/2026-09-22-loop1-plan.md` · audit brief `docs/audit-findings/2026-09-22-audit-brief.md` · baseline scorecard `docs/audit-findings/2026-09-22-scorecard.md` (grid 2.41/5, 45 P1 · 87 P2 · 42 P3) · before/after page `~/Developer/second-brain/outputs/2026/2026-09-22-nimble-facelift-before-after.html`.

- [x] Loop 1 audit: 8 surface agents + cross-cutting agent → `docs/audit-findings/<surface>/2026-09-22-loop1.md`. Mock harness `tools/mock-tauri.js` now covers all 143 commands.
- [x] Gate approved by Marco: all three stages; past-due dates go neutral.
- [x] Stage A merged (`1c2caa7`): focus ring 1.44→4.2:1 light / 6.1:1 dark, global `:focus-visible`, `prefers-reduced-motion`, semantic color roles, `lib/shortcuts.ts` registry, `?` help, `g`-prefix nav, typography doc = live 8-token scale.
- [x] Stage B merged, all six themes reviewed by fresh Opus reviewers and merged into main at `cc0263a` (97/97 frontend tests, desktop + web builds green): B2 no-guilt copy, B1 color semantics (palette literals 86→1 comment), B5 settings IA (5,559→4,663px, scroll-spy nav), B4 shell (no nested buttons, `--hover` token, hit areas), B3a Tasks/Inbox keyboard rows, B3b Docs/Goals/Session keyboard + states.
- [ ] **Next: Marco says go on Stage C** (one PageFrame/SectionTitle/EmptyState on six pages — not Tasks/detail — plus motion tokens for ~45 literal durations, `Dashboard.tsx` scroller `flex-col` so sticky headers stick). Or re-score first.
- [ ] Re-score step (loop N.5) not run: after-columns in the scorecard are empty; take a combined screenshot set of main.
- [ ] Not pushed: main is 64 commits ahead of origin. Not installed to /Applications.
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
- [Focus Queue absorption](docs/superpowers/specs/2026-09-22-focus-queue-absorption-design.md) has architecture approval and awaits written-spec review (see above). It remains separate from the Todoist-cutover critical path. Count-up/timeboxes and optional Pomodoro share one ledger; the August integration plan is historical.
- Keep Todoist operational until the safety, reminder, agent-access, and trial-period gates pass.

## What is here

- `apps/desktop/`: React/TypeScript frontend, Tauri desktop shell, and shared web frontend.
- `nimble-core/`: Rust business logic, SQLite, integrations, and Turso sync.
- `packages/types/`: shared TypeScript models and DataProvider contract.
- `apps/mobile/`: preserved dormant Expo app.
- `docs/`: decisions, specs, plans, design research, and historical audits; `tools/`: development and app-update helpers.
