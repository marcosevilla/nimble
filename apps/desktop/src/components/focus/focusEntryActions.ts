import { format } from 'date-fns'
import { toast } from 'sonner'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { sourceForTask } from '@/lib/focusFlows'
import { focusEntryErrorMessage, isFocusableTask } from '@/lib/focusTaskEntry'
import { FocusRequestError } from '@/services/focus-events'
import { focusNow, isDroppedRepeat } from '@/stores/focusStore'
import type { LocalTask } from '@nimble/types'

/**
 * Shared focus entry actions for surfaces without a rendered control model
 * (the row `f` shortcut, the command bar). Errors are always shown as
 * friendly copy, never raw engine text.
 */

type Notify = (message: string) => void

/** Toast a failed focus write (a dropped repeat is silent). */
export function reportFocusError(error: unknown, notify: Notify = (m) => toast(m)): void {
  if (!isDroppedRepeat(error)) notify(focusEntryErrorMessage(FocusRequestError.from(error)))
}

export type FocusNowTask = Pick<LocalTask, 'id' | 'sync_policy' | 'due_date' | 'project_id' | 'completed' | 'status'>

/**
 * Explicit Focus now for one task. A completed task is a quiet no-op (the
 * engine refuses it without an explicit still-open choice, and the UI shows
 * no focus controls for it). Resolves to what happened.
 */
export async function focusNowForTask(
  task: FocusNowTask,
  notify: Notify = (m) => toast(m),
  today = format(new Date(), 'yyyy-MM-dd'),
): Promise<'skipped' | 'started' | 'failed'> {
  if (!isFocusableTask(task)) return 'skipped'
  try {
    await focusNow(task.id, sourceForTask(task, today))
    emitTasksChanged()
    return 'started'
  } catch (error) {
    reportFocusError(error, notify)
    return 'failed'
  }
}
