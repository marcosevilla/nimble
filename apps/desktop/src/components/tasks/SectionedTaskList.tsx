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
import type { LocalTask, Project, Section } from '@nimble/types'

// Sentinel container id for tasks with no section — distinct from any real
// section id (uuids), so it can share the same id-namespace as the section
// buckets in `containers` below without risk of collision.
const UNSECTIONED = '__unsectioned__'

interface TaskLaneProps {
  containerId: string
  itemIds: string[]
  taskMap: Record<string, LocalTask>
  subtaskMap: Record<string, LocalTask[]>
  projects: Project[]
  projectName?: string
  projectColor?: string
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  onUpdated?: () => void
  emptyLabel?: string
}

// One droppable + sortable lane. `useDroppable` is what makes an *empty*
// lane a valid drop target — `SortableContext` alone only creates droppable
// regions for the items it renders, so a section with zero tasks would
// otherwise be impossible to drop into.
function TaskLane({
  containerId,
  itemIds,
  taskMap,
  subtaskMap,
  projects,
  projectName,
  projectColor,
  onDelete,
  onAddSubtask,
  onUpdated,
  emptyLabel,
}: TaskLaneProps) {
  const { setNodeRef } = useDroppable({ id: containerId })

  return (
    <SortableContext id={containerId} items={itemIds} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="divide-y divide-border/20 pl-5 min-h-2">
        {itemIds.length === 0 && emptyLabel && (
          <p className="py-2 text-label text-muted-foreground">{emptyLabel}</p>
        )}
        {itemIds.flatMap((id) => {
          const task = taskMap[id]
          if (!task) return []
          const subtasks = subtaskMap[id] ?? []
          const done = subtasks.filter((s) => s.completed || s.status === 'complete').length
          const stats = subtasks.length > 0 ? { done, total: subtasks.length } : undefined

          return [
            <div key={id}>
              <SortableTaskItem
                task={task}
                projects={projects}
                projectName={projectName}
                projectColor={projectColor}
                subtaskStats={stats}
                onDelete={onDelete}
                onAddSubtask={onAddSubtask}
                onUpdated={onUpdated}
              />
            </div>,
            ...subtasks.map((sub) => (
              <div key={sub.id}>
                <LocalTaskRow
                  task={sub}
                  projects={projects}
                  projectName={projectName}
                  projectColor={projectColor}
                  onDelete={onDelete}
                  onUpdated={onUpdated}
                  isSubtask
                />
              </div>
            )),
          ]
        })}
      </div>
    </SortableContext>
  )
}

interface SectionedTaskListProps {
  tasks: LocalTask[]
  sections: Section[]
  projects: Project[]
  projectName?: string
  projectColor?: string
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  onUpdated?: () => void
}

/** Project-detail task list grouped into section lanes: unsectioned tasks
 * first, then sections ordered by `position`. Cross-lane drag sets
 * `section_id` via the update wrapper; same-lane drag reorders via the
 * existing `reorder` wrapper, scoped to that lane's ids. */
export function SectionedTaskList({
  tasks,
  sections,
  projects,
  projectName,
  projectColor,
  onDelete,
  onAddSubtask,
  onUpdated,
}: SectionedTaskListProps) {
  const dp = useDataProvider()

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.position - b.position),
    [sections],
  )

  const containerOrder = useMemo(
    () => [UNSECTIONED, ...sortedSections.map((s) => s.id)],
    [sortedSections],
  )

  const topLevel = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks])

  const computeContainers = useCallback((): Record<string, string[]> => {
    const map: Record<string, string[]> = {}
    for (const key of containerOrder) map[key] = []
    for (const t of topLevel) {
      const key = t.section_id && map[t.section_id] ? t.section_id : UNSECTIONED
      map[key].push(t.id)
    }
    return map
  }, [topLevel, containerOrder])

  const [containers, setContainers] = useState<Record<string, string[]>>(computeContainers)

  // Resync local lane state whenever the underlying task/section data
  // actually changes (ids, their section_id, or the set of lanes) — not on
  // every render, so an in-flight optimistic drag isn't clobbered by an
  // unrelated parent re-render.
  const signature = useMemo(
    () =>
      topLevel.map((t) => `${t.id}:${t.section_id ?? ''}`).join(',') + '|' + containerOrder.join(','),
    [topLevel, containerOrder],
  )
  useEffect(() => {
    setContainers(computeContainers())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const subtaskMap = useMemo(() => {
    const map: Record<string, LocalTask[]> = {}
    for (const t of tasks) {
      if (t.parent_id) {
        if (!map[t.parent_id]) map[t.parent_id] = []
        map[t.parent_id].push(t)
      }
    }
    return map
  }, [tasks])

  const taskMap = useMemo(() => {
    const map: Record<string, LocalTask> = {}
    for (const t of topLevel) map[t.id] = t
    return map
  }, [topLevel])

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
        setContainers((prev) => ({ ...prev, [sourceContainer]: newItems }))

        try {
          await dp.tasks.reorder(newItems)
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

      setContainers((prev) => ({
        ...prev,
        [sourceContainer]: sourceItems,
        [destContainer]: destItems,
      }))

      try {
        if (destContainer === UNSECTIONED) {
          await dp.tasks.update({ id: activeId, clearSection: true })
        } else {
          await dp.tasks.update({ id: activeId, sectionId: destContainer })
        }
        await dp.tasks.reorder(destItems)
        onUpdated?.()
      } catch {
        setContainers(prevContainers)
      }
    },
    [containers, findContainer, dp, onUpdated],
  )

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        <TaskLane
          containerId={UNSECTIONED}
          itemIds={containers[UNSECTIONED] ?? []}
          taskMap={taskMap}
          subtaskMap={subtaskMap}
          projects={projects}
          projectName={projectName}
          projectColor={projectColor}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          onUpdated={onUpdated}
        />

        {sortedSections.map((section) => {
          const itemIds = containers[section.id] ?? []
          const activeCount = itemIds.filter((id) => !taskMap[id]?.completed).length
          return (
            <CollapsibleSection key={section.id} title={section.name} count={activeCount} defaultOpen>
              <TaskLane
                containerId={section.id}
                itemIds={itemIds}
                taskMap={taskMap}
                subtaskMap={subtaskMap}
                projects={projects}
                projectName={projectName}
                projectColor={projectColor}
                onDelete={onDelete}
                onAddSubtask={onAddSubtask}
                onUpdated={onUpdated}
                emptyLabel="No tasks in this section yet."
              />
            </CollapsibleSection>
          )
        })}
      </div>
    </DndContext>
  )
}
