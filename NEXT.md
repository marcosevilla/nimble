# Nimble — Open loops

Updated 2026-09-21 from the current checkout and committed planning documents.

## Start here

- [ ] Execute Task 1 of the [C1 implementation plan](docs/superpowers/plans/2026-09-21-c1-backup-restore.md): deterministic portable export and explicit schema/credential-exclusion tests. Implementation has not started.
- [x] Marco approved the [C1 backup/restore spec](docs/superpowers/specs/2026-09-21-c1-backup-restore-design.md), including catch-up scheduling, isolated recovery, conservative pruning, and conflict-journal deferral.
- [x] Write the eight-task C1 implementation plan with interfaces, tests, recovery drills and activation boundaries.
- [x] Draft the C1 safety-net spec against current database, settings, sync, and desktop lifecycle code. No application implementation or live-data changes.
- Canonical decisions: [Todoist replacement](docs/todoist-replacement-decisions.md), dated 2026-08-25. Its C1–C5 order supersedes the older R1–R5 plan.
- Latest existing commit at this review: `2b0421a` (locked decisions). Working tree was clean on `main`, matching the locally cached `origin/main`; no remote fetch, build, live app, or production verification was performed.

## Code track — agreed order

- [ ] **C1: Safety net.** SQLite snapshots, deterministic JSON export, nightly private-repo backup, sync-log pruning, Settings visibility. Exit: restore a snapshot and compare its export with the original using a safe test copy.
- [ ] **C2: Reminders.** Persistent desktop reminders, catch-up after sleep, Google Calendar OAuth for phone alerts; schema v20 also introduces label groups.
- [ ] **C3: Agent access.** Local `dt` CLI over `nimble-core` CRUD, JSON output, instant running-app refresh, then adapt agent workflows with Todoist as fallback during the trial period.
- [ ] **C4: Labels and search.** Restore ENERGY / TIME / TYPE / CREATIVE grouping; indexed task-title and description search including completed tasks.
- [ ] **C5: Import and cutover.** Preserve first-class task fields; import active tasks plus the last 12 months completed; archive full history; use Nimble for 2–4 weeks before deciding on cutover. Downgrade Todoist to free only when ready.

## Design track — Marco in Figma

- [ ] Task detail with inline field editors first.
- [ ] Grouped label picker and row metadata.
- [ ] Recurrence controls and project section lanes.
- [ ] Reminder affordance and search results.

## Verification still open

- [ ] Live recurrence exit test: verify the intended biweekly recurrence twice in a row. Unit-test coverage is not this exit test.
- [ ] Backup/restore exit test after C1 exists.
- [ ] Before merging implementation, run `cargo test --workspace` and the desktop `npm run build` (uses `tsc -b`); include the web build for shared UI/provider changes.
- [ ] Refresh stale guidance: `CLAUDE.md` still says no tests, has an April Current State section, and describes the web provider as a rejecting skeleton. The August decisions report about 225 Rust tests and a working web client. `docs/buildplan.md` is a March snapshot.
- [ ] Review older R1 soak follow-ups and reliability deferrals before cutover; the locked-decisions doc is the starting point, not proof those checks passed.

## Deferred / boundaries

- Durable conflict journal is explicitly deferred from C1; production restore activation and remote reconciliation remain required before the broader Todoist cutover. A real private backup repository has not yet been selected or configured.

- Native Expo app remains dormant; the web client is the phone path.
- [Focus Queue integration](docs/focus-queue-integration-plan.md) is planned separately and is outside the Todoist-cutover critical path. Pomodoro rounds versus timeboxes remains undecided.
- Keep Todoist operational until the safety, reminder, agent-access, and trial-period gates pass.

## What is here

- `apps/desktop/`: React/TypeScript frontend, Tauri desktop shell, and shared web frontend.
- `nimble-core/`: Rust business logic, SQLite, integrations, and Turso sync.
- `packages/types/`: shared TypeScript models and DataProvider contract.
- `apps/mobile/`: preserved dormant Expo app.
- `docs/`: decisions, specs, plans, design research, and historical audits; `tools/`: development and app-update helpers.
