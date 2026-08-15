/**
 * Task reads for the web build.
 *
 * This mirrors `get_local_tasks` in `nimble-core/src/db/tasks.rs` statement for
 * statement. The desktop and web lists must agree down to row order, so the six
 * filter/ORDER BY combinations below are copied verbatim rather than
 * generalised into one composable query builder — a "cleaner" builder would
 * drift from the Rust the first time either side is edited.
 */

import type { LocalTask, TaskStatus } from '@nimble/types'
import { bool, num, numOrNull, pipeline, str, strOrNull, text, type Row, type TursoArg } from './client'

/** Exactly `SELECT_COLS` from nimble-core/src/db/tasks.rs — keep in sync. */
const SELECT_COLS =
  'id, parent_id, content, description, project_id, priority, due_date, due_time, ' +
  'duration_minutes, recurrence_rule, section_id, completed, completed_at, status, ' +
  'linked_doc_id, position, created_at, updated_at, external_id, external_source, ' +
  'remote_updated_at, synced_snapshot'

export interface ListTasksOptions {
  projectId?: string
  dueDate?: string
  includeCompleted?: boolean
}

/**
 * Pick the statement for this filter combination. Matches the Rust branch order:
 * a project filter wins outright, so passing both `projectId` and `dueDate`
 * silently ignores the date on desktop and must do the same here.
 */
function buildTaskQuery(opts: ListTasksOptions): { sql: string; args: TursoArg[] } {
  const { projectId, dueDate, includeCompleted = false } = opts

  if (projectId != null) {
    return {
      sql: includeCompleted
        ? `SELECT ${SELECT_COLS} FROM local_tasks WHERE project_id = ? ORDER BY completed, position, created_at`
        : `SELECT ${SELECT_COLS} FROM local_tasks WHERE project_id = ? AND completed = 0 ORDER BY position, created_at`,
      args: [text(projectId)],
    }
  }

  if (dueDate != null) {
    return {
      sql: includeCompleted
        ? `SELECT ${SELECT_COLS} FROM local_tasks WHERE due_date IS NOT NULL AND due_date <= ? ORDER BY due_date, priority DESC, position`
        : `SELECT ${SELECT_COLS} FROM local_tasks WHERE due_date IS NOT NULL AND due_date <= ? AND completed = 0 ORDER BY due_date, priority DESC, position`,
      args: [text(dueDate)],
    }
  }

  return {
    sql: includeCompleted
      ? `SELECT ${SELECT_COLS} FROM local_tasks ORDER BY project_id, completed, position, created_at`
      : `SELECT ${SELECT_COLS} FROM local_tasks WHERE completed = 0 ORDER BY project_id, position, created_at`,
    args: [],
  }
}

/** Decode one `local_tasks` row. `labels` is filled in by the caller. */
function toTask(row: Row, labels: string[]): LocalTask {
  return {
    id: str(row, 'id'),
    parent_id: strOrNull(row, 'parent_id'),
    content: str(row, 'content'),
    description: strOrNull(row, 'description'),
    project_id: str(row, 'project_id'),
    priority: num(row, 'priority'),
    due_date: strOrNull(row, 'due_date'),
    due_time: strOrNull(row, 'due_time'),
    duration_minutes: numOrNull(row, 'duration_minutes'),
    recurrence_rule: strOrNull(row, 'recurrence_rule'),
    section_id: strOrNull(row, 'section_id'),
    labels,
    // INTEGER 0/1 over the wire — the raw cell is the string "0", which is truthy.
    completed: bool(row, 'completed'),
    completed_at: strOrNull(row, 'completed_at'),
    // The column is a free-text CHECK-less string in SQLite; the workflow only
    // ever writes the five TaskStatus values, so trust it like the Rust does.
    status: str(row, 'status') as TaskStatus,
    linked_doc_id: strOrNull(row, 'linked_doc_id'),
    position: num(row, 'position'),
    created_at: str(row, 'created_at'),
    updated_at: str(row, 'updated_at'),
    external_id: strOrNull(row, 'external_id'),
    external_source: strOrNull(row, 'external_source'),
    remote_updated_at: strOrNull(row, 'remote_updated_at'),
    synced_snapshot: strOrNull(row, 'synced_snapshot'),
  }
}

/**
 * List tasks, filtered and ordered identically to the desktop app.
 *
 * Labels come back from one aggregate query batched into the same pipeline as
 * the task query: a per-task label lookup would be N+1 over a list that can hold
 * hundreds of rows, and here each of those queries would also be its own network
 * hop to Vercel. One round trip, grouped in memory.
 */
export async function listTasks(opts?: ListTasksOptions): Promise<LocalTask[]> {
  const taskQuery = buildTaskQuery(opts ?? {})

  const [taskRows, labelRows] = await pipeline([
    { sql: taskQuery.sql, args: taskQuery.args },
    // `ORDER BY rowid` keeps label order stable and matching insertion order,
    // the same guarantee the Rust relies on.
    { sql: 'SELECT task_id, label_id FROM task_labels ORDER BY rowid', args: [] },
  ])

  const labelsByTask = new Map<string, string[]>()
  for (const row of labelRows) {
    const taskId = str(row, 'task_id')
    const existing = labelsByTask.get(taskId)
    if (existing) existing.push(str(row, 'label_id'))
    else labelsByTask.set(taskId, [str(row, 'label_id')])
  }

  return taskRows.map((row) => toTask(row, labelsByTask.get(str(row, 'id')) ?? []))
}
