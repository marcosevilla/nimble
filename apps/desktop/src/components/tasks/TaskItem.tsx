import { cn } from '@/lib/utils'
import { StatusDropdown } from './StatusDropdown'
import { useSelectionStore } from '@/stores/selectionStore'
import { SelectionCheckbox } from '@/components/shared/SelectionCheckbox'
import { PriorityBars } from '@/components/shared/PriorityBars'
import type { TaskStatus } from '@daily-triage/types'
import { format, parseISO, isToday, isTomorrow, isPast } from 'date-fns'
import { CornerDownRight, ListTree, CheckCircle2 } from 'lucide-react'

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

// ── Project Badge ──

function ProjectBadge({ name, color }: { name: string; color?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-label text-muted-foreground">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color ?? '#6366f1' }}
      />
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
}

interface TaskItemProps {
  task: TaskItemData
  onContentClick?: () => void
  allIds?: string[]
  focused?: boolean
  className?: string
}

export function TaskItem({ task, onContentClick, allIds, focused, className }: TaskItemProps) {
  const isSelected = useSelectionStore((s) => s.selectedIds.has(task.id))
  const isCompleting = useSelectionStore((s) => s.completingTaskIds.has(task.id))

  return (
    <div
      className={cn(
        'group flex items-center gap-2 h-9 min-w-0 transition-colors hover:bg-accent/20',
        focused && 'bg-accent/10',
        isSelected && 'bg-accent-blue/10',
        isCompleting && 'animate-task-complete',
        className,
      )}
    >
      {/* Selection checkbox — in-flow so it can't overlap neighbouring
          content. Fades in on hover or when selection is active. */}
      <SelectionCheckbox id={task.id} type="task" allIds={allIds} />

      {/* Priority */}
      <PriorityBars priority={task.priority} />

      {/* Status */}
      {task.source === 'local' && task.status ? (
        <StatusDropdown taskId={task.id} status={task.status} />
      ) : (
        <div className="w-4 shrink-0" />
      )}

      {/* Subtask indicator */}
      {task.isSubtask && <SubtaskBadge />}

      {/* Task name */}
      {onContentClick ? (
        <button
          onClick={onContentClick}
          className={cn(
            'flex-1 min-w-0 truncate text-body text-left bg-transparent border-none cursor-pointer hover:text-foreground',
            (task.completed || task.status === 'complete') && 'text-muted-foreground line-through',
          )}
        >
          {task.content}
        </button>
      ) : (
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-body',
            (task.completed || task.status === 'complete') && 'text-muted-foreground line-through',
          )}
        >
          {task.content}
        </span>
      )}

      {/* Right side metadata — flush right */}
      <div className="flex shrink-0 items-center gap-2 ml-auto">
        {task.subtaskStats && task.subtaskStats.total > 0 && (
          <SubtaskSummary done={task.subtaskStats.done} total={task.subtaskStats.total} />
        )}
        {task.projectName && (
          <ProjectBadge name={task.projectName} color={task.projectColor ?? undefined} />
        )}
        {task.dueDate && <DueDateBadge date={task.dueDate} />}
      </div>
    </div>
  )
}
