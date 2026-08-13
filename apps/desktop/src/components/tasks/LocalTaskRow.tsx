import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useDetailStore } from '@/stores/detailStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { TaskItem } from './TaskItem'
import { TaskEditor } from './TaskEditor'
import { listLabels } from '@/services/tauri'
import { labelColor } from '@/lib/labelColors'
import type { LocalTask, Project, Label } from '@nimble/types'

// ── Labels cache ──
//
// Same label list `LabelPicker.tsx` fetches via `listLabels()`, shared at
// module scope so every visible row doesn't independently re-fetch the full
// label table. Invalidated by the same 'tasks-changed' event
// `emitTasksChanged` (hooks/useLocalTasks.ts) dispatches on any task
// mutation — labels can be created inline mid-session via LabelPicker.
//
// The invalidation listener is registered exactly ONCE at module scope (not
// once per mounted row) and rows subscribe to the shared cache instead of
// each re-fetching independently — otherwise N visible rows would each add
// their own listener and fire N near-simultaneous listLabels() IPC calls on
// every unrelated mutation (e.g. a single drag reorder).
const TASKS_CHANGED_EVENT = 'tasks-changed'

let labelsCache: Label[] | null = null
let labelsPromise: Promise<Label[]> | null = null
const labelsSubscribers = new Set<(labels: Label[]) => void>()

function notifyLabelsSubscribers(labels: Label[]) {
  labelsSubscribers.forEach((fn) => fn(labels))
}

function fetchLabels(force = false): Promise<Label[]> {
  if (force) {
    labelsCache = null
    labelsPromise = null
  }
  if (labelsCache) return Promise.resolve(labelsCache)
  if (!labelsPromise) {
    labelsPromise = listLabels()
      .then((ls) => {
        labelsCache = ls
        notifyLabelsSubscribers(ls)
        return ls
      })
      .catch((e) => {
        labelsPromise = null
        throw e
      })
  }
  return labelsPromise
}

if (typeof window !== 'undefined') {
  window.addEventListener(TASKS_CHANGED_EVENT, () => {
    fetchLabels(true).catch(() => {})
  })
}

function useLabelsMap(): Map<string, Label> {
  const [labels, setLabels] = useState<Label[]>(labelsCache ?? [])

  useEffect(() => {
    let cancelled = false
    labelsSubscribers.add(setLabels)
    if (labelsCache) {
      setLabels(labelsCache)
    } else {
      fetchLabels()
        .then((ls) => {
          if (!cancelled) setLabels(ls)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
      labelsSubscribers.delete(setLabels)
    }
  }, [])

  return useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
}

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
  /** dnd-kit `{...attributes, ...listeners}` from the sortable wrapper —
   * passed straight through to TaskItem's grip. Undefined outside a
   * sortable context (e.g. TodayPage's flat list). */
  dragHandleProps?: Record<string, unknown>
  /** Threaded straight through to TaskItem — see its doc comment. Defaults
   * to true so other call sites are unaffected. */
  showGrip?: boolean
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
  dragHandleProps,
  showGrip = true,
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

  const labelsMap = useLabelsMap()
  const taskLabels = useMemo(
    () =>
      task.labels
        .map((id) => labelsMap.get(id))
        .filter((l): l is Label => !!l)
        .map((l) => ({ name: l.name, color: labelColor(l.color) })),
    [task.labels, labelsMap],
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
        dragHandleProps={dragHandleProps}
        showGrip={showGrip}
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
