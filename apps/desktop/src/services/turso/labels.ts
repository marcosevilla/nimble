/**
 * Labels — read path for the web build.
 *
 * Mirrors `nimble-core/src/db/labels.rs::list_labels` so the web list matches
 * the desktop list row-for-row: same columns, same ORDER BY. Writes stay on the
 * desktop for now; this module is reads only.
 */

import type { Label } from '@nimble/types'
import { query, str, num, type Row } from './client'

/**
 * The column list from `LABEL_COLS` in labels.rs, spelled out rather than
 * `SELECT *` — the row decoder below indexes by name, so an added column on
 * Turso must not silently change what arrives.
 */
const LABEL_COLS = 'id, name, color, position, created_at'

/**
 * `position` is an INTEGER that the HTTP API hands back as the string "3";
 * decoding it with `num` is what keeps `Label.position` an actual number
 * (and sortable) rather than a string that happens to look like one.
 */
function toLabel(row: Row): Label {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    color: str(row, 'color'),
    position: num(row, 'position'),
    created_at: str(row, 'created_at'),
  }
}

/**
 * All labels, ordered exactly as the desktop orders them: by `position`, with
 * `created_at` as the tiebreaker. The tiebreaker matters — `create_label`
 * assigns `MAX(position) + 1`, but a `position` collision is possible after a
 * cross-device sync, and without it the order would be whatever SQLite felt
 * like returning, differing between web and desktop.
 */
export async function listLabels(): Promise<Label[]> {
  const rows = await query(`SELECT ${LABEL_COLS} FROM labels ORDER BY position, created_at`)
  return rows.map(toLabel)
}
