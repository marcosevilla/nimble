# Turso remote schema drift — diagnosis

**Date:** 2026-08-14
**Status:** Investigation only. Nothing was changed, run, or applied. No write of any kind was made to the remote Turso database.
**Scope:** `nimble-core/src/db/migrations.rs`, `nimble-core/src/db/sync.rs`, `apps/mobile/services/{sync,database}.ts`, plus a read-only probe of a *copy* of the local `nimble.db`.

---

## Plain-language summary

The thing we thought was broken has almost certainly already been fixed. The note in project memory ("Turso is missing the `captures.context` column") is dated 2026-08-02, and a commit two days later on 2026-08-04 fixed exactly that — and the local database still carries the receipt: a setting stamped 2026-08-05 saying the repair ran. On paper, the remote database now has every table and column the app needs.

What I *cannot* do without your Turso password is prove the repair actually landed on the server. And there's a real reason to want proof: the repair code reports "success" even when the server rejects one of its commands. So the app might be remembering a repair that silently failed. The safe next step is a five-second read-only peek at the remote to confirm — not another repair.

Two other things turned up that matter more than the original bug. First, when a push to Turso partially fails, the app still marks those changes as "synced" and never retries them — so a handful of captures from early August may exist only on your Mac and not in the cloud backup. Second, the *pull* side of sync downloads everything in one giant request with no size limit, which is fine today because nothing else writes to the database, but would break the moment a phone starts writing real data.

---

## 1. What is the actual drift?

### 1a. The remote's baseline

The remote Turso database was created on **2026-04-05** (`settings.turso_initialized`, updated_at `2026-04-05 06:19:23`). The `initialize_remote` DDL in force at that time is the version from commit `901b70c` (2026-04-04). That is the baseline: whatever `initialize_remote` created then, plus whatever later ALTERs actually landed.

`initialize_remote` runs **once per local database** (guarded by the `turso_initialized` setting) and every statement in it is `CREATE TABLE IF NOT EXISTS`, so it can never widen an existing table. Everything added after 2026-04-05 has to arrive as an out-of-band `ALTER`.

### 1b. Concrete drift vs. local v19, and whether it is covered

Columns/tables that exist in local schema v19 but were **absent from the 2026-04-05 baseline remote**:

| Table | Missing vs. baseline | Introduced by | Synced? | Remote upgrade path | Gate |
|---|---|---|---|---|---|
| `local_tasks` | `external_id`, `external_source` | mig 15 | yes | `upgrade_remote_schema` | v17 |
| `local_tasks` | `remote_updated_at`, `synced_snapshot` | mig 17 | yes | `upgrade_remote_schema` | v17 |
| `local_tasks` | `due_time`, `duration_minutes`, `recurrence_rule`, `section_id` | mig 19 | yes | `upgrade_remote_v19_schema` | v19 |
| `projects` | `external_id`, `external_source` | mig 15 | yes | `upgrade_remote_schema` | v17 |
| `projects` | `remote_updated_at`, `synced_snapshot` | mig 17 | yes | `upgrade_remote_schema` | v17 |
| `projects` | `parent_id` | mig 19 | yes | `upgrade_remote_v19_schema` | v19 |
| `captures` | `context` | mig 16 | yes | `upgrade_remote_schema` | v17 |
| — | `vault_notes`, `vault_links`, `vault_tags` (whole tables) | mig 18 | yes | `create_remote_vault_tables` (`VAULT_TABLE_DDL`) | v18 |
| — | `labels`, `task_labels`, `sections` (whole tables) | mig 19 | yes | `upgrade_remote_v19_schema` (`V19_TABLE_DDL`) | v19 |

**Explicitly NOT needed remotely** (device-local by design, absent from `sanitize_table_name`'s allowlist in `sync.rs:1263` and from the mobile `ALLOWED_TABLES` in `apps/mobile/services/sync.ts:23`):

- `todoist_outbox` (mig 17) — Mac-local outbound queue
- `integration_sync_state` (mig 17) — Mac-local
- `vault_fts` (mig 18, FTS5 virtual table) — device-local index, rebuilt locally
- `schema_version`, `sync_log` metadata aside, plus never-synced caches: `todoist_tasks`, `calendar_events`, `action_log`, `progress_snapshots`, `habit_logs`… (`habit_logs` *is* synced; the others are not — `sync_log` and `settings` exist remotely but are not in the sync allowlist)

Note `settings` exists on the remote (created by `initialize_remote`) but is **not** a synced table — which is why the `turso_schema_v*_upgraded` gates are strictly per-device and never propagate.

### 1c. Verdict: the drift is *narrower* than "just `captures.context`" is worse — it's the opposite

Comparing the live local column lists (read from a copy of `nimble.db`) against "baseline + all three upgrade paths":

- `local_tasks`: 22 local columns = 14 baseline + 4 (v17 path) + 4 (v19 path). **Exact match.**
- `projects`: 12 local columns = 7 baseline + 4 (v17 path) + 1 (v19 path). **Exact match.**
- `captures`: 7 local columns = 6 baseline + 1 (v17 path, `context`). **Exact match.**
- Every other synced table is byte-identical to its baseline DDL, or is created wholesale by `VAULT_TABLE_DDL` / `V19_TABLE_DDL` in a form that matches local exactly.

**There is no v19 drift left uncovered by existing code.** The code in `main` already contains a repair for 100% of the gap, including `captures.context`.

And the local database says all three repairs already ran:

```
turso_initialized          = 1   (2026-04-05 06:19:23)
turso_schema_v17_upgraded  = 1   (2026-08-05 05:34:45)
turso_schema_v18_upgraded  = 1   (2026-08-05 16:08:52)
turso_schema_v19_upgraded  = 1   (2026-08-10 07:26:42)
```

The `captures.context` fix is commit `34b8a94` (2026-08-04, "fix: extend Turso remote schema for sync-metadata columns (C1)"), whose message names `captures.context` directly. The memory note recording the bug is dated 2026-08-02. **The memory note is stale.**

### 1d. The one thing that keeps this from being a closed case

`upgrade_remote_schema` (`sync.rs:505`) and `upgrade_remote_v19_schema` (`sync.rs:636`) **swallow real errors**. They inspect each statement result, `log::warn!` anything that is not a "duplicate column" error, and then `Ok(())` regardless. The caller (`ensure_remote_schema_upgraded` / `ensure_remote_v19_schema`) treats that `Ok` as proof and writes the gate setting — permanently, since nothing ever clears it and the Settings UI hides the "Initialize Remote Database" button once `remote_initialized` is true (`SettingsPage.tsx:1066`).

So a v17 or v19 gate being set proves *a run happened*, not *the run worked*.

By contrast `create_remote_vault_tables` (`sync.rs:579`, the v18 path) returns `Err` on any statement error, so `turso_schema_v18_upgraded = 1` **is** trustworthy — the vault tables definitely exist remotely.

**Bottom line:** on the evidence available locally, the remote is very likely at full v19 parity and `captures.context` exists. The v17/v19 gates are latched, so the app will never retry them. Confirming requires one read-only look at the remote (§3). I am not going to guess.

---

## 2. The existing upgrade mechanism, in plain terms

Three sentences plus a diagram's worth of detail:

The remote database gets its tables created exactly once, the first time this Mac ever syncs — after that the creation code never runs again, because it is `CREATE TABLE IF NOT EXISTS` and the tables already exist. So every column added to the app after that first day has to be pushed to the remote as a separate "add this column" command. To avoid sending those commands on every single sync, the app writes a little sticky note in its own local settings — `turso_schema_v17_upgraded = 1` — and skips the commands forever once the note exists. The flaw is that the note gets written even if the server refused the commands, so a single bad day can permanently convince the app that a repair it never completed is done.

**Gates that exist today** (all in `nimble-core/src/db/sync.rs`, all called at the top of `push()` at lines 944–951):

| Gate setting | Function | Covers | Latches on failure? |
|---|---|---|---|
| `turso_schema_v17_upgraded` | `ensure_remote_schema_upgraded` → `upgrade_remote_schema` (`:505`) | 9 ALTERs: mig 15 + 16 + 17 columns | **Yes — bug** |
| `turso_schema_v18_upgraded` | `ensure_remote_vault_schema` → `create_remote_vault_tables` (`:579`) | 3 CREATEs from `VAULT_TABLE_DDL` | No (returns `Err`) |
| `turso_schema_v19_upgraded` | `ensure_remote_v19_schema` → `upgrade_remote_v19_schema` (`:636`) | 3 CREATEs from `V19_TABLE_DDL` + 5 ALTERs | **Yes — bug** |

**Versions with no gate of their own:** v1–v14 (predate the remote's existence — they are baked into the baseline `initialize_remote` DDL), v15 and v16 (folded into the v17 gate rather than getting gates of their own — which is why "`captures.context` is migration 16, and there's no v16 gate" reads like a gap but isn't one).

Secondary path: `initialize_remote` (`:267`) short-circuits to `upgrade_remote_schema` **ungated** when `turso_initialized` is already set (line 281). That is the one way to force the v17 ALTERs to re-run today — but the button that reaches it is hidden once the remote is initialized, and it does not cover v18 or v19.

---

## 3. How to safely inspect the live remote (read-only)

### Where credentials live

Both are rows in the **local SQLite `settings` table**, not env vars and not a config file:

- `settings.turso_url` — key `turso_url`, value `libsql://<db>-<org>.turso.io` (normalized to `https://` at request time in `turso_pipeline`, `sync.rs:148`)
- `settings.turso_token` — key `turso_token`, a JWT-shaped bearer token

Read at the command layer in `apps/desktop/src-tauri/src/commands/sync.rs:11–20` via `nimble_core::db::settings::get_setting`.

Live database file: `~/Library/Application Support/com.marcosevilla.daily-triage/nimble.db`
(the bundle identifier was deliberately kept at the pre-rename value; `daily-triage.db` in the same folder is the pre-rename database, adopted once by `lib.rs:271–285`.)

### Safest read-only dump — literal commands

Work against a **copy** of the local DB so nothing can lock or touch the live file:

```sh
# 1. Snapshot the local DB (also doubles as your backup, see §5)
cd ~/Library/Application\ Support/com.marcosevilla.daily-triage
cp nimble.db nimble.db.backup-$(date +%Y%m%d)

# 2. Pull the credentials out of the copy into shell vars (they are not echoed)
TURSO_URL=$(sqlite3 "file:nimble.db.backup-$(date +%Y%m%d)?mode=ro" \
  "SELECT replace(value,'libsql://','https://') FROM settings WHERE key='turso_url';")
TURSO_TOKEN=$(sqlite3 "file:nimble.db.backup-$(date +%Y%m%d)?mode=ro" \
  "SELECT value FROM settings WHERE key='turso_token';")

# 3. READ-ONLY: dump every remote table definition
curl -s -X POST "$TURSO_URL/v2/pipeline" \
  -H "Authorization: Bearer $TURSO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requests":[
        {"type":"execute","stmt":{"sql":"SELECT name, sql FROM sqlite_master WHERE type='"'"'table'"'"' ORDER BY name"}},
        {"type":"close"}]}' | jq -r '.results[0].response.result.rows[] | .[1].value'
```

That single `SELECT` against `sqlite_master` returns the full `CREATE TABLE` text of every remote table — enough to answer "does `captures` have `context`?" and every other row of the §1b table at once, with zero writes.

The specific one-column check, if you want it terse:

```sh
# READ-ONLY: does captures.context exist remotely?
curl -s -X POST "$TURSO_URL/v2/pipeline" \
  -H "Authorization: Bearer $TURSO_TOKEN" -H "Content-Type: application/json" \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT name FROM pragma_table_info('"'"'captures'"'"')"}},{"type":"close"}]}' \
  | jq -r '.results[0].response.result.rows[][].value'
```

**Alternative:** the `turso` CLI is installed (`/opt/homebrew/bin/turso`, v1.0.19). `turso db shell <db-name> ".schema"` gives the same answer if you are still authenticated with `turso auth login`. The `.schema` / `.dump` meta-commands are read-only. **Do not** use `turso db shell` for anything else here — it is an interactive write-capable shell.

**I did not run any of these.** They need the token, and extracting a live credential was outside the brief.

---

## 4. The proposed fix

The fix is in two stages, and stage 1 may make stage 2 unnecessary.

### Stage 1 — verify before repairing (do this first)

Run the read-only dump in §3. Two outcomes:

- **All columns present** → nothing is broken. Update the stale memory note, and apply only the *hardening* changes in 4b so this class of failure can't hide again.
- **Something missing** → apply 4a (the repair) plus 4b (the hardening).

### 4a. Repair SQL

Every statement is already in the codebase; this is the consolidated, idempotent list. **One statement per semicolon** — safe to paste into a migration, and safe to run twice.

```sql
CREATE TABLE IF NOT EXISTS vault_notes (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', frontmatter_json TEXT, mtime TEXT, size INTEGER NOT NULL DEFAULT 0, hash TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE IF NOT EXISTS vault_links (id TEXT PRIMARY KEY, from_note_id TEXT NOT NULL, to_path TEXT NOT NULL, link_type TEXT NOT NULL DEFAULT 'wikilink', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS vault_tags (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, tag TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT 'gray', position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS task_labels (task_id TEXT NOT NULL, label_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (task_id, label_id));
CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, external_id TEXT, external_source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
ALTER TABLE local_tasks ADD COLUMN external_id TEXT;
ALTER TABLE local_tasks ADD COLUMN external_source TEXT;
ALTER TABLE local_tasks ADD COLUMN remote_updated_at TEXT;
ALTER TABLE local_tasks ADD COLUMN synced_snapshot TEXT;
ALTER TABLE local_tasks ADD COLUMN due_time TEXT;
ALTER TABLE local_tasks ADD COLUMN duration_minutes INTEGER;
ALTER TABLE local_tasks ADD COLUMN recurrence_rule TEXT;
ALTER TABLE local_tasks ADD COLUMN section_id TEXT;
ALTER TABLE projects ADD COLUMN external_id TEXT;
ALTER TABLE projects ADD COLUMN external_source TEXT;
ALTER TABLE projects ADD COLUMN remote_updated_at TEXT;
ALTER TABLE projects ADD COLUMN synced_snapshot TEXT;
ALTER TABLE projects ADD COLUMN parent_id TEXT;
ALTER TABLE captures ADD COLUMN context TEXT;
```

**Idempotency:** the six `CREATE TABLE IF NOT EXISTS` are fully idempotent. The fourteen `ALTER ... ADD COLUMN` are not idempotent in the SQL sense — libSQL has no `ADD COLUMN IF NOT EXISTS` — but re-running one produces a `duplicate column name` error and changes nothing. **No statement here writes, moves, or deletes a single row.** Running the whole block twice is safe.

### 4b. Rust changes

Three edits, all in `nimble-core/src/db/sync.rs`. Recommended as a set.

**(1) Stop the gates latching on failure.** Give `upgrade_remote_schema` and `upgrade_remote_v19_schema` the same strictness `create_remote_vault_tables` already has: return `Err` when a statement fails with anything other than a duplicate-column error, instead of only warning. Concretely, in both functions replace

```rust
if !err_msg.to_lowercase().contains("duplicate column") {
    log::warn!("Turso ... schema upgrade statement {} failed: {}", i, err_msg);
}
```

with

```rust
if !err_msg.to_lowercase().contains("duplicate column") {
    log::warn!("Turso schema upgrade statement {i} failed: {err_msg}");
    return Err(crate::Error::Api(format!(
        "Turso schema upgrade failed at statement {i}: {err_msg}"
    )));
}
```

Because `ensure_remote_schema_upgraded` / `ensure_remote_v19_schema` use `?` before writing the gate setting, this alone makes a failed upgrade retry on the next push instead of latching. It is the whole fix for the class of bug, not just this instance. Extracting the shared result-checking loop into one `fn check_ddl_results(body, label) -> crate::Result<()>` used by all three upgrade functions is the tidy version.

**(2) Add a manual re-run escape hatch.** New `nimble-core` function plus a thin Tauri command:

```rust
/// Force a full remote-schema repair regardless of the local gate settings.
/// Every statement is idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN with
/// duplicate-column tolerance), so this never touches data and is safe to run
/// repeatedly. Clears the gates first so a partial failure retries on push.
pub async fn repair_remote_schema(
    pool: &SqlitePool,
    turso_url: &str,
    turso_token: &str,
) -> crate::Result<()> {
    sqlx::query(
        "DELETE FROM settings WHERE key IN
         ('turso_schema_v17_upgraded','turso_schema_v18_upgraded','turso_schema_v19_upgraded')",
    )
    .execute(pool)
    .await?;

    ensure_remote_schema_upgraded(pool, turso_url, turso_token).await?;
    ensure_remote_vault_schema(pool, turso_url, turso_token).await?;
    ensure_remote_v19_schema(pool, turso_url, turso_token).await?;
    Ok(())
}
```

Wire it as `sync_repair_remote_schema` following the existing `sync_initialize_remote` pattern (`commands/sync.rs:82`, registered in `lib.rs:494`), and surface it in Settings as a always-visible "Repair remote schema" secondary action — replacing the current behaviour where the only schema button disappears the moment it would be useful (`SettingsPage.tsx:1066`).

**(3) Separately worth fixing — push no longer lies about success.** `push_batch` (`sync.rs:909–929`) logs per-statement errors and then marks *every* entry in the batch `synced = 1` anyway. A row whose `INSERT` failed for "no such column" is recorded as synced and never retried. Minimum viable change: track which entries had a failing data mutation and leave those at `synced = 0`. This is a behaviour change with its own risk surface (a permanently-failing row would retry forever), so treat it as its own decision rather than folding it into the schema fix.

### How the fix is triggered

- With change (1) alone: automatically, on the next `push()` — but only for gates that are *not yet set*. Existing latched gates stay latched, so change (1) alone does **not** repair the current database.
- With change (2): manually, one click, whenever you want. This is what actually repairs today's state.
- Recommended order: read-only verify (§3) → if drift found, click Repair → re-run the read-only verify to confirm.

---

## 5. Blast radius

**What the proposed repair can break: essentially nothing.** Every statement in 4a is additive DDL. `ALTER TABLE ... ADD COLUMN` on SQLite/libSQL is a metadata-only operation — it does not rewrite the table, does not touch existing rows, and new columns read as `NULL`. `CREATE TABLE IF NOT EXISTS` on an existing table is a no-op. There is no `DROP`, no `UPDATE`, no `DELETE`, no table rebuild. Run it twice and the second run produces fourteen harmless "duplicate column name" errors.

**What could break if it is applied wrong:**

1. **Editing the DDL to remove `IF NOT EXISTS`, or "cleaning up" with a `DROP TABLE` first.** This is the only way to lose remote data through this change. `DROP TABLE vault_notes` would destroy 1,239 note rows on the remote. Never introduce a drop into this path.
2. **Column-order or type mismatch.** The repair adds columns to the *end* of the remote table, so remote column order will differ from local. That is fine — every write in `sync.rs` names its columns explicitly (`build_data_mutation_requests` builds the column list from snapshot JSON keys), and no code does `SELECT *` against the remote or relies on positional binding. But if someone later "fixes" the ordering by rebuilding the table, that rebuild is where data dies.
3. **Clearing `turso_initialized` to force a re-init.** Harmless in itself (all `CREATE TABLE IF NOT EXISTS`), but it is a red herring — it re-runs only the creation path and cannot widen existing tables. It also resets `remote_initialized` in the UI, which is confusing.
4. **The genuinely dangerous adjacent operation, which is NOT part of this fix: resetting `sync_log.synced = 0` or `last_pull_timestamp` to force a re-push/re-pull.** There are ~34,100 `sync_log` rows locally. A mass re-push replays historical snapshots against a last-write-wins engine keyed on `sync_log.timestamp`; stale snapshots can overwrite newer remote state and resurrect deleted rows. **Do not do this as part of a schema repair.** It is never needed to add a column.

**What data could already be lost (pre-existing, not caused by the fix):** because `push_batch` marks entries `synced = 1` even when their data mutation errored, any row pushed during a window when the remote lacked its column was silently dropped on the remote and will never be retried. For `captures.context` that window is roughly 2026-08-02 → 2026-08-05. Those captures still exist on the Mac; they are missing from the cloud copy. A schema repair does **not** backfill them, and `seed_existing_data` won't either — it only seeds rows that have *no* `sync_log` entry, and these have one. Backfilling would require deliberately re-seeding those specific rows, which is a separate, riskier task (see item 4 above). Local is the source of truth and the Mac is the only real writer, so nothing is lost from your day-to-day; what is degraded is Turso's value as a backup for that window.

**Back up first:**

- `cp ~/Library/Application\ Support/com.marcosevilla.daily-triage/nimble.db nimble.db.backup-$(date +%Y%m%d)` — 53 MB, takes a second. Quit Nimble first so the file is quiescent.
- Optionally `turso db shell <db-name> ".dump" > turso-backup-$(date +%Y%m%d).sql` for a remote snapshot. Read-only.
- The repair itself needs neither, but backing up before touching sync is cheap insurance and gives you the credential-read source in §3 for free.

---

## 6. The unchunked pull

**Confirmed unchunked.** The line reference in the brief (~870) is stale — the push-chunking work (`9e906ec`) shifted things; `pull` now lives at `nimble-core/src/db/sync.rs:1025`, and the unbounded query is at `:1036–1042`:

```rust
"SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp
 FROM sync_log WHERE timestamp > ? AND device_id != ? ORDER BY timestamp ASC"
```

No `LIMIT`, no cursor, no batching, and the entire result set is deserialized into a `Vec<serde_json::Value>` in memory before a single row is applied. The push side has `plan_batches` / `MAX_BATCH_ENTRIES` (200) / `MAX_BATCH_BYTES` (2 MiB); the pull side has none of it. The mobile pull (`apps/mobile/services/sync.ts:270`) is identical and equally unbounded.

**What actually happens with a large dataset:** the pull asks for every `sync_log` row written by any *other* device since `last_pull_timestamp` — which on this Mac is still `2026-04-05T06:20:35.108Z`, i.e. sixteen weeks of "since". Today that returns almost nothing, because no second device has ever written meaningfully. The moment one does, the request returns that device's entire history in one HTTP response. `sync_log` snapshots carry the full row payload, and `vault_notes` snapshots carry the full text of each note — the push-chunking commit measured that corpus at 17–25 MB for ~1,200 notes. So a second device that seeds the vault produces a single response in the tens of megabytes, held entirely in memory, against a 120-second client timeout (`TURSO_REQUEST_TIMEOUT`). If that request times out or exceeds Turso's response ceiling, `last_pull_timestamp` never advances (it is only written after the loop completes), so the next pull issues the *identical* oversized request — the exact permanent-wedge failure mode that push chunking was written to fix, reproduced on the other side of the pipe.

**Blocker or perf issue?** **Blocker for adding a second write client**, not merely slow. With one writer it is genuinely harmless — an empty result set costs nothing, and today's stuck `last_pull_timestamp` is invisible. But the failure is not "sync takes a while", it is "sync can never complete and never advances its watermark", and it triggers precisely at the moment a phone starts carrying real data. Anything that makes mobile a real writer should land pull chunking first. Two adjacent items belong in that same work: mobile's `initializeRemote` (`apps/mobile/services/sync.ts:444`) still ships the pre-v15 DDL and has no `turso_schema_v*` upgrade gates at all, so a fresh remote created by the phone would be born at the April schema; and mobile's migration list skips v18 entirely (17 → 19, deliberately — vault has no mobile filesystem story), which is safe only because `vault_*` is correctly excluded from mobile's `ALLOWED_TABLES`.

**Not fixed here, as instructed.**

### 6.1 Empirical confirmation — added 2026-08-15

The analysis above is correct, but it was later restated elsewhere (the Todoist ticket, and the project memory note) as *"the Mac cannot receive; the pull is wedged today; there is a four-month backlog to drain."* That restatement is **wrong**, and the measurement below is the disproof. Recording it here so the stronger claim doesn't get reintroduced.

Counts by `device_id`, read directly from both databases:

| `device_id` | Local `sync_log` | Remote `sync_log` |
|---|---|---|
| `4e7a9f30-…` (this Mac) | 34,113 | 34,047 |
| `mobile-d697e168` | 2 | 4 |

**Rows the pull would actually return: `SELECT COUNT(*) … WHERE timestamp > '2026-04-05T06:20:35.108Z' AND device_id != '<this Mac>'` → `0`.**

Three consequences:

1. **The ~34,100 figure is the Mac's own writes.** The pull filters `device_id != :my_device_id`, so those rows were never pullable and never constituted a backlog. Any reasoning that treats 34,100 as "rows waiting to be drained" has conflated the push corpus with the pull corpus.
2. **The frozen watermark is benign, not evidence of failure.** `last_pull_timestamp` equals *exactly* the timestamp of the last `mobile-d697e168` row (`2026-04-05T06:20:35.108Z`). The Mac pulled that row successfully and has had nothing foreign to pull since. A pull returning zero rows does not advance a watermark, and should not. "Frozen for four months" and "wedged" are not the same claim, and only the first is true.
3. **The trigger condition is unchanged and still real.** Everything in §6 about what happens *when* a second device starts writing stands. This is a correctly-identified latent bug; it simply was never an active outage, and never gated any other work.

**Status: fixed** on branch `web-client` (`84e0981`). `MAX_PULL_ROWS = 200` as a SQL `LIMIT`, with the watermark persisted per chunk, and a composite `(timestamp, id)` keyset cursor so a chunk boundary inside a group of rows sharing one millisecond neither skips rows (`timestamp >`) nor loops forever (`timestamp >=`).

That work also found a second defect not described above, and this one *was* silently active: a statement-level Turso failure returns **HTTP 200 with `results[0].type == "error"`**, and the old parse called `.unwrap_or_default()` on the rows pointer — so a failed query was indistinguishable from a successful empty pull and returned `Ok(0)`. Any future pull failure would have been invisible for the same reason the schema-upgrade gates in §4 latch silently. Same root pattern, third instance: **a 2xx response carrying a statement-level error, treated as success.** Worth a sweep for other `.unwrap_or_default()` uses on Turso response parsing.

---

## Appendix — evidence gathered

Read-only, all against a *copy* of `nimble.db` in a scratch directory (since deleted). Nothing was written anywhere; the remote was never contacted.

- `settings` gate keys and timestamps → §1c
- `MAX(schema_version.version)` = **19**
- `sync_log` totals: 34,102 rows; largest tables `activity_log` 29,204, `local_tasks` 2,162, `vault_notes` 1,239, `captures` 129
- `sync_log WHERE synced = 0` = **53** (activity_log 10, local_tasks 23, vault_notes 15, vault_links 4, goals 1) — consistent with `last_push_timestamp` 2026-08-13T20:55 and auto-sync running only on app launch (`apps/desktop/src/App.tsx:37–53`); not evidence of a failure
- `PRAGMA table_info` for all 21 synced tables → §1b/§1c comparison
- Baseline remote DDL recovered from `git show 901b70c:daily-triage-core/src/db/sync.rs`
- Key commits: `901b70c` (2026-04-04, sync + `initialize_remote`), `34b8a94` (2026-08-04, v17 gate + `captures.context`), `075b7ce` (2026-08-05, v18 vault), `9e906ec` (2026-08-05, push chunking), `f1606c5` (2026-08-09, v19 gate + mobile mirror)
