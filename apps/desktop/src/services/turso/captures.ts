/**
 * Captures — read path for the web build.
 *
 * Mirrors `nimble_core::db::captures::get_captures` (nimble-core/src/db/captures.rs)
 * so the web client sees the same rows in the same order as the desktop app.
 * The defaults (limit 50, includeConverted false) come from the Tauri command
 * wrapper in apps/desktop/src-tauri/src/commands/captures.rs, not from the core
 * function — the core takes both as required arguments.
 */

import type { Capture } from '@nimble/types'
import { integer, query, str, strOrNull, text, textOrNull, type Row } from './client'
import { commit, newId, rowTimestamp } from './mutations'

/** Column list and order match the Rust query exactly. */
const COLUMNS = 'id, content, source, converted_to_task_id, routed_to, context, created_at'

/**
 * `context` (schema v16) is nullable, as are `converted_to_task_id` and
 * `routed_to` — decode those with `strOrNull` so an absent cell becomes `null`
 * rather than throwing.
 */
function toCapture(row: Row): Capture {
  return {
    id: str(row, 'id'),
    content: str(row, 'content'),
    source: str(row, 'source'),
    converted_to_task_id: strOrNull(row, 'converted_to_task_id'),
    routed_to: strOrNull(row, 'routed_to'),
    context: strOrNull(row, 'context'),
    created_at: str(row, 'created_at'),
  }
}

/**
 * Captures, newest first.
 *
 * `includeConverted === false` (the default) hides captures that have already
 * become tasks — the inbox is meant to show what still needs triaging, so a
 * converted capture is done, not pending.
 *
 * `limit` is bound as a `?` parameter rather than interpolated: the proxy at
 * api/turso.ts regex-inspects every statement, and interpolation is exactly the
 * shape that scan exists to catch.
 */
export async function listCaptures(limit = 50, includeConverted = false): Promise<Capture[]> {
  const sql = includeConverted
    ? `SELECT ${COLUMNS} FROM captures ORDER BY created_at DESC LIMIT ?`
    : `SELECT ${COLUMNS} FROM captures WHERE converted_to_task_id IS NULL ORDER BY created_at DESC LIMIT ?`

  const rows = await query(sql, [integer(limit)])
  return rows.map(toCapture)
}

/**
 * Create a capture.
 *
 * Mirrors `create_capture` in nimble-core/src/db/captures.rs, including the two
 * places that file does something non-obvious:
 *
 * 1. The INSERT names only five columns, but the snapshot carries all seven.
 *    `converted_to_task_id` and `routed_to` default to NULL in the table and are
 *    explicitly `None` on the struct that gets serialised. They have to appear in
 *    the snapshot as nulls: receivers apply it with `INSERT OR REPLACE`, so a key
 *    that is absent is a column that gets dropped, not one that keeps its value.
 *
 * 2. `created_at` is written explicitly rather than left to the column default.
 *    The default is `datetime('now', 'localtime')` but Rust binds
 *    `chrono::Local::now()` formatted the same way — so the value is local time
 *    either way, and `rowTimestamp()` reproduces it.
 *
 * Not mirrored: the `item_captured` activity_log entry. `activity_log` is a
 * synced table, so captures made from the phone will be missing from activity
 * history until web writes it too — a known v1 gap, not an oversight.
 */
export async function createCapture(
  content: string,
  source = 'manual',
  context?: string,
): Promise<Capture> {
  const capture: Capture = {
    id: newId(),
    content,
    source,
    converted_to_task_id: null,
    routed_to: null,
    context: context ?? null,
    created_at: rowTimestamp(),
  }

  await commit(
    [
      {
        sql: 'INSERT INTO captures (id, content, source, context, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [
          text(capture.id),
          text(capture.content),
          text(capture.source),
          textOrNull(capture.context),
          text(capture.created_at),
        ],
      },
    ],
    [{ table: 'captures', rowId: capture.id, operation: 'INSERT', snapshot: capture }],
  )

  return capture
}
