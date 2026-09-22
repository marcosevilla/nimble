# C1 verification — 2026-09-21

Implementation lives on `codex/c1-backup-restore`, based on `2b0421a`. Tasks 1–7 are implemented. Task 8 automated checks and native Settings button smoke passed. No installed production app update, production database access, real archive configuration, or production upload was performed.

## Evidence

- `cargo test --workspace --offline`: **279 passed, 0 failed**. Run outside the sandbox because the existing macOS Obsidian watcher test requires filesystem events; that test also passed independently outside the sandbox. Log: `/private/tmp/nimble-c1-workspace-test.log` (temporary).
- Desktop `npm run build` and web `npm run build:web`: passed, with existing chunk-size warnings. Targeted ESLint passed for BackupSection and both providers.
- Coverage includes explicit schema/export policy, credential exclusion, snapshot integrity and atomic publication, retention, isolated recovery/FTS, guarded pruning, Git retry/privacy/transport behavior, persisted scheduling and synthetic-profile isolation. Review fixes have regression coverage for linked database rejection, upload-error persistence across the next local backup, and replaced locks preventing pruning.
- Native debug app started with the marked synthetic profile `/private/tmp/nimble-backup-test-o_n721gu` and produced generation `a6bdc913-1ecb-4c32-bfbb-df336cd124a2`. No production profile was selected.
- Recovered that snapshot into a new scratch directory: `verified=true` (integrity, full table comparison and canonical export equality).
- Copied only its portable export into a disposable local Git repository, committed, pushed to a local bare remote, cloned independently and recovered the retrieved export: `verified=true`. Drill root: `/private/tmp/nimble-git-recovery-fz8c6ynq`. This proves retrieval/recovery without a network upload; private GitHub identity and publication paths are covered separately by synthetic Git tests.
- Browser mock Settings checks: Back up now updates local time; Verify latest backup displays isolated-verification feedback; unavailable sync counters display Unavailable instead of zero. This is frontend mock evidence, not native IPC evidence. Temporary browser harness was removed.
- Independent integration review approved the full branch and review fixes with no remaining blockers. Git and recovery boundary fixes also received scoped re-review.

## Remaining acceptance and activation

1. Native Settings smoke completed in the standalone debug bundle. Back up now changed the timestamp to 7:26:19 PM; Verify latest backup displayed successful isolated recovery; Open backup folder opened Finder at the exact synthetic backups path. The earlier unbundled-window attachment limitation is resolved.
2. Integrate/release the branch, then select an existing private GitHub repository and verify the first acknowledged real upload. No repository is created or chosen automatically.
3. Production restore/reconnection remains a separate reviewed procedure. Keep Todoist operational until the broader cutover gates pass.

## Implementation notes

- Generation directories use UUID names rather than the plan's proposed timestamp-plus-UUID; the validated manifest provides timestamps and retention buckets.
- Private storage uses an added direct `libc` dependency for atomic no-replace publication and process-group cleanup. No frontend test runner or production service was added.
- Failed partial generation directories are excluded from valid listings and retention; automatic scratch cleanup is deferred. They may require later manual inspection.
- A local snapshot success and remote upload acknowledgement are separate states. Failed configured uploads defer cleanup; missing remote configuration permits local-only operation.
- Nightly scheduling requires the app to be running; launch catch-up handles missed runs. No background LaunchAgent was installed.

See [recovery runbook](backup-recovery.md) for the offline commands and activation boundaries, and [NEXT.md](../NEXT.md) for open work.

## Standalone test app follow-up

Built with `tauri build --debug --bundles app` plus a temporary configuration override. Bundle: `target/debug/bundle/macos/Nimble Backup Test.app`; distinct identifier `com.marcosevilla.nimble-backup-test`. Build and code-signature verification passed. Its Info.plist pins `NIMBLE_BACKUP_TEST_ROOT` to `/private/tmp/nimble-backup-test-owylwbx_`, a marked empty synthetic profile. All three native backup controls were exercised successfully. No production installation or upload occurred. The app remains open for Marco to inspect.

## Authorized production update — 2026-09-21

Marco requested “update my app.” Built the release from `e196d1c` with the existing `Marco Task App Dev` signing identity; signing required an unsandboxed retry. Signature verification passed. Quit Nimble, preserved its app-data directory, old app bundle and WebKit cache in the private rollback folder `~/Library/Application Support/Nimble Rollbacks/20260921-194254-c1`, installed the verified bundle in `/Applications/Nimble.app`, and reopened it. The installed executable hash matches the release artifact. Existing local task/project counts match the saved pre-update copy. Persisted local backup success: `2026-09-22T02:42:59.935462+00:00`. No private remote was configured or uploaded.

An initial pre-swap verification used the wrong `tasks` table name and stopped safely; it left an additional app-data copy at `20260921-194229-c1`. The corrected check uses `local_tasks` and `projects`. Both rollback directories are retained. Git branch integration remains separate and unperformed.

## Main merge and online activation — 2026-09-21

Marco authorized both follow-ups. Preserved the original untracked planning copies outside the repository, fast-forwarded main to the tested feature branch, fetched origin/main to verify ancestry, and reran the full Rust workspace suite on main: 279 passed, zero failures.

Created `marcosevilla/nimble-backups` explicitly private and connected it through the installed app's Settings. Invoked Back up now. The app recorded acknowledged upload `f696a7884a0c922738f9fbc786ecc3c29d7974b3` at `2026-09-22T02:47:41.204809+00:00`, with no stage error. GitHub privacy was independently confirmed as PRIVATE. Credentials and full snapshots remain outside the archive. Live restoration/reconnection is still a separate procedure.
