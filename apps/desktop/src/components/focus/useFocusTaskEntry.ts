import { format } from 'date-fns'
import { toast } from 'sonner'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { sourceForTask } from '@/lib/focusFlows'
import { focusTaskControls } from '@/lib/focusTaskEntry'
import {
  enqueueTasks,
  focusNow,
  focusNowBlockedReason,
  isDroppedRepeat,
  sendFocusAction,
  useFocusCache,
} from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import type { LocalTask } from '@nimble/types'

/**
 * One task's visible focus entry (row icon/menu, detail control): the live
 * controls plus the two handlers. Every write goes through the focus store;
 * nothing starts except the explicit Focus now.
 */
export type FocusEntryTask = Pick<LocalTask, 'id' | 'content' | 'sync_policy' | 'due_date' | 'project_id'>

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const reportError = (error: unknown) => { if (!isDroppedRepeat(error)) toast(messageOf(error)) }

/** Live controls for a task plus the two handlers (toggle queue, Focus now). */
export function useFocusTaskEntry(task: FocusEntryTask) {
  const snapshot = useFocusCache((s) => s.snapshot)
  const capabilities = useFocusCache((s) => s.capabilities)
  const pending = useFocusCache((s) => s.pending != null)
  const controls = focusTaskControls({
    snapshot,
    capabilities,
    pending,
    focusNowBlocked: focusNowBlockedReason(capabilities),
    taskId: task.id,
  })

  const toggle = () => {
    const { toggle } = controls
    if (toggle.disabled) return
    if (toggle.kind === 'remove') {
      sendFocusAction({ kind: 'remove', occurrence_id: toggle.occurrence_id }).then(
        () => toast('Removed from focus queue'),
        reportError,
      )
      return
    }
    enqueueTasks([task.id], sourceForTask(task, format(new Date(), 'yyyy-MM-dd'))).then(
      () => toast.success('Added to focus queue', {
        action: { label: 'Open queue', onClick: () => useFocusSurface.getState().setExpanded(true) },
      }),
      reportError,
    )
  }

  const start = () => {
    if (controls.focusNow.disabled) return
    focusNow(task.id, sourceForTask(task, format(new Date(), 'yyyy-MM-dd'))).then(() => emitTasksChanged(), reportError)
  }

  return { controls, toggle, start }
}

