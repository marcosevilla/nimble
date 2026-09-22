# Nimble — Open loops

Updated 2026-09-21 from the current checkout and committed planning documents.

## Start here

- [ ] **Finish Google connection in the updated app.** Approved repair `af39e29` (`codex/google-desktop-oauth-fix`) is built, signed and installed in `/Applications/Nimble.app` (2026-09-21). All 330 Rust tests, eight interface tests, desktop/web builds, targeted lint and independent review passed. Native Settings shows the new masked secret field; public client ID remains saved. Next: Marco enters the existing Desktop OAuth client's secret into Settings > Phone alerts > Google connection setup, saves, and reconnects Google. Do not claim live connection until Nimble reports Connected and dedicated calendar exists. Branch remains local, not merged/pushed.
- [x] Install approved Google repair, preserving all 1,125 tasks, 63 projects, 25 labels and 150 captures with full-row hashes and schema20 integrity verified after relaunch. Rollback app/data: `~/Library/Application Support/Nimble Rollbacks/20260921-222607-google-oauth`. CLI unchanged.
- Google setup preserved: project **Nimble** (`nimble-509404`); approved terms accepted; Calendar API enabled; External/testing with Marco as sole test user; only `calendar.app.created` declared; approved Desktop client **Nimble Mac** created and public ID saved in Nimble. User consent occurred, but token exchange/calendar creation failed. No billing enabled. Reuse this project/client; testing-mode token lifetime and physical-phone acceptance remain open.
- [x] Fix Google setup and reminder timezone Save buttons with explicit submit types; all three actual-render regression tests pass.

- [x] Live Mac banner test passed (2026-09-21): Marco confirmed "ok reminder showed up." Native submission for temporary task `76f54a61-2149-46d5-9c15-70b8c007fba8` succeeded at 21:43:41 PDT. A retry was scheduled for 21:46; after Marco's confirmation, the task was completed with app refresh acknowledged. Google publishing stayed off.

- [x] Push merged main (`49254e9`) to GitHub and deploy web production on 2026-09-21. Vercel deployment `dpl_9aNWreqb49Ho9KocRGypNDu8BLnE` is Ready at https://nimble-web-marco-sevilla-projects.vercel.app. Login form and anonymous API protection verified; signed-in web acceptance remains open because production password exports were empty and the browser was logged out. See [deployment verification](docs/c2-c3-verification.md#production-web-deployment--2026-09-21).

- [x] Merge C2/C3 into `main`: only `NEXT.md` conflicted; preserved the complete implementation and installation record. Runtime source matches the installed, reviewed feature branch. Merged verification: 320 Rust tests, five interface tests, desktop and web builds passed. Naming: **Nimble Agent Tools** (`dt`); workflow activation remains below.

- [x] Installed signed C2/C3 update into `/Applications/Nimble.app` and `dt` into `~/.local/bin/dt` on 2026-09-21. App reopened, schema20 integrity passed, and all preexisting task/project/label/section/capture fields are unchanged. New local and private online backup succeeded; isolated restore verification passed. Rollback: `~/Library/Application Support/Nimble Rollbacks/20260921-210436-c23`. Google connection and workflow routing remain unactivated; the reviewed code is now integrated into `main`.

- C2/C3 implementation from `codex/c2-c3-reminders-agents` is integrated into `main`; native synthetic CLI refresh, reminder submission, restart catch-up and backup/restore checks passed. All 320 Rust tests, desktop/web builds and final review passed. Production app is updated; real Google connection remains unconfigured. See [combined verification](docs/c2-c3-verification.md).

- [x] Review the [coordinated C2/C3 implementation plan](docs/superpowers/plans/2026-09-21-c2-c3-coordination.md): reminders and local assistant access will develop concurrently with separate subagents and one owner for shared database, backup, and app integration. Plan approved and implementation built 2026-09-21 in `codex/c2-c3-reminders-agents`; remaining live activation is listed below.

- [x] Install signed release from `codex/c1-backup-restore` (`e196d1c`) into `/Applications/Nimble.app`; reopened successfully, existing task/project counts preserved, first local backup succeeded.
- [x] Fast-forward the tested feature branch into main; reran the full Rust suite: 279 passed.
- [x] Build and open standalone Nimble Backup Test; native Back up now, Verify latest backup, and Open backup folder all passed using an isolated empty test profile.
- [x] Implement C1 tasks 1–7: local snapshots, portable export, isolated recovery, conservative pruning, private Git publication, scheduling, and Settings controls.
- [x] Verify 279 Rust tests, desktop/web builds, targeted frontend lint, snapshot recovery and export recovery after local Git retrieval. Independent integration review approved with no remaining blockers. See [verification record](docs/c1-verification.md).
- [x] Create and connect private `marcosevilla/nimble-backups`; first upload acknowledged at 2026-09-21 19:47 PDT, commit `f696a7884a0c922738f9fbc786ecc3c29d7974b3`.
- Approved [spec](docs/superpowers/specs/2026-09-21-c1-backup-restore-design.md) and [plan](docs/superpowers/plans/2026-09-21-c1-backup-restore.md). Work is isolated in `codex/c1-backup-restore`, based on `2b0421a`.
- Canonical decisions: [Todoist replacement](docs/todoist-replacement-decisions.md), dated 2026-08-25. Its C1–C5 order supersedes the older R1–R5 plan.

## Code track — agreed order

- [x] **C1: Safety net activation.** Implemented, tested, installed, merged into main, and first private online backup acknowledged.
- [ ] **C2: Reminders activation.** Code implemented: desktop reminders, persistent catch-up, dedicated-calendar OAuth and two-way reconciliation, schema20 label-group storage. Tests/review pass. Installed and verified; Marco confirmed the live Mac reminder banner on 2026-09-21. Remaining: Google client setup/consent and physical-phone alert/two-way test.
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
- [Focus Queue integration](docs/focus-queue-integration-plan.md) is planned separately and is outside the Todoist-cutover critical path. Pomodoro rounds versus timeboxes remains undecided.
- Keep Todoist operational until the safety, reminder, agent-access, and trial-period gates pass.

## What is here

- `apps/desktop/`: React/TypeScript frontend, Tauri desktop shell, and shared web frontend.
- `nimble-core/`: Rust business logic, SQLite, integrations, and Turso sync.
- `packages/types/`: shared TypeScript models and DataProvider contract.
- `apps/mobile/`: preserved dormant Expo app.
- `docs/`: decisions, specs, plans, design research, and historical audits; `tools/`: development and app-update helpers.
