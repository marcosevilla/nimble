import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
  focused?: boolean
  onFocusRow?: () => void
  /** See LocalTaskRow `focusShortcut`. */
  focusShortcut?: boolean
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
  focused,
  onFocusRow,
  focusShortcut,
}: SortableTaskItemProps) {
  return (
    <SortableRow id={task.id}>
      {(dragHandleProps) => (
        <LocalTaskRow
          task={task}
          projectName={projectName}
          projectColor={projectColor}
          subtaskStats={subtaskStats}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          focused={focused}
          onFocusRow={onFocusRow}
          focusShortcut={focusShortcut}
          dragHandleProps={dragHandleProps}
        />
      )}
    </SortableRow>
  )
}

/** One sortable row: the dnd-kit wrapper every task list shares. The row
 * gets `dragHandleProps` (attributes + listeners) for its grip, so only the
 * grip — never the whole row — starts a drag (pointer or keyboard). */
export function SortableRow({
  id,
  children,
}: {
  id: string
  children: (dragHandleProps: Record<string, unknown>) => ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

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
      {children({ ...attributes, ...listeners })}
    </div>
  )
}

/** A flat, reorderable list of ids (pointer drag on the grip, or keyboard:
 * grip → Space → arrows → Space). Holds the order optimistically, persists
 * it with `dp.tasks.reorder(ids)` (position = index) and rolls back if that
 * fails. Used by SortableTaskList and the task detail page's subtasks. */
export function SortableRows({
  ids,
  onReordered,
  children,
}: {
  ids: string[]
  /** After the new order is persisted. */
  onReordered?: (ids: string[]) => void
  /** Renders the rows, in the current order, each inside a `SortableRow`. */
  children: (orderedIds: string[]) => ReactNode
}) {
  const dp = useDataProvider()
  const [items, setItems] = useState(ids)

  const idsKey = ids.join(',')
  useEffect(() => {
    setItems(idsKey ? idsKey.split(',') : [])
  }, [idsKey])

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
        onReordered?.(newItems)
      } catch {
        setItems(items)
      }
    },
    [items, dp, onReordered],
  )

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children(items)}
      </SortableContext>
    </DndContext>
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
  const topLevel = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks])

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

  const taskMap: Record<string, LocalTask> = {}
  for (const t of topLevel) taskMap[t.id] = t

  return (
    <SortableRows ids={topLevel.map((t) => t.id)}>
      {(items) => (
        /* No left gutter needed — the drag handle sits in the row's own
           hover cluster (TaskItem). Subtasks no longer render as nested rows
           here either (Marco QA round 3, item 2) — `subtaskMap` is only
           consulted for each row's `SubtaskSummary` count chip. */
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
      )}
    </SortableRows>
  )
}
