import { toast } from 'sonner'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { cascadeReopenCandidates } from '@/lib/cascadeReopen'
import { ToastAction } from '@/components/shared/ToastAction'
import type { DataProvider, TaskStatus } from '@nimble/types'

let seq = 0

/**
 * Move a completed task back to an open status — the one path every reopen
 * takes (the detail page's status control, a list row's status menu, a
 * subtask row's), so each gets the same follow-up (Agentation pass 3, C3).
 *
 * Completing a parent also completed its open subtasks; reopening it touches
 * only the parent. So this reads the parent's `completed_at` first (the
 * reopen nulls it), reopens, then offers one "Reopen N subtasks too?" toast
 * for the subtasks that cascade closed (lib/cascadeReopen). Ignoring the
 * toast changes nothing; N = 0 shows none. Throws what `updateStatus` throws.
 */
export async function reopenTask(dp: DataProvider, taskId: string, status: TaskStatus, reason?: string) {
  const before = await dp.tasks.list({ includeCompleted: true }).catch(() => [])
  const parentCompletedAt = before.find((t) => t.id === taskId)?.completed_at ?? null

  await dp.tasks.updateStatus(taskId, status, reason)
  emitTasksChanged()

  if (!parentCompletedAt) return
  const after = await dp.tasks.list({ includeCompleted: true }).catch(() => [])
  const ids = cascadeReopenCandidates(parentCompletedAt, after.filter((t) => t.parent_id === taskId))
  if (ids.length > 0) offerSubtaskReopen(dp, ids)
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
