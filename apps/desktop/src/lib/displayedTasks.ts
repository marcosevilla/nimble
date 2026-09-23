/**
 * The due date each task was last DISPLAYED with, for callers that only hold
 * an id (bulk selection, row shortcuts). Completing a recurring task sends
 * this as `expectedDueDate`; if a sync already advanced the date, the service
 * refuses with `stale_occurrence` instead of advancing it twice.
 *
 * `undefined` = never displayed. It travels as "no due date", which the
 * service accepts for non-recurring tasks and refuses for recurring ones —
 * the safe direction.
 */
import type { LocalTask } from '@nimble/types'

const dueById = new Map<string, string | null>()

export function rememberDisplayedTasks(tasks: readonly Pick<LocalTask, 'id' | 'due_date'>[]): void {
  for (const task of tasks) dueById.set(task.id, task.due_date ?? null)
}

export function displayedDueDate(id: string): string | null | undefined {
  return dueById.get(id)
}
