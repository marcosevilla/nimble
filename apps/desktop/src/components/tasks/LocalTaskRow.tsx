import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useDetailStore } from '@/stores/detailStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { TaskItem } from './TaskItem'
import { TaskRowActions } from '@/components/focus/FocusTaskEntry'
import { labelColor } from '@/lib/labelColors'
import type { LocalTask } from '@nimble/types'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { orderTaskLabels } from '@/lib/labelTaxonomy'

interface LocalTaskRowProps {
  task: LocalTask
  projectName?: string
  projectColor?: string
  onDelete: (id: string) => void
  onAddSubtask?: (parentId: string, content: string) => void
  focused?: boolean
  /** See TaskItem `navId` (Inbox prefixes its row ids). */
  navId?: string
  /** See TaskItem `onFocusRow`. */
  onFocusRow?: () => void
  isSubtask?: boolean
  subtaskStats?: { done: number; total: number }
  /** dnd-kit `{...attributes, ...listeners}` from the sortable wrapper —
   * passed straight through to TaskItem's grip. Undefined outside a
   * sortable context (e.g. TodayPage's flat list). */
  dragHandleProps?: Record<string, unknown>
  /** Threaded straight through to TaskItem — see its doc comment. Defaults
   * to true so other call sites are unaffected. */
  showGrip?: boolean
  /** The list binds `f` (Focus now) — the row menu shows the hint. */
  focusShortcut?: boolean
}

export function LocalTaskRow({
  task,
  projectName,
  projectColor,
  onAddSubtask,
  focused,
  navId,
  onFocusRow,
  isSubtask,
  subtaskStats,
  dragHandleProps,
  showGrip = true,
  focusShortcut = false,
}: LocalTaskRowProps) {
  const addingSubtaskTo = useSelectionStore((s) => s.addingSubtaskTo)
  const setAddingSubtaskTo = useSelectionStore((s) => s.setAddingSubtaskTo)

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

  const { labels, groups } = useLabelTaxonomy()
  const taskLabels = useMemo(
    () => orderTaskLabels(task.labels, labels, groups).map((l) => ({ name: l.name, color: labelColor(l.color) })),
    [task.labels, labels, groups],
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
          labels: taskLabels,
        }}
        onOpen={() => useDetailStore.getState().openTask(task.id)}
        focused={focused}
        navId={navId}
        onFocusRow={onFocusRow}
        dragHandleProps={dragHandleProps}
        showGrip={showGrip}
        actions={<TaskRowActions task={task} focusShortcut={focusShortcut} />}
        markTask={task}
      />

      {showSubInput && onAddSubtask && (
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
