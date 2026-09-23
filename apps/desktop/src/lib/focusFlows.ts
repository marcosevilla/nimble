/**
 * Focus entry-point intents: what a task row, a multi-select, a shortcut or
 * the task detail asks of the durable focus engine. Pure, so each entry point
 * is testable without rendering. Nothing here starts timing on its own:
 * multi-select appends, "Focus now" is one explicit Start, Space only pauses
 * or resumes an existing session, and history totals come from engine
 * snapshots — never from activity logs.
 *
 * Type-only imports keep this loadable directly by node:test.
 */
import type { FocusAction, FocusHistoryRow, FocusSnapshot, FocusSource, LocalTask } from '@nimble/types'
import { format, parseISO } from 'date-fns'
import { formatDurationMs } from './focusModel.ts'
import { localDueDate } from './focusSources.ts'

// ── Entry intents ──

/** Multi-select default: an explicit append in selection order (duplicates dropped). */
export function enqueueSelectionAction(taskIds: string[], source: FocusSource): FocusAction | null {
  const ids = [...new Set(taskIds)]
  return ids.length ? { kind: 'enqueue', task_ids: ids, source, explicit_still_open: false } : null
}

export interface FocusNowPlan {
  /** Append first when the task is not queued yet. */
  enqueue: FocusAction | null
  /** Known start; null means "resolve from the committed enqueue reply". */
  start: FocusAction | null
}

/**
 * "Focus now": the engine's `start` settles/pauses any running task, moves
 * the chosen occurrence first and starts it atomically. An unqueued task is
 * appended first; its occurrence id comes from the committed reply.
 */
export function focusNowPlan(snapshot: FocusSnapshot, taskId: string, source: FocusSource): FocusNowPlan {
  const start = startActionFor(snapshot, taskId)
  return start ? { enqueue: null, start } : { enqueue: enqueueSelectionAction([taskId], source), start: null }
}

/** The explicit start for a queued task, or null when it is not queued. */
export function startActionFor(snapshot: FocusSnapshot, taskId: string): FocusAction | null {
  const entry = snapshot.queue.find((e) => e.task_id === taskId)
  return entry ? { kind: 'start', occurrence_id: entry.occurrence_id } : null
}

/**
 * Space pauses or resumes the selected occurrence's existing session.
 * It never starts a task, a break or a next round — those stay explicit.
 */
export function spaceKeyAction(snapshot: FocusSnapshot | null): FocusAction | null {
  const session = snapshot?.session
  const selected = snapshot?.queue[0]?.occurrence_id
  if (!session || !selected || session.occurrence_id !== selected || session.status === 'ended') return null
  if (session.phase !== 'work' && session.phase !== 'break') return null
  return session.status === 'running' ? { kind: 'pause' } : { kind: 'resume' }
}

/** Provenance for a row-level entry: local-only, due today, else its project. */
export function sourceForTask(task: Pick<LocalTask, 'sync_policy' | 'due_date' | 'project_id'>, today: string): FocusSource {
  if (task.sync_policy === 'local_only') return { kind: 'local' }
  if (task.due_date && localDueDate(task.due_date) === today) return { kind: 'today' }
  return { kind: 'project', project_id: task.project_id }
}

// ── History and provenance ──

/** Today's completed tray: completed today (local date) and not cleared. */
export function completedTrayRows(rows: FocusHistoryRow[], today: string): FocusHistoryRow[] {
  return rows.filter((r) => !r.archived && r.completed_at != null && localDueDate(r.completed_at) === today)
}

export interface FocusHistoryLine {
  occurrence_id: string
  title: string
  total: string
  /** "Recorded m:ss" and/or "Imported total m:ss" — never a session span. */
  parts: string[]
  /** Completion date when known, else "Not completed". */
  when: string
  archived: boolean
}

export interface TaskFocusSummary {
  total_ms: number
  recorded_ms: number
  imported_ms: number
  total: string
  rows: FocusHistoryLine[]
}

function historyLine(row: FocusHistoryRow): FocusHistoryLine {
  const parts: string[] = []
  if (row.recorded_ms > 0 || row.imported_ms === 0) parts.push(`Recorded ${formatDurationMs(row.recorded_ms)}`)
  if (row.imported_ms > 0) parts.push(`Imported total ${formatDurationMs(row.imported_ms)}`)
  return {
    occurrence_id: row.occurrence_id,
    title: row.title,
    total: formatDurationMs(row.total_ms),
    parts,
    when: row.completed_at ? `Completed ${format(parseISO(row.completed_at), 'MMM d')}` : 'Not completed',
    archived: row.archived,
  }
}

/** A task's lifetime focus time: the sum of its occurrences' snapshot totals. */
export function taskFocusSummary(rows: FocusHistoryRow[]): TaskFocusSummary {
  const sum = (pick: (r: FocusHistoryRow) => number) => rows.reduce((n, r) => n + pick(r), 0)
  const total_ms = sum((r) => r.total_ms)
  return {
    total_ms,
    recorded_ms: sum((r) => r.recorded_ms),
    imported_ms: sum((r) => r.imported_ms),
    total: formatDurationMs(total_ms),
    rows: rows.map(historyLine),
  }
}

// ── Recovery ──

export interface RecoveryNotice {
  title: string
  /** The paused, durable total of the selected occurrence (any date). */
  total: string
  reason: string
}

/** After an interruption the selected task is paused at its last checkpoint; show it, never start it. */
export function recoveryNotice(snapshot: FocusSnapshot | null, tasks: Pick<LocalTask, 'id' | 'content'>[]): RecoveryNotice | null {
  const entry = snapshot?.queue[0]
  if (!snapshot?.recovery_reason || !entry) return null
  const title = tasks.find((t) => t.id === entry.task_id)?.content ?? 'Task no longer available'
  return { title, total: formatDurationMs(snapshot.totals[entry.occurrence_id] ?? 0), reason: snapshot.recovery_reason }
}

// ── Bulk completion ──

const tasksWord = (n: number) => `${n} task${n === 1 ? '' : 's'}`

/** A completion the service refused because the task changed elsewhere (stale occurrence). */
export function isStaleRefusal(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'stale_occurrence') return true
  const text = error instanceof Error ? error.message : String(error)
  return text.includes('stale_occurrence')
}

/**
 * Truthful bulk result: refused completions (changed elsewhere) and failed
 * writes are reported, never counted as done.
 */
export function completionSummary(done: number, refused: number, failed = 0): { ok: boolean; message: string } {
  if (refused === 0 && failed === 0) return { ok: true, message: `Completed ${tasksWord(done)}` }
  const parts: string[] = []
  if (done > 0) parts.push(`Completed ${tasksWord(done)}.`)
  if (refused > 0) {
    const who = done > 0 || failed > 0 ? String(refused) : tasksWord(refused)
    parts.push(`${who} changed elsewhere and ${refused === 1 ? 'was' : 'were'} left open.`)
  }
  if (failed > 0) parts.push(`${tasksWord(failed)} couldn't be saved; try again.`)
  return { ok: false, message: parts.join(' ') }
}

// ── Completion acknowledgement ──

export interface CompletionAcknowledgement {
  title: string
  totalMs: number
  /** The new first entry when the selected task was completed; it is paused. */
  nextTitle: string | null
  queueEmpty: boolean
}

/**
 * What to acknowledge after a committed completion. Only a completed
 * selected (first) task names a next entry — it is selected paused and
 * needs its own Start; completing an upcoming task leaves the card alone.
 */
export function completionAcknowledgement(
  before: FocusSnapshot,
  after: FocusSnapshot,
  occurrenceId: string,
  titleOf: (taskId: string) => string | undefined,
): CompletionAcknowledgement {
  const done = before.queue.find((e) => e.occurrence_id === occurrenceId)
  const next = before.queue[0]?.occurrence_id === occurrenceId ? after.queue[0] : undefined
  return {
    title: (done && titleOf(done.task_id)) ?? 'Task',
    totalMs: after.totals[occurrenceId] ?? before.totals[occurrenceId] ?? 0,
    nextTitle: next ? titleOf(next.task_id) ?? null : null,
    queueEmpty: after.queue.length === 0,
  }
}
