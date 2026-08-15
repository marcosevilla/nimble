/**
 * Sections — read path for the web build.
 *
 * Mirrors `list_sections` in `nimble-core/src/db/sections.rs`: same columns,
 * same filter, same ORDER BY, so a project's section list rendered in the
 * browser is ordered identically to the desktop app. If that Rust query
 * changes, change this one with it.
 */

import type { Section } from '@nimble/types'
import { query, text, num, str, strOrNull, type Row } from './client'

/**
 * `project_id` is bound as a `?` parameter rather than interpolated. Beyond the
 * obvious injection risk, the proxy at `api/turso.ts` regex-inspects every
 * statement it forwards, so a value spliced into the SQL text can also get the
 * whole request rejected.
 *
 * ORDER BY is `position, created_at` — matching Rust exactly. `position` is not
 * unique within a project (a Todoist import can land several sections on the
 * same value), so `created_at` is the tiebreaker that keeps the order stable
 * and identical across clients.
 *
 * The projection is the full `SECTION_COLS` list from the Rust module, which
 * happens to be every column of the table and every field of `Section`.
 */
const LIST_SQL = `SELECT id, project_id, name, position, external_id, external_source, created_at
   FROM sections
   WHERE project_id = ?
   ORDER BY position, created_at`

/** Decode one row. `position` is INTEGER, so it arrives as a string like "3". */
function toSection(row: Row): Section {
  return {
    id: str(row, 'id'),
    project_id: str(row, 'project_id'),
    name: str(row, 'name'),
    position: num(row, 'position'),
    external_id: strOrNull(row, 'external_id'),
    external_source: strOrNull(row, 'external_source'),
    created_at: str(row, 'created_at'),
  }
}

/** Every section in one project, ordered as the desktop app orders them. */
export async function listSections(projectId: string): Promise<Section[]> {
  const rows = await query(LIST_SQL, [text(projectId)])
  return rows.map(toSection)
}
