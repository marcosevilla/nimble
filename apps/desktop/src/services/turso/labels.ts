/**
 * Labels — read path for the web build.
 *
 * Mirrors `nimble-core/src/db/labels.rs::list_labels` so the web list matches
 * the desktop list row-for-row: same columns, same ORDER BY. Writes stay on the
 * desktop for now; this module is reads only.
 */

import type { Label, LabelGroup } from '@nimble/types'
import { query, str, strOrNull, num, bool, TursoError, type Row } from './client'

/**
 * The column list from `LABEL_COLS` in labels.rs, spelled out rather than
 * `SELECT *` — the row decoder below indexes by name, so an added column on
 * Turso must not silently change what arrives.
 */
const LABEL_COLS = 'id, name, color, position, created_at, "group", archived_at'
/** Pre-v25 remotes (gate not yet run by a desktop push) lack `archived_at`. */
const LABEL_COLS_V23 = 'id, name, color, position, created_at, "group"'

/**
 * `position` is an INTEGER that the HTTP API hands back as the string "3";
 * decoding it with `num` is what keeps `Label.position` an actual number
 * (and sortable) rather than a string that happens to look like one.
 */
function toLabel(row: Row): Label {
  return {
    group: strOrNull(row, 'group'),
    archived_at: 'archived_at' in row ? strOrNull(row, 'archived_at') : null,
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
  try {
    const rows = await query(`SELECT ${LABEL_COLS} FROM labels ORDER BY position, created_at`)
    return rows.map(toLabel)
  } catch (e) {
    if (!(e instanceof TursoError) || !/no such column/i.test(e.message)) throw e
    const rows = await query(`SELECT ${LABEL_COLS_V23} FROM labels ORDER BY position, created_at`)
    return rows.map(toLabel)
  }
}

const GROUP_COLS = 'id, name, position, exclusive, system, created_at, updated_at'

function toGroup(row: Row): LabelGroup {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    position: num(row, 'position'),
    exclusive: bool(row, 'exclusive'),
    system: bool(row, 'system'),
    created_at: str(row, 'created_at'),
    updated_at: str(row, 'updated_at'),
  }
}

/** Groups in desktop order. A remote without the v25 table reads as "no groups". */
export async function listLabelGroups(): Promise<LabelGroup[]> {
  try {
    const rows = await query(`SELECT ${GROUP_COLS} FROM label_groups ORDER BY position, created_at`)
    return rows.map(toGroup)
  } catch (e) {
    if (e instanceof TursoError && /no such table/i.test(e.message)) return []
    throw e
  }
}

/**
 * Mirrors `labels.rs::unused_label_ids`: ungrouped (no group row, which also
 * covers a dangling id), not archived, no open task. Grouped and system labels
 * are never auto-archived.
 */
export async function unusedLabelIds(): Promise<string[]> {
  try {
    const rows = await query(
      `SELECT l.id FROM labels l
       LEFT JOIN label_groups g ON g.id = l."group"
       WHERE l.archived_at IS NULL
         AND g.id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM task_labels tl JOIN local_tasks t ON t.id = tl.task_id
           WHERE tl.label_id = l.id AND t.status != 'complete')
       ORDER BY l.position, l.created_at`,
    )
    return rows.map((r) => str(r, 'id'))
  } catch (e) {
    // Pre-v25 remote (no label_groups table / archived_at column yet): nothing
    // to archive until a desktop push runs the v25 gate. Other errors surface.
    if (e instanceof TursoError && /no such (table|column)/i.test(e.message)) return []
    throw e
  }
}
