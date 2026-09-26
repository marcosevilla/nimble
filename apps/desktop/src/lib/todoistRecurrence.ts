import type { LocalTask } from '@nimble/types'
import { nextOccurrenceDate, parseRecurrenceRule } from './recurrence.ts'

/**
 * Todoist owns a linked recurring task (mirrors
 * `nimble-core/src/integrations/todoist/recurrence.rs`): when Todoist's last
 * synced state says it recurs, completing it anywhere in Nimble completes it,
 * the Mac pushes `item_close`, and Todoist picks the next date, which comes
 * back through the pull. Nimble never predicts or computes that date.
 *
 * The web cannot see whether Todoist sync is switched on (a Mac-local
 * setting), so it assumes it is.
 */
export type TodoistLinkFields = Pick<LocalTask, 'external_source' | 'external_id' | 'sync_policy' | 'synced_snapshot'>

export function todoistOwnsRecurrence(task: Partial<TodoistLinkFields>): boolean {
  if (task.external_source !== 'todoist' || !task.external_id || task.sync_policy === 'local_only') return false
  if (!task.synced_snapshot) return false
  try {
    const snapshot = JSON.parse(task.synced_snapshot) as { due?: { is_recurring?: unknown } | null }
    return snapshot?.due?.is_recurring === true
  } catch {
    return false
  }
}

/** Neutral copy shown instead of a predicted date for a Todoist-owned task. */
export const TODOIST_SCHEDULES_NEXT = 'Todoist will schedule the next one.'

export type RecurringCompletionNotice =
  | { kind: 'todoist'; message: string }
  | { kind: 'rescheduled'; nextDue: string }

/** What to tell the user right after completing a task: Todoist schedules it,
 *  Nimble rescheduled it to `nextDue`, or nothing (not recurring). */
export function recurringCompletionNotice(
  task: TodoistLinkFields & Pick<LocalTask, 'recurrence_rule' | 'due_date'>,
  todayISO: string,
): RecurringCompletionNotice | null {
  if (todoistOwnsRecurrence(task)) return { kind: 'todoist', message: TODOIST_SCHEDULES_NEXT }
  if (!task.recurrence_rule || !task.due_date) return null
  const rule = parseRecurrenceRule(task.recurrence_rule)
  if (!rule) return null
  return { kind: 'rescheduled', nextDue: nextOccurrenceDate(rule, task.due_date, todayISO) }
}

/**
 * Read-only copy for the rule of a task Todoist owns while Todoist sync is on
 * (Marco, 2026-09-25: lock, don't push — revisit at the C5 cutover). `null`
 * = the rule is Nimble's and stays editable (sync off, local-only, or not
 * recurring in Todoist). The backend refuses the edit too (`recurrence_locked`).
 */
export function lockedRecurrenceCopy(
  task: Partial<TodoistLinkFields> & Partial<Pick<LocalTask, 'recurrence_rule'>>,
  todoistSyncOn: boolean,
): string | null {
  if (!todoistSyncOn || !todoistOwnsRecurrence(task)) return null
  const rule = task.recurrence_rule?.trim()
  return rule ? `Repeats in Todoist: ${rule} — edit in Todoist` : 'Repeats in Todoist — edit in Todoist'
}
