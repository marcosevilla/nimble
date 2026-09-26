import type { LocalTask } from '@nimble/types'
import { todoistOwnsRecurrence } from '../../lib/todoistRecurrence.ts'
import { nextOccurrence, parseRule } from './recurrence.ts'

/**
 * How completing `task` plays out on the web, mirroring `set_status_tx`
 * (nimble-core/src/db/task_tx.rs):
 * - Todoist-owned recurring (see `lib/todoistRecurrence`): complete, no
 *   subtask cascade — the Mac pushes `item_close` and Todoist advances it.
 * - Parseable rule + due date: advance to the next occurrence.
 * - Otherwise: complete and cascade to subtasks.
 *
 * Throws `stale_occurrence` when the caller saw a different due date than the
 * row holds (another device already advanced it).
 */
export type CompletionPlan =
  | { kind: 'advance'; nextDue: string; nextDueTime: string | null }
  | { kind: 'complete'; cascade: boolean }

export function completionPlan(
  task: Pick<LocalTask, 'due_date' | 'due_time' | 'recurrence_rule' | 'external_source' | 'external_id' | 'sync_policy' | 'synced_snapshot'>,
  expectedDueDate: string | null | undefined,
  todayISO: string,
): CompletionPlan {
  const stale = () => {
    throw new Error('stale_occurrence: recurring due identity changed; refresh and retry')
  }
  if (todoistOwnsRecurrence(task)) {
    if (expectedDueDate !== undefined && expectedDueDate !== task.due_date) stale()
    return { kind: 'complete', cascade: false }
  }
  if (task.recurrence_rule != null && task.due_date != null) {
    const rule = parseRule(task.recurrence_rule)
    // Same guard as the desktop focus service: completing the occurrence the
    // user saw must not advance a date another device already advanced.
    if (rule != null && expectedDueDate !== undefined && expectedDueDate !== task.due_date) stale()
    // Rust parses `due_date` outside the recurrence module, so a row whose
    // due_date is not a valid `YYYY-MM-DD` completes normally; `nextOccurrence`
    // throws instead, and catching restores desktop's behavior.
    if (rule != null) {
      try {
        return { kind: 'advance', nextDue: nextOccurrence(rule, task.due_date, todayISO), nextDueTime: rule.time ?? task.due_time }
      } catch {
        // fall through to a normal completion
      }
    }
  }
  return { kind: 'complete', cascade: true }
}
