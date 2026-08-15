/**
 * Projects — read path for the web build.
 *
 * Mirrors `get_projects` in `nimble-core/src/db/projects.rs`: same columns, same
 * ORDER BY, so a project list rendered in the browser is ordered identically to
 * the desktop app. If that Rust query changes, change this one with it.
 */

import type { Project } from '@nimble/types'
import { query, num, str, strOrNull, type Row } from './client'

/**
 * The `projects` table carries more columns than the `Project` interface does
 * (`created_at`, `goal_id`, `milestone_id`). They are deliberately left out of
 * the projection — the shared type is the contract, and selecting extras would
 * only invite someone to widen the mapper with fields no consumer declares.
 *
 * `created_at` is still referenced in ORDER BY: SQLite can sort on a column that
 * isn't projected, and dropping it from the sort would reorder projects that
 * share a `position` (which happens — `position` is not unique).
 */
const LIST_SQL = `SELECT id, name, color, position, parent_id, external_id, external_source, remote_updated_at, synced_snapshot
   FROM projects
   ORDER BY position, created_at`

/** Decode one row. `position` is INTEGER, so it arrives as a string like "3". */
function toProject(row: Row): Project {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    color: str(row, 'color'),
    position: num(row, 'position'),
    parent_id: strOrNull(row, 'parent_id'),
    external_id: strOrNull(row, 'external_id'),
    external_source: strOrNull(row, 'external_source'),
    remote_updated_at: strOrNull(row, 'remote_updated_at'),
    synced_snapshot: strOrNull(row, 'synced_snapshot'),
  }
}

/** Every project, ordered as the desktop app orders them. */
export async function listProjects(): Promise<Project[]> {
  const rows = await query(LIST_SQL)
  return rows.map(toProject)
}
