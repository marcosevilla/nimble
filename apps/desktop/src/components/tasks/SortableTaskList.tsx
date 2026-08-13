import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LocalTaskRow } from './LocalTaskRow'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import type { LocalTask } from '@nimble/types'

interface SortableTaskItemProps {
  task: LocalTask
  projectName?: string
  projectColor?: string
  subtaskStats?: { done: number; total: number }
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
}

// Exported so SectionedTaskList (Task 14's section-lane view) can reuse the
// same drag-handle-plus-row markup instead of duplicating it.
export function SortableTaskItem({
  task,
  projectName,
  projectColor,
  subtaskStats,
  onDelete,
  onAddSubtask,
}: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  // Override dnd-kit's default ease with our canonical entrance curve so
  // displaced neighbours settle into place instead of snapping linearly.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition
      ? transition.replace(/cubic-bezier\([^)]+\)|ease[\w-]*/, 'cubic-bezier(0.16, 1, 0.3, 1)')
      : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative',
        isDragging && 'z-10 opacity-80 bg-accent/30 rounded-md',
      )}
    >
      {/* Only the row's grip (rendered inside TaskItem via dragHandleProps)
          initiates a drag — listeners are not spread on this container. */}
      <LocalTaskRow
        task={task}
        projectName={projectName}
        projectColor={projectColor}
        subtaskStats={subtaskStats}
        onDelete={onDelete}
        onAddSubtask={onAddSubtask}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

interface SortableTaskListProps {
  tasks: LocalTask[]
  allTasks: LocalTask[]
  projectName?: string
  projectColor?: string
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
}

export function SortableTaskList({
  tasks,
  allTasks,
  projectName,
  projectColor,
  onDelete,
  onAddSubtask,
}: SortableTaskListProps) {
  const dp = useDataProvider()
  const topLevel = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks])
  const [items, setItems] = useState(topLevel.map((t) => t.id))

  const topLevelIds = useMemo(() => topLevel.map((t) => t.id).join(','), [topLevel])
  useEffect(() => {
    setItems(topLevel.map((t) => t.id))
  }, [topLevelIds])

  // Build subtask map from the full task set (not just this project slice) so
  // subtasks of parents-in-this-list are found even if the hook only fetched
  // top-level tasks.
  const subtaskMap = useMemo(() => {
    const map: Record<string, LocalTask[]> = {}
    for (const t of allTasks) {
      if (t.parent_id) {
        if (!map[t.parent_id]) map[t.parent_id] = []
        map[t.parent_id].push(t)
      }
    }
    return map
  }, [allTasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = items.indexOf(active.id as string)
      const newIndex = items.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return

      const newItems = [...items]
      newItems.splice(oldIndex, 1)
      newItems.splice(newIndex, 0, active.id as string)
      setItems(newItems)

      try {
        await dp.tasks.reorder(newItems)
      } catch {
        setItems(items)
      }
    },
    [items, dp],
  )

  const taskMap: Record<string, LocalTask> = {}
  for (const t of topLevel) taskMap[t.id] = t

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {/* No left gutter needed — the drag handle is now absolutely
            positioned outside the row (TaskItem's hover cluster). Subtasks
            no longer render as nested rows here either (Marco QA round 3,
            item 2) — `subtaskMap` is only consulted for each row's
            `SubtaskSummary` count chip. */}
        <div>
          {items.flatMap((id) => {
            const task = taskMap[id]
            if (!task) return []
            const subtasks = subtaskMap[id] ?? []
            const done = subtasks.filter(
              (s) => s.completed || s.status === 'complete',
            ).length
            const stats = subtasks.length > 0
              ? { done, total: subtasks.length }
              : undefined

            return [
              <div key={id}>
                <SortableTaskItem
                  task={task}
                  projectName={projectName}
                  projectColor={projectColor}
                  subtaskStats={stats}
                  onDelete={onDelete}
                  onAddSubtask={onAddSubtask}
                />
              </div>,
            ]
          })}
        </div>
      </SortableContext>
    </DndContext>
  )
}
