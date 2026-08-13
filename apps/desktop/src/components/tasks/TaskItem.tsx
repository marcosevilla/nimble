import { cn } from '@/lib/utils'
import { StatusDropdown } from './StatusDropdown'
import { useSelectionStore } from '@/stores/selectionStore'
import { SelectionCheckbox } from '@/components/shared/SelectionCheckbox'
import { PriorityBars } from '@/components/shared/PriorityBars'
import type { TaskStatus } from '@nimble/types'
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns'
import { CornerDownRight, ListTree, CheckCircle2, GripVertical } from 'lucide-react'

// ── Due Date Badge ──

function DueDateBadge({ date }: { date: string }) {
  const parsed = parseISO(date)
  const overdue = isPast(parsed) && !isToday(parsed)

  let label: string
  if (isToday(parsed)) label = 'Today'
  else if (isTomorrow(parsed)) label = 'Tomorrow'
  else label = format(parsed, 'MMM d')

  /* Template literal (not cn) to dodge the tailwind-merge + custom-color
     gotcha that drops text-<size> when combined with text-foreground /
     text-muted-foreground / text-destructive. Both classes apply here
     because font-size and color target different CSS properties. */
  return (
    <span
      className={`shrink-0 text-body tabular-nums ${
        overdue ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {label}
    </span>
  )
}

// ── Label chip ──

/* Dot color comes straight from label data (resolved by the caller from the
   backend's named-color palette) — the one sanctioned hardcoded-hex
   exception, since a label's swatch is inherently data-driven. */
function LabelChipPill({ name, color }: { name: string; color?: string }) {
  return (
    <span className="flex h-5 shrink-0 items-center gap-[5px] rounded-full bg-secondary px-2 text-meta text-muted-foreground">
      {color && (
        <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      )}
      {name}
    </span>
  )
}

// ── Subtask / parent indicators ──

export function SubtaskBadge() {
  return (
    <CornerDownRight
      className="size-3 shrink-0 text-muted-foreground"
      aria-label="Subtask"
    />
  )
}

export function SubtaskSummary({ done, total }: { done: number; total: number }) {
  const allDone = done === total && total > 0
  /* Template literal keeps text-label surviving next to text-muted-foreground;
     see DueDateBadge note above. */
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-label tabular-nums ${
        allDone ? 'bg-green-500/10 text-green-500' : 'bg-muted/60 text-muted-foreground'
      }`}
      aria-label={`${done} of ${total} subtasks complete`}
    >
      {allDone ? (
        <CheckCircle2 className="size-2.5" />
      ) : (
        <ListTree className="size-2.5" />
      )}
      {done}/{total}
    </span>
  )
}

// ── Unified Task Item ──

export interface TaskItemData {
  id: string
  content: string
  priority: number
  completed: boolean
  status?: TaskStatus
  dueDate?: string | null
  projectName?: string | null
  projectColor?: string | null
  description?: string | null
  source: 'local' | 'todoist'
  isSubtask?: boolean
  subtaskStats?: { done: number; total: number }
  labels?: { name: string; color: string }[]
}

interface TaskItemProps {
  task: TaskItemData
  /** Fired on click anywhere in the row body — opens task details. Interactive
   * children (grip, checkbox, status) stop propagation so they don't trigger it. */
  onOpen?: () => void
  allIds?: string[]
  focused?: boolean
  className?: string
  /** dnd-kit `{...attributes, ...listeners}` from the sortable wrapper, spread
   * onto the grip so only the grip — not the whole row — initiates a drag. */
  dragHandleProps?: Record<string, unknown>
  /** Hides the grip slot entirely (not just its hover affordance) — used by
   * SectionedTaskList's non-section groupings (status/priority/due), where
   * drag reordering is disabled and a dead grip icon would be misleading.
   * Defaults to true so other call sites are unaffected. */
  showGrip?: boolean
  /** Hides the SelectionCheckbox entirely — used by TaskDetailPage's subtask
   * rows, which have no action bar mountable in body-mode detail (BulkActionBar
   * is gated to the tasks list page, SelectionActionBar lives on list pages
   * that are unmounted here), so a hover-revealed checkbox there would be a
   * dead end only escapable via Escape. Defaults to true so list-page call
   * sites keep selecting. */
  selectable?: boolean
}

export function TaskItem({ task, onOpen, allIds, focused, className, dragHandleProps, showGrip = true, selectable = true }: TaskItemProps) {
  const isSelected = useSelectionStore((s) => s.selectedIds.has(task.id))
  const isCompleting = useSelectionStore((s) => s.completingTaskIds.has(task.id))

  const completed = task.completed || task.status === 'complete'
  const visibleLabels = task.labels?.slice(0, 2) ?? []
  const overflowCount = (task.labels?.length ?? 0) - visibleLabels.length

  return (
    <div
      onClick={onOpen}
      className={cn(
        'group relative flex h-10 items-center min-w-0 transition-colors hover:bg-accent/20 cursor-default',
        focused && 'bg-accent/10',
        isSelected && 'bg-accent-blue/10',
        isCompleting && 'animate-task-complete',
        className,
      )}
    >
      {/* Hover cluster — grip then checkbox, absolutely positioned to hang
          OUTSIDE the list column to the left (Marco QA round 3, item 1).
          They no longer occupy in-flow slots, so the status icon below stays
          flush with the section/page title's `pl-4` left edge whether or
          not the cluster is revealed. `right-full` pins the cluster's right
          edge to this row's own left edge (before the content's `ml-4`), so
          it never nudges the border or the status icon. */}
      {(showGrip || selectable) && (
        <div className="absolute right-full top-0 flex h-10 items-center gap-1 pr-2">
          {showGrip && (
            <GripVertical
              aria-label="Drag to reorder"
              className="size-3 shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
              {...dragHandleProps}
            />
          )}
          {selectable && <SelectionCheckbox id={task.id} type="task" allIds={allIds} />}
        </div>
      )}

      {/* Content — offset via margin (not padding) so the border below
          starts exactly at the status icon's left edge (matching the
          section/page title's `pl-4` inset) instead of under the gutter or
          the overhanging hover cluster. */}
      <div className="flex flex-1 h-10 items-center gap-3 min-w-0 ml-4 border-b border-secondary">
        {/* Status (before priority per updated row anatomy) */}
        {task.source === 'local' && task.status ? (
          <StatusDropdown taskId={task.id} status={task.status} />
        ) : (
          <div className="w-4 shrink-0" />
        )}

        {/* Priority */}
        <PriorityBars priority={task.priority} />

        {/* Subtask indicator */}
        {task.isSubtask && <SubtaskBadge />}

        {/* Task name — the whole row handles click/open, so this is plain text */}
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-body',
            completed && 'text-muted-foreground line-through',
          )}
        >
          {task.content}
        </span>

        {/* Right side metadata — flush right */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {task.subtaskStats && task.subtaskStats.total > 0 && (
            <SubtaskSummary done={task.subtaskStats.done} total={task.subtaskStats.total} />
          )}
          {visibleLabels.map((label, i) => (
            <LabelChipPill key={`${label.name}-${i}`} name={label.name} color={label.color} />
          ))}
          {overflowCount > 0 && <LabelChipPill name={`+${overflowCount}`} />}
          {task.dueDate && <DueDateBadge date={task.dueDate} />}
        </div>
      </div>
    </div>
  )
}
