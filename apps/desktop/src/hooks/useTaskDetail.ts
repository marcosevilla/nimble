import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type { LocalTask, Project } from '@nimble/types'

interface TaskDetail {
  task: LocalTask | null
  subtasks: LocalTask[]
  project: Project | null
  loading: boolean
  refresh: () => void
}

export function useTaskDetail(taskId: string | null): TaskDetail {
  const dp = useDataProvider()
  const [task, setTask] = useState<LocalTask | null>(null)
  const [subtasks, setSubtasks] = useState<LocalTask[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!taskId) {
      setTask(null)
      setSubtasks([])
      setProject(null)
      setLoading(false)
      return
    }

    try {
      // Fetch all tasks to find this one + its subtasks
      const allTasks = await dp.tasks.list({ includeCompleted: true })
      const found = allTasks.find((t) => t.id === taskId) ?? null
      setTask(found)

      // Find subtasks
      const subs = allTasks
        .filter((t) => t.parent_id === taskId)
        .sort((a, b) => a.position - b.position)
      setSubtasks(subs)

      // Find project
      if (found) {
        const projects = await dp.projects.list()
        setProject(projects.find((p) => p.id === found.project_id) ?? null)
      }
    } catch {
      setTask(null)
      setSubtasks([])
    } finally {
      setLoading(false)
    }
  }, [dp, taskId])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  // Listen for task changes
  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('tasks-changed', handler)
    return () => window.removeEventListener('tasks-changed', handler)
  }, [refresh])

  return { task, subtasks, project, loading, refresh }
}
