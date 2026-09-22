import { toast } from 'sonner'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { taskToast } from '@/lib/taskToast'
import type { DataProvider, LocalTask } from '@nimble/types'

/* Optimistic delete with Undo (tasks audit P1-6, §3.2). Replaces the
   `window.confirm` gate: the task goes away immediately and the toast offers
   the way back for as long as it is on screen.

   Frontend-only restore: Undo re-creates the task from the snapshot via
   `dp.tasks.create`, so the restored task carries a NEW id (activity log,
   sync history and any detail deep-link to the old id do not follow). A
   true id-preserving restore needs a soft-delete in Rust — queued for
   Marco. */

export function snapshotToCreateInput(task: LocalTask): Parameters<DataProvider['tasks']['create']>[0] {
  return {
    content: task.content,
    projectId: task.project_id,
    parentId: task.parent_id ?? undefined,
    description: task.description ?? undefined,
    priority: task.priority,
    dueDate: task.due_date ?? undefined,
    dueTime: task.due_time ?? undefined,
    durationMinutes: task.duration_minutes ?? undefined,
    recurrenceRule: task.recurrence_rule ?? undefined,
    sectionId: task.section_id ?? undefined,
    labelIds: task.labels.length ? task.labels : undefined,
    reminderOffsetMinutes: task.reminder_offset_minutes ?? undefined,
    googleCalendarEnabled: task.google_calendar_enabled || undefined,
  }
}

const plural = (n: number) => (n === 1 ? 'task' : 'tasks')

/** Delete every task in `tasks`; returns how many deletes succeeded. Shows
 * one toast whose Undo re-creates the ones that were deleted. */
export async function deleteTasksWithUndo(dp: DataProvider, tasks: LocalTask[]): Promise<number> {
  const deleted: LocalTask[] = []
  for (const task of tasks) {
    try {
      await dp.tasks.delete(task.id)
      deleted.push(task)
    } catch {
      /* reported below */
    }
  }
  emitTasksChanged()

  const failed = tasks.length - deleted.length
  if (deleted.length === 0) {
    toast.error(`Could not delete ${tasks.length === 1 ? 'the task' : `${tasks.length} tasks`}`)
    return 0
  }

  const message =
    deleted.length === 1 && tasks.length === 1
      ? 'Task deleted'
      : `Deleted ${deleted.length} ${plural(deleted.length)}${failed ? ` — ${failed} failed` : ''}`

  toast(message, {
    action: {
      label: 'Undo',
      onClick: async () => {
        const restored: LocalTask[] = []
        for (const task of deleted) {
          try {
            restored.push(await dp.tasks.create(snapshotToCreateInput(task)))
          } catch {
            /* reported below */
          }
        }
        emitTasksChanged()
        if (restored.length === 1 && deleted.length === 1) {
          taskToast('Task restored', restored[0].id)
        } else if (restored.length === deleted.length) {
          toast.success(`Restored ${restored.length} ${plural(restored.length)}`)
        } else {
          toast.error(`Restored ${restored.length} of ${deleted.length} ${plural(deleted.length)}`)
        }
      },
    },
  })
  return deleted.length
}
