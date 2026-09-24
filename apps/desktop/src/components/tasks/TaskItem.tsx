import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { StatusDropdown } from './StatusDropdown'
import { useSelectionStore } from '@/stores/selectionStore'
import { focusSpaceAction } from '@/stores/focusStore'
import { SelectionCheckbox } from '@/components/shared/SelectionCheckbox'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { PriorityMark, DueMark, LabelMarks, ProjectMark, RowEndPicker, type RowMarkTask } from './RowMarks'
import { rowPickerKind, type RowPickerKind } from '@/lib/rowPickerKeys'
import { decideRowKey } from '@/lib/rowNav'
import { useRowPickerStore } from '@/stores/rowPickerStore'
import { dueBadgeLabel } from '@/lib/dueLabel'
import type { TaskStatus } from '@nimble/types'
import { CornerDownRight, ListTree, CheckCircle2, GripVertical } from 'lucide-react'

// ── Due Date Badge ──

/* No-guilt: a past date is not an alarm. Every date renders muted; only
   Today lifts to foreground. --destructive is reserved for destructive
   actions (see lib/task-view.ts "Still open" bucket). */
function DueDateBadge({ date }: { date: string }) {
  const label = dueBadgeLabel(date)
  const today = label === 'Today'

  /* Template literal (not cn) to dodge the tailwind-merge + custom-color
     gotcha that drops text-<size> when combined with text-foreground /
     text-muted-foreground. Both classes apply here because font-size and
     color target different CSS properties. */
  return (
    <span
      className={`shrink-0 text-meta tabular-nums ${
        today ? 'text-foreground' : 'text-muted-foreground'
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
  /* All done: count on text-foreground (success text on the /10 tint
     measured 4.47:1 in light); the success check icon carries the meaning.
     Template literal keeps text-label surviving next to text-muted-foreground;
     see DueDateBadge note above. */
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-label tabular-nums ${
        allDone ? 'bg-success/10 text-foreground' : 'bg-muted/60 text-muted-foreground'
      }`}
      aria-label={`${done} of ${total} subtasks complete`}
    >
      {allDone ? (
        <CheckCircle2 className="size-2.5 text-success" />
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
  /** Keyboard-focused row (j/k) — the tint. DOM focus is moved by
   * `useRowNavigation` (only on j/k), never by this prop, so a list change
   * can't pull focus out of a field (review C1). */
  focused?: boolean
  /** Id the list's `useRowNavigation` knows this row by (`data-nav-row`).
   * Defaults to the task id. */
  navId?: string
  /** Fired when the row itself receives DOM focus (Tab, click) so the
   * list's navigation index follows the user. */
  onFocusRow?: () => void
  className?: string
  /** dnd-kit `{...attributes, ...listeners}` from the sortable wrapper, spread
   * onto the grip so only the grip — not the whole row — initiates a drag. */
  dragHandleProps?: Record<string, unknown>
  /** Hides the grip slot entirely (not just its hover affordance) — used by
   * SectionedTaskList's non-section groupings (status/priority/due), where
   * drag reordering is disabled and a dead grip icon would be misleading.
   * Defaults to true so other call sites are unaffected. */
  showGrip?: boolean
  /** Hides the SelectionCheckbox entirely, for a surface with no bulk action
   * bar to act on the selection. Defaults to true. */
  selectable?: boolean
  /** Trailing row actions (focus-queue icon + overflow menu) rendered after
   * the metadata. Interactive children must stop click propagation. */
  actions?: ReactNode
  /** The task the row's marks edit. Given, the priority bars, due badge,
   * label chips and project name become buttons that open the detail
   * page's pickers (RowMarks.tsx); omitted, they stay plain marks (the
   * detail page's subtask rows). */
  markTask?: RowMarkTask
}

export function TaskItem({ task, onOpen, allIds, focused, navId, onFocusRow, className, dragHandleProps, showGrip = true, selectable = true, actions, markTask }: TaskItemProps) {
  const rowId = navId ?? task.id
  const titleId = useId()
  const isSelected = useSelectionStore((s) => s.selectedIds.has(task.id))
  const isCompleting = useSelectionStore((s) => s.completingTaskIds.has(task.id))

  const completed = task.completed || task.status === 'complete'
  const visibleLabels = task.labels?.slice(0, 2) ?? []
  const overflowCount = (task.labels?.length ?? 0) - visibleLabels.length
  /** Which marks the row shows: a row key opens its picker on the mark,
   * or on the row's right end when there is none (T2). Every priority has
   * a mark — Normal's is the empty glyph (Marco 2026-09-24). */
  const hasMark: Record<RowPickerKind, boolean> = {
    priority: true,
    due: !!task.dueDate,
    label: visibleLabels.length > 0,
    project: !!task.projectName,
  }

  /* The row is a focusable, named group, not role="button": a button's
     children are presentational, so the status menu, the grip, the
     checkbox and the mark buttons nested in it were invalid
     (axe nested-interactive). A group may hold controls. Enter/Space still
     open the task (below) and j/k/x/s/f come from useRowNavigation. */
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      tabIndex={0}
      data-nav-row={rowId}
      onClick={onOpen}
      onFocus={(e) => { if (e.target === e.currentTarget) onFocusRow?.() }}
      onKeyDown={(e) => {
        // p · ⇧D · l · m open this row's pickers (T2) — from the row or a
        // control in it, never from a field, an open popup (React bubbles
        // portal keys through here) or while another row picker is open.
        const pickerKind = markTask ? rowPickerKind(e) : null
        if (pickerKind) {
          const decision = decideRowKey(e.target, e.key)
          if (decision.handle && decision.rowId === rowId && !useRowPickerStore.getState().open) {
            e.preventDefault()
            useRowPickerStore.getState().openPicker(rowId, pickerKind, hasMark[pickerKind] ? 'mark' : 'row')
          }
          return
        }
        if (e.target !== e.currentTarget || !onOpen) return
        // Enter and Space open, as they did when the row was a button
        // (review I2). Space pauses a running focus session instead
        // (Dashboard).
        if (e.key === 'Enter' || (e.key === ' ' && !focusSpaceAction())) {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative flex h-9 items-center min-w-0 transition-colors hover:bg-hover cursor-default',
        // Inset ring: the row spans the column, so an outside offset would
        // paint over its neighbours.
        'focus-visible:-outline-offset-2',
        focused && 'bg-accent/10',
        isSelected && 'bg-accent-blue/10',
        isCompleting && 'animate-task-complete',
        className,
      )}
    >
      {/* Hover cluster — grip then checkbox, absolutely positioned so it
          never occupies an in-flow slot: the status icon's x is the same
          whether or not the cluster is revealed (Marco QA round 3, item 1).
          It lives in the strip left of the status icon — the column's 24px
          gutter plus the row's 32px content inset (Marco 2026-09-24 option A:
          +16px so the grip is a full 24×24 target). Hit areas abut, never
          overlap: grip [-22, +2), checkbox (24px ::after) [+2, +26), status
          trigger from +26 (its glyph at +32). It used to hang wholly outside
          the row (`right-full`), which at 1440 put the grip past the list's
          `overflow-x-hidden` scroller edge: clipped and unclickable
          (Agentation pass 3, C4). */}
      {(showGrip || selectable) && (
        <div className="absolute right-[calc(100%-1.375rem)] top-0 flex h-9 items-center gap-1">
          {/* dnd-kit's attributes make the grip a focusable button — so it
              reveals on focus-within too, never an invisible tab stop, and
              shows at once (no fade) when it holds keyboard focus itself.
              The ring is inset: the grip sits at the scroller's edge. */}
          {showGrip && (
            <button
              type="button"
              aria-label="Drag to reorder"
              className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:transition-none focus-visible:-outline-offset-2"
              onClick={(e) => e.stopPropagation()}
              {...dragHandleProps}
            >
              <GripVertical className="size-3" />
            </button>
          )}
          {selectable && <SelectionCheckbox id={task.id} type="task" allIds={allIds} />}
        </div>
      )}

      {/* Content — offset via margin (not padding) so the border below
          starts exactly at the status icon's left edge instead of under the
          gutter or the hover cluster. 32px: room for the cluster's 24px
          targets (Marco 2026-09-24 option A). */}
      <div className="flex flex-1 h-9 items-center gap-3 min-w-0 ml-8 border-b border-secondary">
        {/* Status (before priority per updated row anatomy) */}
        {task.source === 'local' && task.status ? (
          <StatusDropdown taskId={task.id} status={task.status} dueDate={task.dueDate} />
        ) : (
          <div className="w-4 shrink-0" />
        )}

        {/* Priority — every level has bars (Normal's are all empty), so
            every row with marks gets the clickable priority mark */}
        {markTask ? (
          <PriorityMark task={markTask} rowId={rowId} />
        ) : (
          <PriorityBars priority={task.priority} />
        )}

        {/* Subtask indicator */}
        {task.isSubtask && <SubtaskBadge />}

        {/* Task name — the whole row handles click/open, so this is plain text */}
        <span
          id={titleId}
          className={cn(
            'flex-1 min-w-0 truncate text-body',
            completed && 'text-muted-foreground line-through',
          )}
        >
          {task.content}
        </span>

        {/* Right side metadata. `pr-1` insets the cluster by the focus
            ring's footprint (2px inset offset + 2px width), so the focused
            row's ring never covers the last mark's text (T2 it2). */}
        <div className="ml-auto flex shrink-0 items-center gap-2 pr-1">
          {task.subtaskStats && task.subtaskStats.total > 0 && (
            <SubtaskSummary done={task.subtaskStats.done} total={task.subtaskStats.total} />
          )}
          {markTask ? (
            <LabelMarks task={markTask} rowId={rowId} visible={visibleLabels} overflow={Math.max(0, overflowCount)} />
          ) : (
            <>
              {visibleLabels.map((label, i) => (
                <LabelChipPill key={`${label.name}-${i}`} name={label.name} color={label.color} />
              ))}
              {overflowCount > 0 && <LabelChipPill name={`+${overflowCount}`} />}
            </>
          )}
          {/* Project badge — All Tasks mixes projects, so the row says which
              one it belongs to (tasks audit P2-1). Swatch is project data. */}
          {task.projectName && markTask ? (
            <ProjectMark task={markTask} rowId={rowId} name={task.projectName} color={task.projectColor} />
          ) : task.projectName && (
            <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
              {task.projectColor && (
                <span className="size-1.5 rounded-full" style={{ backgroundColor: task.projectColor }} />
              )}
              {task.projectName}
            </span>
          )}
          {task.dueDate && markTask ? (
            <DueMark task={markTask} rowId={rowId} date={task.dueDate} />
          ) : (
            task.dueDate && <DueDateBadge date={task.dueDate} />
          )}
          {actions}
        </div>
      </div>

      {markTask && <RowEndPicker task={markTask} rowId={rowId} />}
    </div>
  )
}
