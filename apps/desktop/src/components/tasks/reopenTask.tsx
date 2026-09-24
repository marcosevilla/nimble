import { toast } from 'sonner'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { aggregateCascadeReopen } from '@/lib/cascadeReopen'
import { ToastAction } from '@/components/shared/ToastAction'
import type { DataProvider, TaskStatus } from '@nimble/types'

let seq = 0

/**
 * Move one completed task back to an open status — the path every single
 * reopen takes (the detail page's status control, a list row's status menu,
 * a subtask row's), so each gets the same follow-up (Agentation pass 3, C3).
 * Throws what `updateStatus` throws. See `setOpenStatuses`.
 */
export async function reopenTask(dp: DataProvider, taskId: string, status: TaskStatus, reason?: string) {
  const { errors } = await setOpenStatuses(dp, [taskId], status, reason)
  if (errors.length > 0) throw errors[0]
}

/**
 * Set a non-complete status on `ids` (a bulk Status change, or one task).
 *
 * Completing a parent also completed its open subtasks; reopening it touches
 * only the parent. So this reads every task's `completed_at` first (the
 * reopen nulls it), sets the status, then offers ONE "Reopen N subtasks
 * too?" toast for the subtasks the reopened parents' cascades closed, N
 * summed across parents, leaving out tasks that were part of this change
 * (lib/cascadeReopen). Ignoring the toast changes nothing; N = 0 shows none.
 * Per-id failures are collected, not thrown; a failed id isn't a parent.
 */
export async function setOpenStatuses(
  dp: DataProvider,
  ids: string[],
  status: TaskStatus,
  reason?: string,
): Promise<{ done: number; errors: unknown[] }> {
  const before = await dp.tasks.list({ includeCompleted: true }).catch(() => [])
  const stampOf = new Map(before.map((t) => [t.id, t.completed_at ?? null]))

  const reopened: [string, string | null][] = []
  const errors: unknown[] = []
  for (const id of ids) {
    try {
      await dp.tasks.updateStatus(id, status, reason)
      reopened.push([id, stampOf.get(id) ?? null])
    } catch (e) {
      errors.push(e)
    }
  }
  emitTasksChanged()

  if (reopened.some(([, at]) => at)) {
    const after = await dp.tasks.list({ includeCompleted: true }).catch(() => [])
    // A failed id stays complete; keep it out of the offer too.
    const offer = aggregateCascadeReopen(reopened, after).filter((id) => !ids.includes(id))
    if (offer.length > 0) offerSubtaskReopen(dp, offer)
  }
  return { done: reopened.length, errors }
}

function offerSubtaskReopen(dp: DataProvider, ids: string[]) {
  const n = ids.length
  const id = `reopen-subtasks-${++seq}`
  toast(`Reopen ${n} subtask${n === 1 ? '' : 's'} too?`, {
    id,
    duration: 8000,
    action: (
      <ToastAction
        onClick={() => {
          toast.dismiss(id)
          void reopenSubtasks(dp, ids)
        }}
      >
        Reopen
      </ToastAction>
    ),
  })
}

async function reopenSubtasks(dp: DataProvider, ids: string[]) {
  let failed = 0
  for (const id of ids) {
    try {
      await dp.tasks.updateStatus(id, 'todo')
    } catch {
      failed++
    }
  }
  emitTasksChanged()
  if (failed > 0) toast.error(`Couldn't reopen ${failed} subtask${failed === 1 ? '' : 's'}`)
}
