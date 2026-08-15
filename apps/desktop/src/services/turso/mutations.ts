/**
 * The one write path for the web build. Every mutation goes through `commit`.
 *
 * Writing to Turso from the browser is not "run the UPDATE". A write that only
 * touches the data table is worse than no write at all: Turso holds the new
 * value, but the desktop pull reads `sync_log` — not the tables — so the Mac
 * never learns anything changed and overwrites your edit the next time it pushes
 * that row. Every mutation is therefore TWO statements: the data mutation and a
 * `sync_log` entry describing it, submitted in one pipeline.
 *
 * ## Snapshots are always the complete row
 *
 * Receivers apply a snapshot with `INSERT OR REPLACE`, which deletes the row and
 * re-inserts it from the snapshot alone. Any column missing from the JSON is not
 * "left alone" — it is destroyed, on every other device. `local_tasks` has 22
 * columns, so a snapshot built from just the fields a mutation touched wipes the
 * other ~19.
 *
 * This is not hypothetical: `apps/mobile/services/sqlite-provider.ts` writes
 * 5-key partial snapshots today and would blank `content`, `due_date` and
 * `priority` across every device if that app were ever used. Do not copy it. The
 * rule that keeps this correct is structural rather than a matter of care —
 * `commit` takes a whole domain object and serialises all of it, so there is no
 * shape of call that can express a partial snapshot.
 *
 * ## Two timestamp formats, deliberately
 *
 * `sync_log.timestamp` and a row's own `created_at`/`updated_at` are different
 * formats and are NOT interchangeable. See `syncTimestamp` and `rowTimestamp`.
 *
 * Source of truth for all of this: `nimble-core/src/db/sync.rs` (`append_sync_log`,
 * `task_sync_snapshot`, `pull`) and `nimble/docs/web-client-architecture-decision.md` §3.
 */

import { getDeviceId } from './device-id'
import { pipeline, text, textOrNull, type TursoStatement } from './client'

/** Tables the desktop sync engine replicates. Anything else is dropped on pull. */
export type SyncTable = 'local_tasks' | 'captures'

export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE'

/** `crypto.randomUUID` is available in every browser this app targets. */
export function newId(): string {
  return crypto.randomUUID()
}

/**
 * Timestamp for `sync_log.timestamp` — ISO-8601 with `T`, e.g.
 * `2026-08-15T12:34:56.789Z`. Matches Rust's
 * `Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ")` exactly.
 *
 * This is the one timestamp that has to be right. The pull selects
 * `WHERE timestamp > :watermark` and last-write-wins compares these values as
 * STRINGS (sync.rs:1369), so ordering is lexicographic. A value in the row format
 * below sorts before every ISO value ever written, which would not raise an error
 * anywhere — it would just quietly lose conflicts forever.
 */
export function syncTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Timestamp for a row's own `created_at` / `updated_at` — `YYYY-MM-DD HH:MM:SS`,
 * in the browser's LOCAL time.
 *
 * Local, not UTC, is deliberate and worth explaining because it looks like a bug.
 * The column defaults in migrations.rs are `datetime('now')` (UTC), but every
 * actual write Rust performs uses `datetime('now', 'localtime')` — tasks.rs lines
 * 572, 633, 642 and 649. Local time is therefore what the dominant writer puts in
 * these columns, and matching it keeps rows written on the phone visually
 * consistent with rows written on the Mac.
 *
 * Nothing in sync depends on this choice: conflict resolution reads
 * `sync_log.timestamp`, never `updated_at`. That makes the whole convention a
 * display concern, and cheaply reversible — when Rust is migrated to UTC, this
 * function changes with it, in one coordinated step rather than two half-done
 * ones. Tracked as a follow-up; do not "fix" this to UTC on its own.
 */
export function rowTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/**
 * The same `YYYY-MM-DD HH:MM:SS` shape as `rowTimestamp`, but in UTC.
 *
 * Both exist because the desktop app is internally inconsistent about this, and
 * matching it means reproducing the inconsistency rather than averaging it away:
 *
 * - INSERTs omit `created_at`/`updated_at` and take the column DEFAULT, which is
 *   `datetime('now')` — UTC (migrations.rs).
 * - UPDATEs set the column explicitly to `datetime('now', 'localtime')` — local
 *   (tasks.rs:572, 633, 642, 649).
 *
 * So a row is born with UTC timestamps and switches to local time the first time
 * anything touches it. That is the origin of the ~7-hour spread already observed
 * between the Mac and Turso. Picking one convention here would make the web the
 * odd client out; picking per-operation keeps every row indistinguishable from a
 * Mac-written one.
 *
 * Sync does not read these columns (conflict resolution uses
 * `sync_log.timestamp`), so this is a display concern throughout. The follow-up
 * that migrates Rust to UTC collapses these two functions into one.
 */
export function rowTimestampUtc(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Mirrors the INSERT in `sync::append_sync_log`, with one difference: `synced` is
 * 1 here where Rust writes 0.
 *
 * The column means "this change has reached Turso". On the Mac that starts false
 * and the pusher flips it. A web write IS the write to Turso, so it is true on
 * arrival — which is also what the Mac itself records when it applies a pulled
 * entry (sync.rs:1383). Nothing reads the remote copy of this column, so the
 * value is about staying semantically honest rather than about behavior.
 */
const SYNC_LOG_INSERT =
  'INSERT INTO sync_log ' +
  '(id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'

export interface SyncEntry {
  table: SyncTable
  rowId: string
  operation: SyncOperation
  /**
   * The complete row as the receiver should reconstruct it. Pass the whole domain
   * object; `commit` serialises it. `null` only for DELETE, which needs no state.
   */
  snapshot: object | null
  /**
   * Advisory list of touched columns. Nothing reads it — the snapshot carries the
   * full state either way — but Rust records it and the parity is free.
   */
  changedColumns?: string[]
}

/**
 * `task_sync_snapshot` (sync.rs:18) drops exactly one key before serialising:
 * `labels`, which is assembled from the `task_labels` join table and is not a
 * column on `local_tasks`. Leaving it in would put a key in the snapshot that
 * maps to no column. Nothing else is stripped, and nothing else should be.
 */
function serialiseSnapshot(snapshot: object): string {
  const { labels: _labels, ...columns } = snapshot as { labels?: unknown }
  return JSON.stringify(columns)
}

function syncLogStatement(entry: SyncEntry): TursoStatement {
  return {
    sql: SYNC_LOG_INSERT,
    args: [
      text(newId()),
      text(entry.table),
      text(entry.rowId),
      text(entry.operation),
      textOrNull(entry.changedColumns ? JSON.stringify(entry.changedColumns) : null),
      textOrNull(entry.snapshot ? serialiseSnapshot(entry.snapshot) : null),
      text(getDeviceId()),
      text(syncTimestamp()),
    ],
  }
}

/**
 * Run a mutation and its sync_log entries as one unit.
 *
 * Wrapped in BEGIN/COMMIT so the data write and its sync_log entry cannot land
 * separately. The half-state that matters is data-without-sync_log: it looks like
 * a successful write and then silently loses to the Mac later, which is precisely
 * the failure class this codebase has already hit repeatedly.
 *
 * `pipeline` throws on a statement-level error even though Turso answers such
 * failures with HTTP 200 — see the header comment in client.ts. That check is why
 * a rejected write here surfaces as a rejected promise instead of a silent no-op,
 * and it is the reason nothing in this file re-implements error handling.
 *
 * ⚠️ Whether Turso's HTTP pipeline aborts the remaining statements after one
 * fails, rather than running on to COMMIT, is a property of the Turso API that
 * cannot be tested locally (`vercel dev` does not run in this sandbox). Verify on
 * a real deployment before trusting the atomicity claim above.
 */
export async function commit(
  dataStatements: TursoStatement[],
  syncEntries: SyncEntry[],
): Promise<void> {
  await pipeline([
    { sql: 'BEGIN', args: [] },
    ...dataStatements,
    ...syncEntries.map(syncLogStatement),
    { sql: 'COMMIT', args: [] },
  ])
}
