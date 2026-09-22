import { useMemo } from 'react'
import { addDays, format } from 'date-fns'
import { useDataProvider } from '@/services/provider-context'
import { useDetailStore } from '@/stores/detailStore'
import { useFocusStore, DEFAULT_FOCUS_CONFIG } from '@/stores/focusStore'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { taskToast } from '@/lib/taskToast'
import { completeTaskWithExit } from './StatusDropdown'
import { toast } from 'sonner'
import type { LocalTask } from '@nimble/types'

/** The single-key actions `useTaskNavigation` fires on the focused row —
 * shared by All Tasks and a project's list so both surfaces behave the
 * same (tasks audit P1-1; `lib/shortcuts.ts` Tasks section).
 *
 * - Enter: open detail
 * - x / Space: complete, with the same exit animation as the status menu
 * - s: snooze — due date moves to tomorrow (neutral copy, §1.1)
 * - f: start a focus session with the default timer config
 */
export function useTaskRowActions(tasks: LocalTask[]) {
  const dp = useDataProvider()

  return useMemo(
    () => ({
      onOpen: (id: string) => useDetailStore.getState().openTask(id),
      onComplete: (id: string) => completeTaskWithExit(dp, id, tasks.find((t) => t.id === id)?.due_date),
      onSnooze: async (id: string) => {
        const dueDate = format(addDays(new Date(), 1), 'yyyy-MM-dd')
        try {
          await dp.tasks.update({ id, dueDate })
          emitTasksChanged()
          taskToast('Moved to tomorrow', id)
        } catch (e) {
          toast.error(`Failed to reschedule: ${e}`)
        }
      },
      onFocusStart: (id: string) => {
        const task = tasks.find((t) => t.id === id)
        if (!task) return
        useFocusStore.getState().startFocus(task, DEFAULT_FOCUS_CONFIG)
      },
    }),
    [dp, tasks],
  )
}
