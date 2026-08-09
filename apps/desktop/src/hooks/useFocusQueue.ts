import { useMemo } from 'react'
import { useLocalTasks } from '@/hooks/useLocalTasks'
import type { LocalTask } from '@nimble/types'

export function useFocusQueue(currentTask: LocalTask | null): LocalTask | null {
  const { tasks } = useLocalTasks()

  return useMemo(() => {
    if (!currentTask) return null

    const incomplete = tasks.filter((t) => !t.completed)

    // 1. If task has incomplete subtasks → first subtask by position
    const subtasks = incomplete
      .filter((t) => t.parent_id === currentTask.id)
      .sort((a, b) => a.position - b.position)
    if (subtasks.length > 0) return subtasks[0]

    // 2. If task is a subtask → next sibling by position
    if (currentTask.parent_id) {
      const siblings = incomplete
        .filter((t) => t.parent_id === currentTask.parent_id && t.id !== currentTask.id)
        .sort((a, b) => a.position - b.position)
      const nextSibling = siblings.find((t) => t.position > currentTask.position)
      if (nextSibling) return nextSibling
      if (siblings.length > 0) return siblings[0]
    }

    // 3. Next incomplete top-level task in same project by position
    const sameProject = incomplete
      .filter((t) => t.project_id === currentTask.project_id && !t.parent_id && t.id !== currentTask.id)
      .sort((a, b) => a.position - b.position)
    const nextInProject = sameProject.find((t) => t.position > currentTask.position)
    if (nextInProject) return nextInProject
    if (sameProject.length > 0) return sameProject[0]

    // 4. No more tasks in project
    return null
  }, [currentTask, tasks])
}
