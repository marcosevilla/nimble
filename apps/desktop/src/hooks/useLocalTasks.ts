import { subscribeDataChanges } from '@/lib/dataChanges'
import { createListCache } from '@/lib/listCache'
import { ownsTodoistPush } from '@/lib/windowSignals'
import { displayedDueDate, rememberDisplayedTasks } from '@/lib/displayedTasks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDataProvider, getDataProvider } from '@/services/provider-context'
import type { LocalTask, Project } from '@nimble/types'
import { toast } from 'sonner'

// Simple event bus so all useLocalTasks instances refetch on any mutation
const TASKS_CHANGED = 'tasks-changed'

// Debounced Todoist push after local mutations: batches rapid-fire edits
// (e.g. typing, bulk reorders) into a single sync instead of one per
// keystroke. Quiet by design on failure — the outbox persists the pending
// ops, so the next trigger (interval/focus/another mutation) retries.
// Main window only: task writes from any window reach it as
// `nimble-data-changed` (provider-events), so one window pushes per edit.
let todoistSyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleTodoistPush() {
  if (!ownsTodoistPush(window.location.search)) return
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
  // The `dueDate` the current list was loaded for. `loading` is only true on
  // the first load, so after a date change this is how a caller knows the
  // list is still the previous day's.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const [listed, projects] = await Promise.all([
        dp.tasks.list({
          projectId: opts?.projectId,
          dueDate: opts?.dueDate,
          includeCompleted: opts?.includeCompleted ?? true,
        }),
        opts?.projectId ? Promise.resolve([]) : dp.projects.list().catch(() => []),
      ])
      // Tasks in an archived project are hidden everywhere, as in Todoist.
      const archived = new Set(projects.filter((p) => p.archived_at).map((p) => p.id))
      const data = archived.size ? listed.filter((t) => !archived.has(t.project_id)) : listed
      rememberDisplayedTasks(data)
      setTasks(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
      setLoadedFor(opts?.dueDate ?? null)
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
    async (content: string, extra?: { parentId?: string; projectId?: string; priority?: number; dueDate?: string; dueTime?: string; description?: string }) => {
      try {
        const task = await dp.tasks.create({
          content,
          projectId: extra?.projectId ?? opts?.projectId,
          parentId: extra?.parentId,
          priority: extra?.priority,
          dueDate: extra?.dueDate,
          dueTime: extra?.dueTime,
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
      await dp.tasks.complete(id, displayedDueDate(id) ?? null)
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

  return { tasks, loading, loadedFor, error, refresh, addTask, update, complete, uncomplete, remove }
}

// ── Shared active-projects list (row project pickers) ──
//
// Every task row mounts a project mark, and its menu mounts its items only
// while open — a per-open useProjects() would refetch the whole project list
// on each open and flash an empty menu first. The pickers share this
// module-scope cache instead: loaded on the first open, kept until a project
// or task change marks it stale (the stale list stays visible while the
// fresh one loads). Same shape as LocalTaskRow's labels cache.
const projectOptionsCache = createListCache<Project>(() => getDataProvider().projects.list())

if (typeof window !== 'undefined') {
  // Task changes cover Todoist/remote pulls, which can bring projects too.
  window.addEventListener(TASKS_CHANGED, () => projectOptionsCache.invalidate())
  subscribeDataChanges('projects', () => projectOptionsCache.invalidate())
}

/** Active projects for a picker; null until the first load resolves. */
export function useProjectOptions(): Project[] | null {
  const [all, setAll] = useState<Project[] | null>(() => projectOptionsCache.peek())

  useEffect(() => {
    const off = projectOptionsCache.subscribe(setAll)
    projectOptionsCache.load().catch(() => {})
    return off
  }, [])

  return useMemo(() => all?.filter((p) => !p.archived_at) ?? null, [all])
}

export function useProjects() {
  const dp = useDataProvider()
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await dp.projects.list()
      setAllProjects(data)
    } catch {
      // Silently fail — table may not exist on first run before migration
    } finally {
      setLoading(false)
    }
  }, [dp])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => subscribeDataChanges('projects', () => { void refresh() }), [refresh])

  const addProject = useCallback(async (name: string, color: string) => {
    try {
      const project = await dp.projects.create(name, color)
      setAllProjects((prev) => [...prev, project])
      projectOptionsCache.invalidate()
      return project
    } catch (e) {
      toast.error(`Failed to create project: ${e}`)
      return null
    }
  }, [dp])

  const renameProject = useCallback(async (id: string, name: string) => {
    try {
      await dp.projects.update(id, name)
      setAllProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p))
      projectOptionsCache.invalidate()
    } catch (e) {
      toast.error(`Failed to rename project: ${e}`)
    }
  }, [dp])

  const updateProjectColor = useCallback(async (id: string, color: string) => {
    try {
      await dp.projects.update(id, undefined, color)
      setAllProjects((prev) => prev.map((p) => p.id === id ? { ...p, color } : p))
      projectOptionsCache.invalidate()
    } catch (e) {
      toast.error(`Failed to update color: ${e}`)
    }
  }, [dp])

  const removeProject = useCallback(async (id: string) => {
    try {
      await dp.projects.delete(id)
      setAllProjects((prev) => prev.filter((p) => p.id !== id))
      projectOptionsCache.invalidate()
    } catch (e) {
      toast.error(`Failed to delete project: ${e}`)
    }
  }, [dp])

  // Active-only view for pickers/sidebars (move-to-project, new task
  // project, the project tree) — archived projects should never be a
  // choosable target. `allProjects` keeps every project, including
  // archived ones, so a task that still belongs to one can resolve its
  // name/color for display.
  const projects = useMemo(() => allProjects.filter((p) => !p.archived_at), [allProjects])

  return { projects, allProjects, loading, refresh, addProject, renameProject, updateProjectColor, removeProject }
}
