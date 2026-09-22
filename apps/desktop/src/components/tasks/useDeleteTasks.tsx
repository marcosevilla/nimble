import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { LocalTask } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { planTaskDelete, deleteConfirmTitle } from '@/lib/deletePlan'
import { deleteTasksWithUndo, deleteTasksConfirmed } from '@/lib/taskUndo'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/* One delete path for every task-delete surface (detail page, selection
   bars) — review I1. Leaves: optimistic delete + Undo that restores status.
   Anything with subtasks: shadcn AlertDialog confirm, no Undo. Render
   `dialog` somewhere in the caller's tree. */

interface Pending {
  roots: LocalTask[]
  subtaskCount: number
  beforeDelete?: () => void
}

export function useDeleteTasks() {
  const dp = useDataProvider()
  const [pending, setPending] = useState<Pending | null>(null)

  /** `beforeDelete` runs once the delete is going ahead (close the detail
   * page, clear the selection) — after the confirm when there is one. */
  const requestDelete = useCallback(
    async (tasks: LocalTask[], beforeDelete?: () => void) => {
      if (tasks.length === 0) return
      let all: LocalTask[]
      try {
        all = await dp.tasks.list({ includeCompleted: true })
      } catch (e) {
        toast.error(`Could not delete: ${e}`)
        return
      }
      const plan = planTaskDelete(tasks, all)
      if (plan.needsConfirm) {
        setPending({ roots: plan.roots, subtaskCount: plan.subtaskCount, beforeDelete })
        return
      }
      beforeDelete?.()
      await deleteTasksWithUndo(dp, plan.roots)
    },
    [dp],
  )

  const confirm = useCallback(() => {
    if (!pending) return
    const { roots, subtaskCount, beforeDelete } = pending
    setPending(null)
    beforeDelete?.()
    void deleteTasksConfirmed(dp, roots, subtaskCount)
  }, [pending, dp])

  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(open) => { if (!open) setPending(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending ? deleteConfirmTitle(pending.roots.length, pending.subtaskCount) : ''}
          </AlertDialogTitle>
          <AlertDialogDescription>Subtasks go with it. This can't be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { requestDelete, dialog }
}
