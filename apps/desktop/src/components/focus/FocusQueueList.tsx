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
import { useEffect, useRef } from 'react'
import { GripVertical } from 'lucide-react'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { Label, Meta } from '@/components/shared/typography'
import { CompletionButton, FocusTaskMenu, InlineRename } from '@/components/focus/FocusTaskCard'
import { cn } from '@/lib/utils'
import { dueLabel, moveEntryAction, queueBlockedReason, reorderAfterDrag, type TaskMenuId } from '@/lib/focusQueueIntents'
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
  /** Explicit promote (row click, Enter, "Focus now"); pauses any running task. */
  onPromote: (entry: FocusEntry) => void
  onMenu: (id: TaskMenuId, task: LocalTask, entry: FocusEntry) => void
  renamingEntryId?: string | null
  onRename?: (task: LocalTask, content: string) => Promise<boolean>
  onRenameCancel?: () => void
}

const UNAVAILABLE = 'Task no longer available'

function QueueRowItem({
  row,
  today,
  blocked,
  onComplete,
  onPromote,
  onMove,
  onMenu,
  onRemove,
  renaming,
  onRename,
  onRenameCancel,
}: {
  row: FocusQueueRow
  today: string
  blocked: string | null
  onComplete: () => void
  onPromote: () => void
  onMove: (direction: 'up' | 'down') => void
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

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => {
        if (!renaming && !blocked && task) onPromote()
      }}
      className={cn(
        'group relative flex min-w-0 items-center gap-2.5 border-b border-border bg-background py-2 pr-3 pl-5 transition-colors duration-(--transition-fast) hover:bg-hover motion-reduce:transition-none',
        isDragging && 'z-10 opacity-90 shadow-md',
      )}
    >
      {/* Handle-only drag: listeners live on the grip, never the row. */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${title}`}
        disabled={blocked != null}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-1/2 left-0.5 flex h-6 w-4 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-ring focus-visible:opacity-100 active:cursor-grabbing disabled:hidden"
      >
        <GripVertical className="size-3" aria-hidden />
      </button>
      {task ? (
        <CompletionButton title={title} disabled={blocked != null} reason={blocked} onComplete={onComplete} />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      {task && <PriorityBars priority={task.priority} />}
      {renaming && task && onRename && onRenameCancel ? (
        <InlineRename task={task} className="text-body" onCommit={(c) => onRename(task, c)} onCancel={onRenameCancel} />
      ) : (
        <button
          type="button"
          aria-label={task ? `Focus ${title} now` : title}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-focus-entry={entry.id}
          disabled={blocked != null || !task}
          onClick={(e) => {
            e.stopPropagation()
            onPromote()
          }}
          onKeyDown={(e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
            e.preventDefault()
            e.stopPropagation()
            onMove(e.key === 'ArrowUp' ? 'up' : 'down')
          }}
          className={cn(
            'min-w-0 flex-1 truncate rounded-sm text-left text-body text-foreground focus-ring disabled:cursor-default',
            !task && 'text-muted-foreground',
          )}
        >
          {title}
        </button>
      )}
      {due && <Meta className="shrink-0">{due}</Meta>}
      {task ? (
        <FocusTaskMenu task={task} place="row" onSelect={(id) => onMenu(id, task)} />
      ) : (
        <button
          type="button"
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
 */
export function FocusQueueList({
  snapshot,
  capabilities,
  rows,
  today,
  onAction,
  onPromote,
  onMenu,
  renamingEntryId,
  onRename,
  onRenameCancel,
}: FocusQueueListProps) {
  const blocked = queueBlockedReason(capabilities)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const submit = (action: FocusAction | null) => {
    if (action) void onAction(action)
  }
  // Keyboard move keeps focus on the moved row: the reorder commits async
  // and React moves the focused node (WebKit blurs it), so refocus the same
  // entry's title once the new snapshot has rendered.
  const listRef = useRef<HTMLUListElement>(null)
  const refocusEntryId = useRef<string | null>(null)
  useEffect(() => {
    const id = refocusEntryId.current
    if (!id) return
    const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-focus-entry]') ?? []).find(
      (el) => el.dataset.focusEntry === id,
    )
    if (target && document.activeElement !== target) target.focus()
    if (target) refocusEntryId.current = null
  }, [snapshot.queue_revision])
  const move = (entryId: string, direction: 'up' | 'down') => {
    const action = moveEntryAction(snapshot.queue, entryId, direction)
    if (!action) return
    refocusEntryId.current = entryId
    void onAction(action)
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
        <SortableContext items={rows.map((r) => r.entry.id)} strategy={verticalListSortingStrategy}>
          <ul ref={listRef} aria-label="Up next">
            {rows.map((row) => (
              <QueueRowItem
                key={row.entry.id}
                row={row}
                today={today}
                blocked={blocked}
                onComplete={() => submit({ kind: 'complete', occurrence_id: row.entry.occurrence_id })}
                onPromote={() => onPromote(row.entry)}
                onMove={(direction) => move(row.entry.id, direction)}
                onMenu={(id, task) => onMenu(id, task, row.entry)}
                onRemove={() => submit({ kind: 'remove', occurrence_id: row.entry.occurrence_id })}
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
