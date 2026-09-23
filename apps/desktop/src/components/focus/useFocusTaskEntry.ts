import { format } from 'date-fns'
import { toast } from 'sonner'
import { sourceForTask } from '@/lib/focusFlows'
import { focusTaskControls, isFocusableTask, queuedEntryFor } from '@/lib/focusTaskEntry'
import { focusNowForTask, reportFocusError } from './focusEntryActions'
import { useShallow } from 'zustand/react/shallow'
import {
  enqueueTasks,
  focusNowBlockedReason,
  sendFocusAction,
  useFocusCache,
} from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import type { FocusSource, LocalTask } from '@nimble/types'

/**
 * One task's visible focus entry (row icon/menu, detail control): the live
 * controls plus the two handlers. Every write goes through the focus store;
 * nothing starts except the explicit Focus now.
 */
export type FocusEntryTask = Pick<LocalTask, 'id' | 'content' | 'sync_policy' | 'due_date' | 'project_id' | 'completed' | 'status'>

const reportError = (error: unknown) => reportFocusError(error)
const openQueue = () => useFocusSurface.getState().setExpanded(true)

/** Live controls for a task plus its handlers (toggle queue, Focus now, open the tray). */
export function useFocusTaskEntry(task: FocusEntryTask) {
  // Primitives only: the snapshot changes on every heartbeat, this does not.
  const entry = useFocusCache(useShallow((s) => queuedEntryFor(s.snapshot, task.id)))
  const capabilities = useFocusCache((s) => s.capabilities)
  const pending = useFocusCache((s) => s.pending != null)
  const controls = focusTaskControls({
    entry,
    capabilities,
    pending,
    focusNowBlocked: focusNowBlockedReason(capabilities),
    completed: !isFocusableTask(task),
  })

  const enqueue = (source: FocusSource) =>
    enqueueTasks([task.id], source).then(
      () => toast.success('Added to focus queue', { action: { label: 'Open queue', onClick: openQueue } }),
      reportError,
    )

  const toggle = () => {
    const { toggle } = controls
    if (toggle.disabled) return
    if (toggle.kind === 'remove') {
      // Undo re-enqueues with the entry's own source. It appends a fresh
      // occurrence at the end; it cannot restore the old position or a
      // paused session's selection.
      const source = useFocusCache.getState().snapshot?.queue.find((e) => e.occurrence_id === toggle.occurrence_id)?.source
        ?? sourceForTask(task, format(new Date(), 'yyyy-MM-dd'))
      sendFocusAction({ kind: 'remove', occurrence_id: toggle.occurrence_id }).then(
        () => toast('Removed from focus queue', { action: { label: 'Undo', onClick: () => void enqueue(source) } }),
        reportError,
      )
      return
    }
    void enqueue(sourceForTask(task, format(new Date(), 'yyyy-MM-dd')))
  }

  const start = () => {
    if (controls.focusNow.disabled) return
    void focusNowForTask(task)
  }

  return { controls, toggle, start, openQueue }
}
