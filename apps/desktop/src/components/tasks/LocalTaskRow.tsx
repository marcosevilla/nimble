import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useDetailStore } from '@/stores/detailStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { TaskItem } from './TaskItem'
import { TaskEditor } from './TaskEditor'
import type { LocalTask, Project } from '@nimble/types'

interface LocalTaskRowProps {
  task: LocalTask
  projects?: Project[]
  projectName?: string
  projectColor?: string
  onDelete: (id: string) => void
  onAddSubtask?: (parentId: string, content: string) => void
  onUpdated?: (task: LocalTask) => void
  focused?: boolean
  isSubtask?: boolean
  subtaskStats?: { done: number; total: number }
}

export function LocalTaskRow({
  task,
  projects = [],
  projectName,
  projectColor,
  onAddSubtask,
  onUpdated,
  focused,
  isSubtask,
  subtaskStats,
}: LocalTaskRowProps) {
  const editingTaskId = useSelectionStore((s) => s.editingTaskId)
  const addingSubtaskTo = useSelectionStore((s) => s.addingSubtaskTo)
  const setEditingTask = useSelectionStore((s) => s.setEditingTask)
  const setAddingSubtaskTo = useSelectionStore((s) => s.setAddingSubtaskTo)

  const editing = editingTaskId === task.id
  const showSubInput = addingSubtaskTo === task.id

  const [subInput, setSubInput] = useState('')

  // Reset the subtask input buffer whenever the signal toggles for this row
  useEffect(() => {
    if (showSubInput) setSubInput('')
  }, [showSubInput])

  const handleSubSubmit = useCallback(() => {
    const text = subInput.trim()
    if (!text || !onAddSubtask) return
    onAddSubtask(task.id, text)
    setSubInput('')
    setAddingSubtaskTo(null)
  }, [subInput, task.id, onAddSubtask, setAddingSubtaskTo])

  const handleUpdated = useCallback(
    (updated: LocalTask) => {
      onUpdated?.(updated)
      setEditingTask(null)
    },
    [onUpdated, setEditingTask],
  )

  return (
    <div>
      <TaskItem
        task={{
          id: task.id,
          content: task.content,
          priority: task.priority,
          completed: task.completed,
          status: task.status,
          dueDate: task.due_date,
          projectName: projectName,
          projectColor: projectColor,
          description: task.description,
          source: 'local',
          isSubtask,
          subtaskStats,
        }}
        onContentClick={() => useDetailStore.getState().openTask(task.id)}
        focused={focused}
      />

      {editing && (
        <div className="mt-1 mb-2">
          <TaskEditor
            task={task}
            projects={projects}
            onClose={() => setEditingTask(null)}
            onUpdated={handleUpdated}
          />
        </div>
      )}

      {showSubInput && !editing && onAddSubtask && (
        <div className="mt-0.5 mb-0.5">
          <Input
            value={subInput}
            onChange={(e) => setSubInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubSubmit()
              if (e.key === 'Escape') {
                setAddingSubtaskTo(null)
                setSubInput('')
              }
            }}
            placeholder="Add subtask..."
            className="h-7 text-body"
            autoFocus
          />
        </div>
      )}
    </div>
  )
}
