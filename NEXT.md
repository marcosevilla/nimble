# Nimble — Open loops

Updated 2026-09-21 from the current checkout and committed planning documents.

## Start here

- [ ] Integrate `codex/c1-backup-restore` into main and release. The installed production app has not been updated.
- [x] Build and open standalone Nimble Backup Test; native Back up now, Verify latest backup, and Open backup folder all passed using an isolated empty test profile.
- [x] Implement C1 tasks 1–7: local snapshots, portable export, isolated recovery, conservative pruning, private Git publication, scheduling, and Settings controls.
- [x] Verify 279 Rust tests, desktop/web builds, targeted frontend lint, snapshot recovery and export recovery after local Git retrieval. Independent integration review approved with no remaining blockers. See [verification record](docs/c1-verification.md).
- [ ] Select and configure an existing private GitHub archive after release; real offsite activation has not been tested or enabled.
- Approved [spec](docs/superpowers/specs/2026-09-21-c1-backup-restore-design.md) and [plan](docs/superpowers/plans/2026-09-21-c1-backup-restore.md). Work is isolated in `codex/c1-backup-restore`, based on `2b0421a`.
- Canonical decisions: [Todoist replacement](docs/todoist-replacement-decisions.md), dated 2026-08-25. Its C1–C5 order supersedes the older R1–R5 plan.

## Code track — agreed order

- [ ] **C1: Safety net activation.** Implementation and isolated recovery checks passed. Integration/release and real private-repository activation remain.
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
- [x] Isolated backup/restore exit test: both routes verified, including canonical export equality; no live activation.
- [x] Implementation checks: `cargo test --workspace --offline`, desktop `npm run build`, web `npm run build:web`, and targeted lint passed. Rerun appropriate checks if integration changes the code.
- [x] Refresh CLAUDE.md test/provider guidance and point current state here. `docs/buildplan.md` remains a historical March snapshot.
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
