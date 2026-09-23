import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
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
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUpToLine, GripVertical, Play } from 'lucide-react'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { Label, Meta } from '@/components/shared/typography'
import { CompletionButton, FocusTaskMenu, InlineRename } from '@/components/focus/FocusTaskCard'
import { cn } from '@/lib/utils'
import {
  controlBlockedReason,
  dueLabel,
  moveEntryAction,
  queueBlockedReason,
  queueRowClickIntent,
  queueRowKeyIntent,
  queueTabStop,
  reorderAfterDrag,
  type QueueRowIntent,
  type TaskMenuId,
} from '@/lib/focusQueueIntents'
import type { FocusAction, FocusCapabilities, FocusEntry, FocusSnapshot, LocalTask } from '@nimble/types'

export interface FocusQueueRow {
  entry: FocusEntry
  /** Null when the task is no longer in native storage (still removable). */
  task: LocalTask | null
}

interface FocusQueueListProps {
  snapshot: FocusSnapshot
  capabilities: FocusCapabilities | null
  /** Up next rows: queue entries after the card, in snapshot order. */
  rows: FocusQueueRow[]
  today: string
  onAction: (action: FocusAction) => Promise<unknown>
  /**
   * Explicit promote (Enter on the current row, "Move to top"); pauses any
   * running task, starts nothing. `keepFocus`: keyboard promote keeps focus
   * in the list (on the row now in its place) instead of moving to the card.
   * Resolves false when the action was rejected.
   */
  onPromote: (entry: FocusEntry, opts?: { keepFocus?: boolean }) => unknown
  /** Remove an Up next entry (the tray offers Undo). Resolves false when rejected. */
  onRemove: (entry: FocusEntry) => unknown
  /** "Focus now": promote and start in one engine command (`start`). */
  onFocusNow: (entry: FocusEntry) => void
  /** A focus action is awaiting its commit: gate controls that would repeat it. */
  busy?: boolean
  onMenu: (id: TaskMenuId, task: LocalTask, entry: FocusEntry) => void
  renamingEntryId?: string | null
  onRename?: (task: LocalTask, content: string) => Promise<boolean>
  onRenameCancel?: () => void
}

const UNAVAILABLE = 'Task no longer available'
/** Keys the current row answers (see `queueRowKeyIntent`). */
const ROW_KEYS = 'ArrowUp ArrowDown Alt+ArrowUp Alt+ArrowDown Home End Enter Delete Backspace'

interface RowFocus {
  id: string | null
  index: number
}

function QueueRowItem({
  row,
  today,
  current,
  blocked,
  focusNowBlocked,
  busy,
  onSelect,
  onRowClick,
  onComplete,
  onPromote,
  onFocusNow,
  onMenu,
  onRemove,
  renaming,
  onRename,
  onRenameCancel,
}: {
  row: FocusQueueRow
  today: string
  /** This row is the list's roving tab stop (highlighted while the list has focus). */
  current: boolean
  blocked: string | null
  /** Why Focus now is unavailable (live timing); the control stays visible. */
  focusNowBlocked: string | null
  busy: boolean
  /** Focus landed on this row or inside it: it becomes current. */
  onSelect: () => void
  /** A click on the row itself (see `queueRowClickIntent`). */
  onRowClick: () => void
  onComplete: () => void
  onPromote: () => void
  onFocusNow: () => void
  onMenu: (id: TaskMenuId, task: LocalTask) => void
  onRemove: () => void
  renaming: boolean
  onRename?: (task: LocalTask, content: string) => Promise<boolean>
  onRenameCancel?: () => void
}) {
  const { entry, task } = row
  const title = task?.content ?? UNAVAILABLE
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id, disabled: blocked != null })
  const due = task ? dueLabel(task, today) : null
  // Only the current row's controls are Tab stops; the list itself is one.
  const stop = current ? 0 : -1
  const titleId = useId()
  const dueId = useId()

  // The row ring keys off :focus, not :focus-visible: arrow keys move focus
  // programmatically, and WebKit carries a click's "no ring" state along.
  return (
    <li
      ref={setNodeRef}
      tabIndex={stop}
      aria-labelledby={titleId}
      aria-describedby={due ? dueId : undefined}
      aria-current={current || undefined}
      aria-keyshortcuts={ROW_KEYS}
      data-focus-entry={entry.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onFocus={onSelect}
      onClick={() => {
        // A click selects the row; it never promotes (use "Move to top").
        if (!renaming) onRowClick()
      }}
      className={cn(
        'group relative flex min-w-0 items-center gap-2.5 border-b border-border bg-background py-2 pr-3 pl-5 transition-colors duration-(--transition-fast) hover:bg-hover focus:outline-2 focus:-outline-offset-2 focus:outline-ring motion-reduce:transition-none',
        current && 'group-focus-within/queue:bg-accent/10',
        isDragging && 'z-10 opacity-90 shadow-md',
      )}
    >
      {/* Handle-only drag: listeners live on the grip, never the row. */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        tabIndex={stop}
        aria-label={`Drag to reorder ${title}`}
        disabled={blocked != null}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-1/2 left-0.5 flex h-6 w-4 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-ring active:cursor-grabbing disabled:hidden"
      >
        <GripVertical className="size-3" aria-hidden />
      </button>
      {task ? (
        <CompletionButton title={title} tabIndex={stop} disabled={blocked != null || busy} reason={blocked} onComplete={onComplete} />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      {task && <PriorityBars priority={task.priority} />}
      {renaming && task && onRename && onRenameCancel ? (
        <InlineRename task={task} className="text-body" onCommit={(c) => onRename(task, c)} onCancel={onRenameCancel} />
      ) : (
        <span id={titleId} className={cn('min-w-0 flex-1 truncate text-body text-foreground', !task && 'text-muted-foreground')}>
          {title}
        </span>
      )}
      {due && (
        <Meta id={dueId} className="shrink-0">
          {due}
        </Meta>
      )}
      {task && (
        <button
          type="button"
          tabIndex={stop}
          aria-label={`Move ${title} to top`}
          title={blocked ?? 'Move to top'}
          disabled={blocked != null || busy}
          onClick={(e) => {
            e.stopPropagation()
            onPromote()
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-(--transition-fast) group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-hover hover:text-foreground focus-ring disabled:cursor-default disabled:hover:bg-transparent"
        >
          <ArrowUpToLine className="size-3" aria-hidden />
        </button>
      )}
      {task && (
        <button
          type="button"
          tabIndex={stop}
          aria-label={`Focus ${title} now`}
          title={focusNowBlocked ?? 'Focus now'}
          disabled={focusNowBlocked != null || busy}
          onClick={(e) => {
            e.stopPropagation()
            onFocusNow()
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-(--transition-fast) group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-hover hover:text-foreground focus-ring disabled:cursor-default disabled:hover:bg-transparent"
        >
          <Play className="size-3" aria-hidden />
        </button>
      )}
      {task ? (
        <FocusTaskMenu task={task} place="row" tabIndex={stop} onSelect={(id) => onMenu(id, task)} />
      ) : (
        <button
          type="button"
          tabIndex={stop}
          disabled={blocked != null}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="shrink-0 rounded-sm text-meta text-muted-foreground hover:text-foreground focus-ring"
        >
          Remove
        </button>
      )}
    </li>
  )
}

/**
 * "Up next": the shared ordered queue below the card. Order is the
 * snapshot's; it changes only through the drag handle, Alt+Arrow keyboard
 * moves, promote and the row menu — never on refresh or source switch.
 *
 * The list is one Tab stop with a roving current row: ↑/↓ (Home/End) move
 * it, Alt+↑/↓ reorder it and keep it current, Enter promotes it,
 * Delete/Backspace removes it. A click only selects a row; promotion by
 * mouse is the row's explicit "Move to top" (hover button or menu).
 */
export function FocusQueueList({
  snapshot,
  capabilities,
  rows,
  today,
  onAction,
  onPromote,
  onRemove,
  onFocusNow,
  busy = false,
  onMenu,
  renamingEntryId,
  onRename,
  onRenameCancel,
}: FocusQueueListProps) {
  const blocked = queueBlockedReason(capabilities)
  const focusNowBlocked = controlBlockedReason({ live: true }, capabilities)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const submit = (action: FocusAction | null) => {
    if (action) void onAction(action)
  }
  const ids = rows.map((r) => r.entry.id)
  const [current, setCurrent] = useState<RowFocus>({ id: null, index: -1 })
  const stopId = queueTabStop(ids, current)

  const listRef = useRef<HTMLUListElement>(null)
  const rowEl = (id: string | null) =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-focus-entry]') ?? []).find(
      (el) => el.dataset.focusEntry === id,
    )
  const focusRow = (id: string | null) => {
    const el = rowEl(id)
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
  }

  // A keyboard move or removal commits async and React moves/drops the
  // focused node (WebKit blurs it), so once the new snapshot renders put
  // focus back on the same row — or, if it left, the row now in its place.
  const refocus = useRef<RowFocus | null>(null)
  useEffect(() => {
    const pending = refocus.current
    if (!pending) return
    // Only restore focus that the commit took away: if the user has moved on
    // (clicked elsewhere, opened a field), leave focus where they put it.
    const active = document.activeElement
    if (active && active !== document.body && !listRef.current?.contains(active)) {
      refocus.current = null
      return
    }
    const target = rowEl(queueTabStop(ids, pending))
    if (target && document.activeElement !== target) target.focus()
    if (target || ids.length === 0) refocus.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.queue_revision])

  /** Refocus after `result` commits; a rejected action drops the pending refocus. */
  const refocusAfter = (focus: RowFocus, result: unknown) => {
    refocus.current = focus
    void Promise.resolve(result).then(
      (ok) => {
        if (!ok && refocus.current === focus) refocus.current = null
      },
      () => {
        if (refocus.current === focus) refocus.current = null
      },
    )
  }
  const move = (entryId: string, index: number, direction: 'up' | 'down') => {
    const action = moveEntryAction(snapshot.queue, entryId, direction)
    if (action) refocusAfter({ id: entryId, index }, onAction(action))
  }

  const run = (intent: QueueRowIntent, row: FocusQueueRow, index: number) => {
    switch (intent.kind) {
      case 'focus':
        return focusRow(ids[intent.index] ?? null)
      case 'move':
        if (blocked == null && !busy) move(row.entry.id, index, intent.direction)
        return
      case 'promote':
        // The promoted row leaves Up next; focus lands on the row now in its place.
        if (blocked == null && !busy && row.task)
          refocusAfter({ id: row.entry.id, index }, onPromote(row.entry, { keepFocus: true }))
        return
      case 'remove':
        if (blocked == null && !busy) refocusAfter({ id: row.entry.id, index }, onRemove(row.entry))
        return
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    // Only keys aimed at a row itself: its controls, the rename field and
    // open menus keep their native keys.
    const target = e.target as HTMLElement
    if (e.defaultPrevented || !target.dataset?.focusEntry) return
    const index = ids.indexOf(target.dataset.focusEntry)
    const intent = queueRowKeyIntent(e.key, { alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, repeat: e.repeat }, index, ids.length)
    if (!intent) return
    e.preventDefault()
    e.stopPropagation()
    run(intent, rows[index], index)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over) submit(reorderAfterDrag(snapshot.queue, String(active.id), String(over.id)))
  }

  if (rows.length === 0) return null

  return (
    <div>
      <Label as="h3" className="px-4 pt-2.5 pb-1">
        Up next
      </Label>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul ref={listRef} aria-label="Up next" className="group/queue" onKeyDown={onKeyDown}>
            {rows.map((row, index) => (
              <QueueRowItem
                key={row.entry.id}
                row={row}
                today={today}
                current={row.entry.id === stopId}
                blocked={blocked}
                focusNowBlocked={focusNowBlocked}
                busy={busy}
                onSelect={() => setCurrent({ id: row.entry.id, index })}
                onRowClick={() => run(queueRowClickIntent(index), row, index)}
                onComplete={() => submit({ kind: 'complete', occurrence_id: row.entry.occurrence_id })}
                onPromote={() => onPromote(row.entry)}
                onFocusNow={() => onFocusNow(row.entry)}
                onMenu={(id, task) => onMenu(id, task, row.entry)}
                onRemove={() => void onRemove(row.entry)}
                renaming={renamingEntryId === row.entry.id}
                onRename={onRename}
                onRenameCancel={onRenameCancel}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}
