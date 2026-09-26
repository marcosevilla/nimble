import type { DataProvider, LocalTask } from '@nimble/types'
import type { DueValue } from '@/components/tasks/DueDatePopover'

/* One metadata patch → one `dp.tasks.update()` call. Shared by the task
   detail page's chips and the task row's clickable marks (loop 2 chunk 3,
   T1), so both write a task the same way. Pure: returns the update, or null
   when nothing actually changed. */

export type TaskUpdate = Parameters<DataProvider['tasks']['update']>[0]

export interface TaskPatch {
  priority?: number
  due?: DueValue
  labelIds?: string[]
  projectId?: string
  sectionId?: string | null
  linkedDocId?: string | null
}

type PatchableTask = Pick<
  LocalTask,
  'id' | 'due_date' | 'due_time' | 'duration_minutes' | 'recurrence_rule'
>

/** `recurrenceLocked`: the rule is Todoist's (see `lib/todoistRecurrence`),
 * so a patch never sets or clears it — the popover echoes the full due value
 * (e.g. clearing the due chip sends a null rule too). */
export function taskPatchToUpdate(
  task: PatchableTask,
  patch: TaskPatch,
  opts: { recurrenceLocked?: boolean } = {},
): TaskUpdate | null {
  const updates: TaskUpdate = { id: task.id }
  let touched = false

  if (patch.priority !== undefined) {
    updates.priority = patch.priority
    touched = true
  }
  if (patch.due !== undefined) {
    // DueDatePopover always emits the full DueValue (every field, even
    // ones untouched by this interaction) — deriving clear flags from
    // "value is null" instead of "value CHANGED" meant e.g. setting
    // Duration on a task with no due time sent clearDueTime: true, which
    // the Rust backend applies AFTER setting duration_minutes and nulls
    // both. Gate each set/clear on the incoming value actually differing
    // from the task's current value (mirrors the retired TaskEditor's
    // `dueTimeChanged && !dueTime && !!task.due_time` pattern), and only
    // clear a field the task actually has — this also stops the 3-4
    // no-op clear UPDATEs (activity-log + sync churn) on every due patch.
    const due = patch.due
    if (due.dueDate !== (task.due_date ?? null)) {
      updates.dueDate = due.dueDate ?? undefined
      updates.clearDueDate = due.dueDate === null && !!task.due_date
      touched = true
    }
    if (due.dueTime !== (task.due_time ?? null)) {
      updates.dueTime = due.dueTime ?? undefined
      updates.clearDueTime = due.dueTime === null && !!task.due_time
      touched = true
    }
    if (due.durationMinutes !== (task.duration_minutes ?? null)) {
      updates.durationMinutes = due.durationMinutes ?? undefined
      updates.clearDuration = due.durationMinutes === null && task.duration_minutes != null
      touched = true
    }
    if (!opts.recurrenceLocked && due.recurrenceRule !== (task.recurrence_rule ?? null)) {
      updates.recurrenceRule = due.recurrenceRule ?? undefined
      updates.clearRecurrence = due.recurrenceRule === null && !!task.recurrence_rule
      touched = true
    }
  }
  if (patch.labelIds !== undefined) {
    updates.labelIds = patch.labelIds
    touched = true
  }
  if (patch.projectId !== undefined) {
    updates.projectId = patch.projectId
    touched = true
  }
  if (patch.sectionId !== undefined) {
    updates.sectionId = patch.sectionId ?? undefined
    updates.clearSection = patch.sectionId === null
    touched = true
  }
  if (patch.linkedDocId !== undefined) {
    updates.linkedDocId = patch.linkedDocId
    touched = true
  }
  return touched ? updates : null
}
