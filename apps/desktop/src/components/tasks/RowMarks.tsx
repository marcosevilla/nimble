import { useCallback, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged, useProjectOptions } from '@/hooks/useLocalTasks'
import { taskToast } from '@/lib/taskToast'
import { rowMarkName, type RowMarkKind } from '@/lib/rowMarks'
import { dueBadgeLabel } from '@/lib/dueLabel'
import { taskPatchToUpdate, type TaskPatch } from '@/lib/taskPatch'
import { useRowPicker, useRowPickerStore } from '@/stores/rowPickerStore'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { Skeleton } from '@/components/ui/skeleton'
import { PriorityMenu, LabelsPopover, EntityMenuItems } from '@/components/tasks/MetadataChips'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DueDatePopover, type DueValue } from '@/components/tasks/DueDatePopover'
import type { LocalTask } from '@nimble/types'

/* Clickable row marks (loop 2 chunk 3, T1). Each mark on a task row —
   priority bars, due badge, label chips, project name — is its own button
   that opens the same picker the task detail page uses (PriorityMenu,
   DueDatePopover, LabelsPopover, EntityMenu), so a later detail redesign
   flows through to the rows.

   Shared rules for every mark:
   - The click stops at the mark (and at its popup, which React bubbles
     through the row despite the portal), so it never opens the task or
     touches selection.
   - Open state lives in `useRowPickerStore`, keyed by the row's
     `data-nav-row` id and the mark kind, so T2's row keys can open the
     same picker without a click.
   - Closing (a pick or Escape) hands focus to the row, not the mark, so
     j/k continue from there (StatusDropdown's rule).
   - The mark's box never moves the row: marks that need a bigger target
     than their glyph grow it with negative margin (the StatusDropdown
     trick) or an ::after hit extender, so the row stays 36px and every
     text sits where it did. Nothing may poke past the row's right end:
     the list wrapper clips there, and a focused or hovered control that
     overflows it scrolls the whole list sideways. */

/** Row-mark subset of a task; LocalTaskRow passes the full LocalTask. */
export type RowMarkTask = Pick<
  LocalTask,
  'id' | 'priority' | 'due_date' | 'due_time' | 'duration_minutes' | 'recurrence_rule' | 'labels' | 'project_id'
>

/** Shared mark chrome: pointer, and an ::after that grows the target to
 * at least 32px tall (square, so rounded corners don't cut the hit area). */
const MARK =
  "relative shrink-0 cursor-pointer transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']"

/** Text marks (due, project) end the row's right cluster, so they can't
 * grow a padded hover box; they lift to foreground and underline. */
const TEXT_MARK =
  'flex h-6 items-center decoration-muted-foreground/60 underline-offset-4 hover:text-foreground hover:underline'

const stop = (e: MouseEvent) => e.stopPropagation()

/** Focus target when a mark's picker closes: the mark's row. */
function useRowFocus(rowId: string, triggerRef: RefObject<HTMLElement | null>) {
  return useCallback(
    () =>
      triggerRef.current?.closest<HTMLElement>('[data-nav-row]') ??
      document.querySelector<HTMLElement>(`[data-nav-row="${CSS.escape(rowId)}"]`) ??
      true,
    [rowId, triggerRef],
  )
}

/** One patch → dp.tasks.update → emitTasksChanged, the detail page's path. */
function useTaskMarkUpdate(task: RowMarkTask) {
  const dp = useDataProvider()
  return useCallback(
    async (patch: TaskPatch) => {
      const updates = taskPatchToUpdate(task, patch)
      if (!updates) return false
      try {
        await dp.tasks.update(updates)
        emitTasksChanged()
        return true
      } catch (e) {
        toast.error(`Failed to update task: ${e}`)
        return false
      }
    },
    [task, dp],
  )
}

interface MarkProps {
  task: RowMarkTask
  /** The row's `data-nav-row` id (Inbox prefixes it). */
  rowId: string
}

// ── Priority ──

/** Bars for Medium/High/Urgent. Normal has no bars, so no mark. The button
 * is 24×24 around the 12×8 bars; -mx-1.5/-my-2 hands the extra back so the
 * row lays out exactly as the bare bars did. */
export function PriorityMark({ task, rowId }: MarkProps) {
  const { open, onOpenChange } = useRowPicker(rowId, 'priority')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const finalFocus = useRowFocus(rowId, triggerRef)
  const update = useTaskMarkUpdate(task)

  return (
    <PriorityMenu
      open={open}
      onOpenChange={onOpenChange}
      onChange={(priority) => void update({ priority })}
      triggerProps={{
        ref: triggerRef,
        'aria-label': rowMarkName({ kind: 'priority', priority: task.priority }),
        className: cn(MARK, '-mx-1.5 -my-2 flex size-6 items-center justify-center rounded-md hover:bg-hover'),
        onClick: stop,
      }}
      contentProps={{ finalFocus, onClick: stop }}
    >
      <PriorityBars priority={task.priority} />
    </PriorityMenu>
  )
}

// ── Due ──

/** The due badge. Muted by default, Today lifts to foreground (no-guilt:
 * a past date is not an alarm). The button is the old badge's box. */
export function DueMark({ task, rowId, date }: MarkProps & { date: string }) {
  const { open, onOpenChange } = useRowPicker(rowId, 'due')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const finalFocus = useRowFocus(rowId, triggerRef)
  const update = useTaskMarkUpdate(task)
  const label = dueBadgeLabel(date)
  const today = label === 'Today'

  const value: DueValue = {
    dueDate: date,
    dueTime: task.due_time ?? null,
    durationMinutes: task.duration_minutes ?? null,
    recurrenceRule: task.recurrence_rule ?? null,
  }

  return (
    <DueDatePopover
      value={value}
      // A new day is the pick that closes the picker; time, duration and
      // repeat edits keep it open like on the detail page.
      onChange={(next) => {
        if (next.dueDate !== value.dueDate) onOpenChange(false)
        void update({ due: next })
      }}
      open={open}
      onOpenChange={onOpenChange}
      triggerProps={{
        ref: triggerRef,
        'aria-label': rowMarkName({ kind: 'due', label }),
        className: cn(MARK, TEXT_MARK, 'text-meta tabular-nums', today ? 'text-foreground' : 'text-muted-foreground'),
        onClick: stop,
      }}
      contentProps={{ align: 'end', finalFocus, onClick: stop }}
    >
      {label}
    </DueDatePopover>
  )
}

// ── Labels ──

/** Label chips (first two) plus the `+N` overflow chip. Every chip opens
 * the one label picker, anchored to the chip that was clicked (a row key
 * opens it on the first). Ticking a label keeps the picker open. */
export function LabelMarks({
  task,
  rowId,
  visible,
  overflow,
}: MarkProps & {
  visible: { name: string; color?: string }[]
  overflow: number
}) {
  const { open, onOpenChange } = useRowPicker(rowId, 'label')
  const [anchor, setAnchor] = useState(0)
  const triggerRef = useRef<HTMLElement | null>(null)
  const finalFocus = useRowFocus(rowId, triggerRef)
  const update = useTaskMarkUpdate(task)

  const chips: { key: string; name: string; color?: string; ariaLabel: string }[] = visible.map((l, i) => ({
    key: `${l.name}-${i}`,
    name: l.name,
    color: l.color,
    ariaLabel: rowMarkName({ kind: 'label', name: l.name }),
  }))
  if (overflow > 0) chips.push({ key: 'overflow', name: `+${overflow}`, ariaLabel: `${overflow} more labels` })

  return (
    <>
      {chips.map((chip, i) => (
        <LabelsPopover
          key={chip.key}
          value={task.labels}
          onChange={(labelIds) => void update({ labelIds })}
          open={open && Math.min(anchor, chips.length - 1) === i}
          onOpenChange={(next) => {
            // A click anchors on its chip; after a close the next open (a
            // row key) starts from the first chip again.
            setAnchor(next ? i : 0)
            onOpenChange(next)
          }}
          triggerProps={{
            ref: (el: HTMLElement | null) => {
              if (el) triggerRef.current = el
            },
            'aria-label': chip.ariaLabel,
            // The old pill's exact box (h-5, px-2) — only the ::after hit
            // extender reaches past it.
            className: cn(
              MARK,
              'flex h-5 items-center gap-[5px] rounded-full bg-secondary px-2 text-meta text-muted-foreground hover:bg-hover hover:text-foreground',
            ),
            onClick: stop,
          }}
          contentProps={{ align: 'end', finalFocus, onClick: stop }}
        >
          {chip.color && <span className="size-1.5 rounded-full" style={{ backgroundColor: chip.color }} />}
          {chip.name}
        </LabelsPopover>
      ))}
    </>
  )
}

// ── Project ──

/** Project swatch + name. The menu's items are the active projects from a
 * page-wide cache, so opening pickers on many rows loads them once. */
export function ProjectMark({
  task,
  rowId,
  name,
  color,
}: MarkProps & { name: string; color?: string | null }) {
  const { open, onOpenChange } = useRowPicker(rowId, 'project')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const finalFocus = useRowFocus(rowId, triggerRef)
  const update = useTaskMarkUpdate(task)

  const move = async (projectId: string, projectName: string) => {
    if (projectId === task.project_id) return
    if (await update({ projectId })) taskToast(`Moved to ${projectName}`, task.id)
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-label={rowMarkName({ kind: 'project', name })}
        className={cn(MARK, TEXT_MARK, 'gap-1 text-meta text-muted-foreground')}
        onClick={stop}
      >
        {color && <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />}
        {name}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" finalFocus={finalFocus} onClick={stop}>
        <ProjectMenuItems onSelect={move} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Items from the shared projects cache (useProjectOptions): the first open
 * on a page loads it, every later open on any row reuses it. Until the
 * first load lands, skeleton rows stand in (never "None available"). */
function ProjectMenuItems({ onSelect }: { onSelect: (id: string, name: string) => void }) {
  const projects = useProjectOptions()
  if (!projects) {
    return (
      <div className="flex flex-col gap-1 p-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-full rounded-md" />
        ))}
      </div>
    )
  }
  return (
    <EntityMenuItems
      options={projects}
      onSelect={(id) => onSelect(id, projects.find((p) => p.id === id)?.name ?? 'project')}
    />
  )
}

// ── Row end (T2) ──

/** The anchor a right-end picker hangs from: a zero-width strip down the
 * row's right edge. Absolute, so it takes no room in the row (the title
 * never moves); full row height, so the popup sits just below the row, or
 * just above it when flipped, never over the title. Out of the tab order
 * and hidden from assistive tech: the popup, not this, is what's focused. */
const ROW_END_ANCHOR = 'pointer-events-none absolute inset-y-0 right-0 w-0'

/** A row key (p · ⇧D · l · m) on a row that shows no mark of that kind
 * opens the same picker at the row's right end instead. Mounted from the
 * first such open and kept (closed) after, so the popup's exit animation
 * and its focus return to the row run like a mark's. */
export function RowEndPicker({ task, rowId }: MarkProps) {
  const openKind = useRowPickerStore((s) => (s.open?.rowId === rowId && s.open.anchor === 'row' ? s.open.kind : null))
  const [kind, setKind] = useState<RowMarkKind | null>(openKind)
  if (openKind && openKind !== kind) setKind(openKind)
  if (!kind) return null
  return <RowEndPickerFor key={kind} task={task} rowId={rowId} kind={kind} />
}

function RowEndPickerFor({ task, rowId, kind }: MarkProps & { kind: RowMarkKind }) {
  const { open, onOpenChange } = useRowPicker(rowId, kind, 'row')
  const triggerRef = useRef<HTMLElement | null>(null)
  const finalFocus = useRowFocus(rowId, triggerRef)
  const update = useTaskMarkUpdate(task)

  const triggerProps = {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el
    },
    tabIndex: -1,
    'aria-hidden': true,
    className: ROW_END_ANCHOR,
    onClick: stop,
  }
  const contentProps = { align: 'end' as const, finalFocus, onClick: stop }

  switch (kind) {
    case 'priority':
      return (
        <PriorityMenu
          open={open}
          onOpenChange={onOpenChange}
          onChange={(priority) => void update({ priority })}
          triggerProps={triggerProps}
          contentProps={contentProps}
        >
          {null}
        </PriorityMenu>
      )
    case 'due': {
      const value: DueValue = {
        dueDate: task.due_date ?? null,
        dueTime: task.due_time ?? null,
        durationMinutes: task.duration_minutes ?? null,
        recurrenceRule: task.recurrence_rule ?? null,
      }
      return (
        <DueDatePopover
          value={value}
          onChange={(next) => {
            if (next.dueDate !== value.dueDate) onOpenChange(false)
            void update({ due: next })
          }}
          open={open}
          onOpenChange={onOpenChange}
          triggerProps={triggerProps}
          contentProps={contentProps}
        >
          {null}
        </DueDatePopover>
      )
    }
    case 'label':
      return (
        <LabelsPopover
          value={task.labels}
          onChange={(labelIds) => void update({ labelIds })}
          open={open}
          onOpenChange={onOpenChange}
          triggerProps={triggerProps}
          contentProps={contentProps}
        >
          {null}
        </LabelsPopover>
      )
    case 'project':
      return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
          <DropdownMenuTrigger {...triggerProps} />
          <DropdownMenuContent {...contentProps}>
            <ProjectMenuItems
              onSelect={async (projectId, projectName) => {
                if (projectId === task.project_id) return
                if (await update({ projectId })) taskToast(`Moved to ${projectName}`, task.id)
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )
  }
}
