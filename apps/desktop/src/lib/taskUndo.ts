import { toast } from 'sonner'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { taskToast } from '@/lib/taskToast'
import type { DataProvider, LocalTask } from '@nimble/types'

/* Task delete (tasks audit P1-6, §3.2; review I1). A leaf task goes away
   immediately and the toast offers Undo; a task with subtasks is confirmed
   in an AlertDialog and has no Undo, because `delete_local_task` cascades
   and the frontend can't re-create that faithfully. Callers go through
   `useDeleteTasks` (components/tasks/useDeleteTasks.tsx), which decides.

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

/** Re-create a deleted leaf task with everything it had: the create fields,
 * then status and linked doc (not accepted by create). Throws when any step
 * fails, so the caller never says "restored" for a half-restore. */
export async function restoreTask(dp: DataProvider, task: LocalTask): Promise<LocalTask> {
  const created = await dp.tasks.create(snapshotToCreateInput(task))
  if (task.status !== created.status) await dp.tasks.updateStatus(created.id, task.status)
  if (task.linked_doc_id) await dp.tasks.update({ id: created.id, linkedDocId: task.linked_doc_id })
  return created
}

/** Delete leaf tasks (no subtasks — see lib/deletePlan; callers with
 * subtasks confirm instead) and offer one Undo toast that restores them. */
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
            restored.push(await restoreTask(dp, task))
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
          toast.error(`Restored ${restored.length} of ${deleted.length} ${plural(deleted.length)} — check the list`)
        }
      },
    },
  })
  return deleted.length
}

/** Delete tasks that take subtasks with them — confirmed first, no Undo
 * (the cascade can't be re-created faithfully from the frontend). */
export async function deleteTasksConfirmed(dp: DataProvider, roots: LocalTask[], subtaskCount: number): Promise<number> {
  let deleted = 0
  for (const task of roots) {
    try {
      await dp.tasks.delete(task.id)
      deleted++
    } catch {
      /* reported below */
    }
  }
  emitTasksChanged()
  if (deleted === roots.length) {
    toast.success(
      roots.length === 1
        ? `Deleted the task and its ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}`
        : `Deleted ${roots.length} tasks and their subtasks`,
    )
  } else {
    toast.error(`Deleted ${deleted} of ${roots.length} ${plural(roots.length)}`)
  }
  return deleted
}
