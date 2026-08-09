import { useCallback, useEffect, useState } from 'react'
import { useDataProvider, getDataProvider } from '@/services/provider-context'
import type { LocalTask, Project } from '@nimble/types'
import { toast } from 'sonner'

// Simple event bus so all useLocalTasks instances refetch on any mutation
const TASKS_CHANGED = 'tasks-changed'

// Debounced Todoist push after local mutations: batches rapid-fire edits
// (e.g. typing, bulk reorders) into a single sync instead of one per
// keystroke. Quiet by design on failure — the outbox persists the pending
// ops, so the next trigger (interval/focus/another mutation) retries.
let todoistSyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleTodoistPush() {
  if (todoistSyncTimer) clearTimeout(todoistSyncTimer)
  todoistSyncTimer = setTimeout(() => {
    todoistSyncTimer = null
    getDataProvider().todoistSync.syncNow().catch(() => {
      // quiet by design: outbox persists, next trigger retries
    })
  }, 10_000)
}

export function emitTasksChanged() {
  window.dispatchEvent(new Event(TASKS_CHANGED))
  scheduleTodoistPush()
}

export function useLocalTasks(opts?: { projectId?: string; dueDate?: string; includeCompleted?: boolean }) {
  const dp = useDataProvider()
  const [tasks, setTasks] = useState<LocalTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await dp.tasks.list({
        projectId: opts?.projectId,
        dueDate: opts?.dueDate,
        includeCompleted: opts?.includeCompleted ?? true,
      })
      setTasks(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [dp, opts?.projectId, opts?.dueDate, opts?.includeCompleted])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Re-fetch when any useLocalTasks instance mutates
  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener(TASKS_CHANGED, handler)
    return () => window.removeEventListener(TASKS_CHANGED, handler)
  }, [refresh])

  const addTask = useCallback(
    async (content: string, extra?: { parentId?: string; projectId?: string; priority?: number; dueDate?: string; description?: string }) => {
      try {
        const task = await dp.tasks.create({
          content,
          projectId: extra?.projectId ?? opts?.projectId,
          parentId: extra?.parentId,
          priority: extra?.priority,
          dueDate: extra?.dueDate,
          description: extra?.description,
        })
        setTasks((prev) => [...prev, task])
        emitTasksChanged()
        return task
      } catch (e) {
        toast.error(`Failed to create task: ${e}`)
        return null
      }
    },
    [dp, opts?.projectId],
  )

  const complete = useCallback(async (id: string) => {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id || t.parent_id === id
          ? { ...t, completed: true, completed_at: new Date().toISOString() }
          : t,
      ),
    )
    try {
      await dp.tasks.complete(id)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to complete task: ${e}`)
      refresh()
    }
  }, [dp, refresh])

  const uncomplete = useCallback(async (id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, completed: false, completed_at: null } : t,
      ),
    )
    try {
      await dp.tasks.uncomplete(id)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to uncomplete task: ${e}`)
      refresh()
    }
  }, [dp, refresh])

  const remove = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id && t.parent_id !== id))
    try {
      await dp.tasks.delete(id)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to delete task: ${e}`)
      refresh()
    }
  }, [dp, refresh])

  const update = useCallback(async (id: string, updateOpts: { projectId?: string; content?: string; priority?: number; dueDate?: string }) => {
    try {
      const updated = await dp.tasks.update({ id, projectId: updateOpts.projectId, content: updateOpts.content, priority: updateOpts.priority, dueDate: updateOpts.dueDate })
      setTasks((prev) => prev.map((t) => t.id === id ? updated : t))
      emitTasksChanged()
      return updated
    } catch (e) {
      toast.error(`Failed to update task: ${e}`)
      refresh()
      return null
    }
  }, [dp, refresh])

  return { tasks, loading, error, refresh, addTask, update, complete, uncomplete, remove }
}

export function useProjects() {
  const dp = useDataProvider()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await dp.projects.list()
      setProjects(data)
    } catch {
      // Silently fail — table may not exist on first run before migration
    } finally {
      setLoading(false)
    }
  }, [dp])

  useEffect(() => {
    refresh()
  }, [refresh])

  const addProject = useCallback(async (name: string, color: string) => {
    try {
      const project = await dp.projects.create(name, color)
      setProjects((prev) => [...prev, project])
      return project
    } catch (e) {
      toast.error(`Failed to create project: ${e}`)
      return null
    }
  }, [dp])

  const renameProject = useCallback(async (id: string, name: string) => {
    try {
      await dp.projects.update(id, name)
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p))
    } catch (e) {
      toast.error(`Failed to rename project: ${e}`)
    }
  }, [dp])

  const updateProjectColor = useCallback(async (id: string, color: string) => {
    try {
      await dp.projects.update(id, undefined, color)
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, color } : p))
    } catch (e) {
      toast.error(`Failed to update color: ${e}`)
    }
  }, [dp])

  const removeProject = useCallback(async (id: string) => {
    try {
      await dp.projects.delete(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      toast.error(`Failed to delete project: ${e}`)
    }
  }, [dp])

  return { projects, loading, refresh, addProject, renameProject, updateProjectColor, removeProject }
}
