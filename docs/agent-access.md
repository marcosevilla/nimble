# Nimble Agent Tools (`dt`)

Rollout status (2026-09-21): matching `dt` is installed at `~/.local/bin/dt`; native app refresh and backup RPC are verified. Workflow files remain proposals. Assistant routing activation and signed-in web propagation still need acceptance; see [NEXT.md](../NEXT.md). The later OAuth repair updated the app only, leaving this CLI unchanged.

`dt` is a Rust command-line interface to Nimble's existing local data layer. It preserves native task behavior, recurrence, labels, sync-log tracking and the Todoist outbox. It never opens a remote task-write API or creates/migrates a database.

Build from the repository root:

```sh
cargo build -p nimble-cli --release
./target/release/dt --json --help
```

Installation on PATH and workflow activation are separate release steps. The development binary is not automatically installed globally. Default data is the same existing `nimble.db` used by the desktop app. A schema mismatch is a hard error: update the CLI and app together, then open Nimble to migrate. Demo mode is rejected.

## Commands

`--json` is global and works before or after subcommands. Invalid arguments also return a JSON error. Use `<command> --help` for exact flags.

| Domain | Commands |
| --- | --- |
| task | list, get, create, update, complete, reopen, status, delete, labels |
| project | list, create, update, delete |
| section | list, create, rename, delete, reorder |
| label | list, create, update, delete |
| capture | list, create, delete |
| activity | list, summary |
| backup | status, now, verify |
| sync | status, now |
| gap | `gap "reason"`, `gap list --from YYYY-MM-DD --to YYYY-MM-DD` |

Task creation supports project/parent IDs, description, priority (1–4), due date, due time, duration, recurrence, section, labels, reminder offset and explicit Google Calendar publishing intent. Updates support these existing core fields except changing a parent, and add linked-document and explicit clear flags. Dates use `YYYY-MM-DD`, times use `HH:MM`. IDs are exact; ambiguous name matching is not performed. `task labels --ids` replaces the entire set; preserve the old labels when adding one. `task labels --clear` intentionally empties the set.

While Todoist sync is on, a task that repeats in Todoist has a read-only rule: `task update --recurrence`/`--clear-recurrence` on it fails with `validation` (edit the rule in Todoist). Completing a recurring task calls native core completion; it may advance to the next occurrence instead of becoming complete. Task search will arrive with the dedicated C4 search work. Capture conversion is not exposed as a fragile pair of unrelated writes.

## Saved versus refreshed versus synchronized

A successful task command means its local operation finished. It does not guarantee remote delivery. The success response contains:

```json
{"version":1,"ok":true,"data":{"id":"..."},"refresh":"acknowledged","warnings":[]}
```

`refresh` is `acknowledged`, `app_not_running`, `unavailable`, or `not_required`. A committed mutation remains successful when the app is closed or its refresh acknowledgement fails. **Never retry a task creation just because refresh failed.** Read back the returned ID instead.

Exit 0 is success, exit 2 is input validation, exit 1 is an operational error. Errors are sanitized; stdout contains one JSON document. If a process is interrupted or a command times out after starting, inspect the affected records/status before retrying. There is no automatic write retry and no automatic Todoist fallback.

The running app owns `backup now`, `backup verify` and `sync now`. Backup verification restores into a separate scratch directory and does not replace live data. The CLI never configures GitHub, credentials or remote integrations. `sync now` reports independent Todoist and Turso outcomes, including skipped/incomplete work; inspect those states. No configured provider is not an empty successful remote sync. The existing five-minute desktop sync schedule remains responsible for routine propagation while the app is open.

## Local endpoint

The app listens on a Unix socket in a mode-0700 directory under macOS's per-user temporary directory, identified by user ID and a hash of the canonical database path. The socket is mode0600; both sides check same-user peer credentials and profile/protocol identity. Requests are allowlisted, newline-framed, limited to64KiB and time-bounded. Notifications carry IDs and changed domain names rather than task content. Separate profiles have separate endpoints.

The CLI holds a shared advisory schema lock for its database operation; desktop startup takes the exclusive lock during migration. The running app also holds an exclusive profile owner lock (`.nimble-owner.lock` beside the database) for its whole lifetime. Only that process may write focus state or time live. If an app-handled task write finds that the owner lock is held but the local endpoint is unreachable, the write fails with `app_unreachable` and nothing is written. The CLI never writes the database directly behind a running owner. Quit and reopen Nimble, then repeat the command. An endpoint acknowledgement confirms event emission, not completed rendering or network upload. App events refresh task, project, section, label, capture and activity consumers; UI/native acceptance is tracked separately in the combined verification record.

## Isolated tests

`--profile <directory>` is for synthetic test profiles only: the existing database must live below the OS temporary directory, with a regular `synthetic-profile` marker containing exactly `nimble-synthetic-only\n`. It rejects symlinked/hard-linked databases and wrong-owner files. It never creates a missing profile. Automated fixtures create their own empty databases and migrations; the CLI itself does not migrate.

```sh
cargo test -p nimble-cli --offline
cargo test -p nimble-core agent_protocol --offline
cargo test -p app agent_ --offline
```

The socket integration test needs local Unix-socket permission; a sandbox denying `bind` is not an application test failure. No automated test calls live Todoist, Turso or Google. Native visual refresh and actual web propagation are separate acceptance checks and must not be reported as passed solely from CLI unit tests.

## Workflow rollout

The four files under `docs/agent-workflows/` are repository-local proposals, not installed skills. They preserve Todoist during the trial and do not change Instinct's live-write ownership. Activate a workflow only after reviewing it and verifying the installed CLI. Choose a destination before the first write. Following a committed, partial or uncertain Nimble write, read back and reconcile instead of creating another task in Todoist.
