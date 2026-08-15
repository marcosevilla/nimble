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
import {
  bool,
  integer,
  num,
  numOrNull,
  pipeline,
  query,
  str,
  strOrNull,
  text,
  textOrNull,
  TursoError,
  type Row,
  type TursoArg,
  type TursoStatement,
} from './client'
import { commit, newId, rowTimestamp, rowTimestampUtc, type SyncEntry } from './mutations'
import { nextOccurrence, parseRule, type RecurrenceRule } from './recurrence'

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

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export interface CreateTaskOptions {
  content: string
  projectId?: string
  parentId?: string
  description?: string
  priority?: number
  dueDate?: string
  dueTime?: string
  durationMinutes?: number
  recurrenceRule?: string
  sectionId?: string
  labelIds?: string[]
}

/**
 * Create a task.
 *
 * Mirrors `create_local_task` (nimble-core/src/db/tasks.rs:180-287), with the
 * defaults it applies: `project_id` falls back to `'inbox'`, `priority` to 1, and
 * `status` to the column default `'todo'`.
 *
 * Two round trips, not one. Position and section validity both depend on data
 * already in the table, and a browser cannot compute them locally the way Rust
 * can inside a connection — so this reads first, then writes. The write itself is
 * still a single pipeline, which is the part that has to be atomic.
 *
 * `created_at`/`updated_at` are written explicitly with the value the column
 * DEFAULT would have produced (`datetime('now')`, UTC). Rust lets the default
 * apply and then re-SELECTs the row to learn what it got; naming the value here
 * avoids a third round trip and lands the same content. See `rowTimestampUtc`
 * for why create is UTC while status changes are local.
 */
export async function createTask(opts: CreateTaskOptions): Promise<LocalTask> {
  // Labels are a second synced table plus their own sync_log entry (Rust routes
  // them through `labels::set_task_labels`). Rather than write half of that and
  // drop the rest on the floor, refuse loudly — a silently label-less task is the
  // kind of loss you would not notice for weeks.
  if (opts.labelIds && opts.labelIds.length > 0) {
    throw new TursoError('Labels cannot be set from the web client yet — create the task, then add labels on the desktop app')
  }

  const projectId = opts.projectId ?? 'inbox'
  const parentId = opts.parentId ?? null
  const sectionId = opts.sectionId ?? null

  // `local_tasks.section_id` has no foreign key, so a section from another
  // project would be accepted by SQLite and simply render wrong. Rust validates
  // app-side (tasks.rs:206) and so does this.
  if (sectionId != null) {
    const rows = await query('SELECT project_id FROM sections WHERE id = ?', [text(sectionId)])
    if (rows.length === 0 || strOrNull(rows[0], 'project_id') !== projectId) {
      throw new TursoError(`Section "${sectionId}" does not belong to project "${projectId}"`)
    }
  }

  // Position is scoped to the sibling set: subtasks order within their parent,
  // top-level tasks within their project. COALESCE(-1) makes the first task in an
  // empty scope land at 0, matching Rust.
  const positionRows = await query(
    parentId != null
      ? 'SELECT COALESCE(MAX(position), -1) AS max_pos FROM local_tasks WHERE parent_id = ?'
      : 'SELECT COALESCE(MAX(position), -1) AS max_pos FROM local_tasks WHERE project_id = ? AND parent_id IS NULL',
    [text(parentId ?? projectId)],
  )
  const position = num(positionRows[0], 'max_pos') + 1

  const now = rowTimestampUtc()
  const task: LocalTask = {
    id: newId(),
    parent_id: parentId,
    content: opts.content,
    description: opts.description ?? null,
    project_id: projectId,
    priority: opts.priority ?? 1,
    due_date: opts.dueDate ?? null,
    due_time: opts.dueTime ?? null,
    duration_minutes: opts.durationMinutes ?? null,
    recurrence_rule: opts.recurrenceRule ?? null,
    section_id: sectionId,
    labels: [],
    completed: false,
    completed_at: null,
    status: 'todo',
    linked_doc_id: null,
    position,
    created_at: now,
    updated_at: now,
    external_id: null,
    external_source: null,
    remote_updated_at: null,
    synced_snapshot: null,
  }

  await commit(
    [
      {
        sql:
          'INSERT INTO local_tasks (id, parent_id, content, description, project_id, priority, ' +
          'due_date, due_time, duration_minutes, recurrence_rule, section_id, status, position, ' +
          'created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          text(task.id),
          textOrNull(task.parent_id),
          text(task.content),
          textOrNull(task.description),
          text(task.project_id),
          integer(task.priority),
          textOrNull(task.due_date),
          textOrNull(task.due_time),
          task.duration_minutes != null ? integer(task.duration_minutes) : textOrNull(null),
          textOrNull(task.recurrence_rule),
          textOrNull(task.section_id),
          text(task.status),
          integer(task.position),
          text(task.created_at),
          text(task.updated_at),
        ],
      },
    ],
    [{ table: 'local_tasks', rowId: task.id, operation: 'INSERT', snapshot: task }],
  )

  return task
}

/** Local calendar date as `YYYY-MM-DD`, matching Rust's `Local::now().date_naive()`. */
function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * `nextOccurrence` for a `due_date` that may not be a valid date.
 *
 * Returns null where desktop would fall through to ordinary completion, so the
 * caller can branch on a value instead of on an exception. See the call site for
 * why the two implementations differ here.
 */
function tryNextOccurrence(
  rule: RecurrenceRule,
  currentDue: string,
  todayDate: string,
): string | null {
  try {
    return nextOccurrence(rule, currentDue, todayDate)
  } catch {
    return null
  }
}

/** Read one full row, labels included, so a snapshot can be built from it. */
async function fetchTask(id: string): Promise<LocalTask> {
  const [taskRows, labelRows] = await pipeline([
    { sql: `SELECT ${SELECT_COLS} FROM local_tasks WHERE id = ?`, args: [text(id)] },
    { sql: 'SELECT label_id FROM task_labels WHERE task_id = ? ORDER BY rowid', args: [text(id)] },
  ])
  if (taskRows.length === 0) throw new TursoError(`No task with id "${id}"`)
  return toTask(taskRows[0], labelRows.map((r) => str(r, 'label_id')))
}

/**
 * Set a task's status, reproducing `update_task_status_at`
 * (nimble-core/src/db/tasks.rs:522-695).
 *
 * `status` is the real field — the five-state workflow. `completed` and
 * `completed_at` are derived from it, set only when status becomes `'complete'`,
 * which is why they are written here rather than by the caller.
 *
 * Three branches, matching Rust's order:
 *
 * 1. **Recurring, moving to complete.** A task with a parseable `recurrence_rule`
 *    AND a `due_date` does NOT complete — its due date advances to the next
 *    occurrence and its status resets to `'todo'`. Completing such a task outright
 *    would silently end the repeat, and nothing would surface that until the
 *    deadline passed. An unparseable rule or a missing due date falls through and
 *    completes normally; the rule is inert in that case, which is Rust's behavior
 *    and not a fallback worth "improving".
 * 2. **Moving to complete.** Sets the derived flags and cascades to subtasks.
 * 3. **Anything else.** Plain status change, clearing the derived flags.
 *
 * Timestamps here are LOCAL, unlike create — see `rowTimestampUtc`.
 *
 * ⚠️ Divergence from desktop, deliberate: Rust's completion cascade updates every
 * subtask (tasks.rs:641) but then writes a sync_log entry for the PARENT only
 * (tasks.rs:672), so subtask completions never leave the Mac. This writes an entry
 * per affected subtask, which is what the sync protocol requires. The extra
 * entries are ordinary UPDATEs and are safe for desktop to apply; the desktop-side
 * omission is filed separately as a bug.
 */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const task = await fetchTask(id)
  const now = rowTimestamp()

  if (status === 'complete' && task.recurrence_rule != null && task.due_date != null) {
    const rule = parseRule(task.recurrence_rule)
    // Rust parses `due_date` OUTSIDE the recurrence module — `if let Ok(current_due)`
    // at tasks.rs:564 — so a row whose due_date is not a valid `YYYY-MM-DD` falls
    // through and completes normally. Here that parse lives inside
    // `nextOccurrence`, which throws instead. Catching restores desktop's
    // behavior: a corrupt date must not make the task impossible to complete.
    const nextDue = rule != null ? tryNextOccurrence(rule, task.due_date, today()) : null
    if (rule != null && nextDue != null) {
      const nextDueTime = rule.time ?? task.due_time

      const rescheduled: LocalTask = {
        ...task,
        due_date: nextDue,
        due_time: nextDueTime,
        status: 'todo',
        updated_at: now,
      }

      await commit(
        [
          {
            sql: 'UPDATE local_tasks SET due_date = ?, due_time = ?, status = ?, updated_at = ? WHERE id = ?',
            args: [
              text(nextDue),
              textOrNull(nextDueTime),
              text('todo'),
              text(now),
              text(id),
            ],
          },
        ],
        [
          {
            table: 'local_tasks',
            rowId: id,
            operation: 'UPDATE',
            snapshot: rescheduled,
            changedColumns: ['due_date', 'due_time', 'status'],
          },
        ],
      )
      return
    }
  }

  const isComplete = status === 'complete'
  const completedAt = isComplete ? now : null

  const updated: LocalTask = {
    ...task,
    status,
    completed: isComplete,
    completed_at: completedAt,
    updated_at: now,
  }

  const dataStatements: TursoStatement[] = [
    {
      sql: 'UPDATE local_tasks SET status = ?, completed = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      args: [text(status), integer(isComplete ? 1 : 0), textOrNull(completedAt), text(now), text(id)],
    },
  ]
  const syncEntries: SyncEntry[] = [
    {
      table: 'local_tasks',
      rowId: id,
      operation: 'UPDATE',
      snapshot: updated,
      changedColumns: ['status', 'completed', 'completed_at'],
    },
  ]

  if (isComplete) {
    // Read the subtasks before mutating so each one's full row is available to
    // snapshot. Only incomplete ones need touching, which also keeps the pipeline
    // small for a parent that is being re-completed.
    const subtaskRows = await query(
      `SELECT ${SELECT_COLS} FROM local_tasks WHERE parent_id = ? AND completed = 0`,
      [text(id)],
    )

    for (const row of subtaskRows) {
      // Labels are stripped from snapshots, so an empty list here is not a loss.
      const subtask = toTask(row, [])
      const completedSubtask: LocalTask = {
        ...subtask,
        status: 'complete',
        completed: true,
        completed_at: now,
        updated_at: now,
      }
      dataStatements.push({
        sql: 'UPDATE local_tasks SET status = ?, completed = 1, completed_at = ?, updated_at = ? WHERE id = ?',
        args: [text('complete'), text(now), text(now), text(subtask.id)],
      })
      syncEntries.push({
        table: 'local_tasks',
        rowId: subtask.id,
        operation: 'UPDATE',
        snapshot: completedSubtask,
        changedColumns: ['status', 'completed', 'completed_at'],
      })
    }
  }

  await commit(dataStatements, syncEntries)
}
