import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  useDroppable,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { SortableTaskItem } from './SortableTaskList'
import { LocalTaskRow } from './LocalTaskRow'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { useDataProvider } from '@/services/provider-context'
import { UNSECTIONED, type TaskGroup } from '@/lib/task-view'
import type { LocalTask } from '@nimble/types'

interface TaskLaneProps {
  containerId: string
  itemIds: string[]
  taskMap: Record<string, LocalTask>
  subtaskMap: Record<string, LocalTask[]>
  projectName?: string
  projectColor?: string
  dragEnabled: boolean
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  emptyLabel?: string
}

// One droppable + sortable lane. `useDroppable` is what makes an *empty*
// lane a valid drop target — `SortableContext` alone only creates droppable
// regions for the items it renders, so a section with zero tasks would
// otherwise be impossible to drop into. When `dragEnabled` is false (a
// status/priority/due grouping — Task 5), the lane renders as a plain,
// non-sortable list: no drop target, no grip, no drag context.
function TaskLane({
  containerId,
  itemIds,
  taskMap,
  subtaskMap,
  projectName,
  projectColor,
  dragEnabled,
  onDelete,
  onAddSubtask,
  emptyLabel,
}: TaskLaneProps) {
  const { setNodeRef } = useDroppable({ id: containerId, disabled: !dragEnabled })

  const rows = itemIds.flatMap((id) => {
    const task = taskMap[id]
    if (!task) return []
    const subtasks = subtaskMap[id] ?? []
    const done = subtasks.filter((s) => s.completed || s.status === 'complete').length
    const stats = subtasks.length > 0 ? { done, total: subtasks.length } : undefined

    return [
      <div key={id}>
        {dragEnabled ? (
          <SortableTaskItem
            task={task}
            projectName={projectName}
            projectColor={projectColor}
            subtaskStats={stats}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
          />
        ) : (
          <LocalTaskRow
            task={task}
            projectName={projectName}
            projectColor={projectColor}
            subtaskStats={stats}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            showGrip={false}
          />
        )}
      </div>,
      ...subtasks.map((sub) => (
        <div key={sub.id}>
          <LocalTaskRow
            task={sub}
            projectName={projectName}
            projectColor={projectColor}
            onDelete={onDelete}
            isSubtask
          />
        </div>
      )),
    ]
  })

  const body = (
    <div
      ref={dragEnabled ? setNodeRef : undefined}
      className="min-h-2"
    >
      {itemIds.length === 0 && emptyLabel && (
        <p className="py-2 text-label text-muted-foreground">{emptyLabel}</p>
      )}
      {rows}
    </div>
  )

  if (!dragEnabled) return body

  return (
    <SortableContext id={containerId} items={itemIds} strategy={verticalListSortingStrategy}>
      {body}
    </SortableContext>
  )
}

interface SectionedTaskListProps {
  /** Pre-grouped, pre-filtered lanes from `groupTasks()` (task-view.ts) —
   * top-level tasks only, in display order. */
  groups: TaskGroup[]
  /** Full flat task list (top-level + subtasks) the groups were drawn
   * from — used to resolve each visible row's subtasks, since subtasks
   * never appear as their own group members. */
  allTasks: LocalTask[]
  /** True for `section`/`manual` groupings only — every other grouping
   * (status/priority/due) is a read-only view: no cross-lane drag, no
   * grip. */
  dragEnabled: boolean
  projectName?: string
  projectColor?: string
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  onUpdated?: () => void
}

/** Task-list body grouped into lanes by whatever `GroupBy` the caller
 * resolved via `groupTasks()`. Cross-lane drag (section_id reassignment +
 * full-project reorder) only applies to section/manual groupings — see
 * `dragEnabled`. */
export function SectionedTaskList({
  groups,
  allTasks,
  dragEnabled,
  projectName,
  projectColor,
  onDelete,
  onAddSubtask,
  onUpdated,
}: SectionedTaskListProps) {
  const dp = useDataProvider()

  const containerOrder = useMemo(() => groups.map((g) => g.key), [groups])

  const computeContainers = useCallback((): Record<string, string[]> => {
    const map: Record<string, string[]> = {}
    for (const g of groups) map[g.key] = g.tasks.map((t) => t.id)
    return map
  }, [groups])

  const [containers, setContainers] = useState<Record<string, string[]>>(computeContainers)

  // Resync local lane state whenever the underlying groups actually change
  // (ids, their bucket, or the set of lanes) — not on every render, so an
  // in-flight optimistic drag isn't clobbered by an unrelated parent
  // re-render.
  const signature = useMemo(
    () => groups.map((g) => `${g.key}:${g.tasks.map((t) => t.id).join(',')}`).join('|'),
    [groups],
  )
  useEffect(() => {
    setContainers(computeContainers())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

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

  const taskMap = useMemo(() => {
    const map: Record<string, LocalTask> = {}
    for (const g of groups) for (const t of g.tasks) map[t.id] = t
    return map
  }, [groups])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findContainer = useCallback(
    (id: string): string | undefined => {
      if (id in containers) return id
      return containerOrder.find((key) => containers[key]?.includes(id))
    },
    [containers, containerOrder],
  )

  // `position` is a single ordinal sequence shared across the WHOLE
  // project (the flat "All Tasks" view sorts by it directly) — it is not
  // scoped per lane. `reorder_local_tasks` blindly assigns 0..N-1 to
  // exactly the ids it's given, so persisting only one lane's ids would
  // renumber that subset into 0..N-1 and collide with every other lane's
  // positions. Always splice the lanes back together in display order
  // (unsectioned first, then sections by position, each lane in its
  // current visual order) and persist that as one full-project list —
  // mirrors what the pre-section flat reorder call already sent.
  const buildFullOrder = useCallback(
    (map: Record<string, string[]>) => containerOrder.flatMap((key) => map[key] ?? []),
    [containerOrder],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return

      const activeId = active.id as string
      const overId = over.id as string
      const sourceContainer = findContainer(activeId)
      const destContainer = findContainer(overId)
      if (!sourceContainer || !destContainer) return

      const prevContainers = containers

      if (sourceContainer === destContainer) {
        const items = containers[sourceContainer]
        const oldIndex = items.indexOf(activeId)
        const newIndex = items.indexOf(overId)
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

        const newItems = arrayMove(items, oldIndex, newIndex)
        const newContainers = { ...containers, [sourceContainer]: newItems }
        setContainers(newContainers)

        try {
          await dp.tasks.reorder(buildFullOrder(newContainers))
        } catch {
          setContainers(prevContainers)
        }
        return
      }

      // Cross-lane move: pull the task out of its old lane, splice it into
      // the new one at the drop position.
      const sourceItems = containers[sourceContainer].filter((id) => id !== activeId)
      const destItems = [...containers[destContainer]]
      const overIndex = overId === destContainer ? destItems.length : destItems.indexOf(overId)
      destItems.splice(overIndex === -1 ? destItems.length : overIndex, 0, activeId)

      const newContainers = {
        ...containers,
        [sourceContainer]: sourceItems,
        [destContainer]: destItems,
      }
      setContainers(newContainers)

      try {
        if (destContainer === UNSECTIONED) {
          await dp.tasks.update({ id: activeId, clearSection: true })
        } else {
          await dp.tasks.update({ id: activeId, sectionId: destContainer })
        }
        // Persist positions for every lane, not just the destination — the
        // source lane's remainder needs re-numbering too, since it lost an
        // item and its old position values are no longer a clean sequence
        // relative to the rest of the project.
        await dp.tasks.reorder(buildFullOrder(newContainers))
        onUpdated?.()
      } catch {
        setContainers(prevContainers)
      }
    },
    [containers, findContainer, buildFullOrder, dp, onUpdated],
  )

  const lanes = (
    <div className="min-w-0">
      {groups.map((g) => {
        const itemIds = containers[g.key] ?? []

        const lane = (
          <TaskLane
            containerId={g.key}
            itemIds={itemIds}
            taskMap={taskMap}
            subtaskMap={subtaskMap}
            projectName={projectName}
            projectColor={projectColor}
            dragEnabled={dragEnabled}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            emptyLabel={dragEnabled ? 'No tasks in this section yet.' : undefined}
          />
        )

        // The unsectioned lane renders unlabeled at the top (no header) —
        // matches the pre-Task-5 section-lane view.
        if (g.key === UNSECTIONED) return <div key={g.key}>{lane}</div>

        const activeCount = itemIds.filter((id) => !taskMap[id]?.completed).length
        return (
          <CollapsibleSection key={g.key} title={g.title} count={activeCount} defaultOpen>
            {lane}
          </CollapsibleSection>
        )
      })}
    </div>
  )

  if (!dragEnabled) return lanes

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {lanes}
    </DndContext>
  )
}
