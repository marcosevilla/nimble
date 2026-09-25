import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Label, LabelGroup } from '@nimble/types'
import { cn } from '@/lib/utils'
import { labelColor, LABEL_COLOR_OPTIONS, DEFAULT_LABEL_COLOR } from '@/lib/labelColors'
import { useDataProvider } from '@/services/provider-context'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { useDeferredDeletes } from '@/hooks/useDeferredDeletes'
import { managerSections } from '@/lib/labelTaxonomy'
import { applyDrop, applyToTaxonomy, describeMove, flattenManager, fullLabelOrder, moveByKey, nextGroupName, type DropResult, type ManagerItem } from '@/lib/labelManagerModel'
import { createUndoable } from '@/lib/undoable'
import { DEFERRED_DELETE_MS } from '@/lib/deferredDelete'
import { showUndoToast } from '@/components/shared/undoToast'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { IconButton } from '@/components/shared/IconButton'
import { Caption, FieldLabel } from '@/components/shared/typography'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { settingsFailure } from '@/lib/settingsMessage'

function toastFailure(error: unknown) {
  const failure = settingsFailure(error)
  toast.error(failure.message, failure.detail ? { description: failure.detail } : undefined)
}

export function LabelManager() {
  const dp = useDataProvider()
  const { labels, groups, loading, reload } = useLabelTaxonomy()
  // Optimistic overlay after a drag or ⌥-move. It is tied to the `labels`
  // array it was built from, so the next fetch (a new array) retires it
  // without a setState-in-effect.
  const [overlay, setOverlay] = useState<{ base: Label[]; value: { labels: Label[]; groups: LabelGroup[] } } | null>(null)
  const view = useMemo(
    () => (overlay && overlay.base === labels ? overlay.value : { labels, groups }),
    [overlay, labels, groups],
  )

  // Deferred deletes: label ids, and `group:<id>` for groups. A group pending
  // delete reads as gone, so its labels show under Ungrouped until Undo.
  const { hidden, defer } = useDeferredDeletes()
  const hiddenGroups = useMemo(
    () => new Set([...hidden].filter((k) => k.startsWith('group:')).map((k) => k.slice('group:'.length))),
    [hidden],
  )
  const model = useMemo(
    () => managerSections(view.labels.filter((l) => !hidden.has(l.id)), view.groups, hiddenGroups),
    [view, hidden, hiddenGroups],
  )
  const items = useMemo(() => flattenManager(model), [model])

  const [unused, setUnused] = useState<string[]>([])
  useEffect(() => { dp.labels.unusedIds().then(setUnused, () => setUnused([])) }, [dp, labels])

  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>(DEFAULT_LABEL_COLOR)
  const [saving, setSaving] = useState(false)

  // Keyboard moves and "New group" put focus back where the user expects it.
  const refocus = useRef<{ selector: string; select?: boolean } | null>(null)
  useEffect(() => {
    const target = refocus.current
    if (!target) return
    const el = document.querySelector<HTMLElement>(target.selector)
    if (!el) return
    refocus.current = null
    el.focus()
    if (target.select && el instanceof HTMLInputElement) el.select()
  }, [items])

  const persist = useCallback(async (result: DropResult | null) => {
    if (!result) return
    const order = fullLabelOrder(result.items, model)
    setOverlay({ base: labels, value: applyToTaxonomy(view.labels, view.groups, result, order) })
    try {
      if (result.moved) await dp.labels.setGroup(result.moved.labelId, result.moved.groupId)
      if (result.labelOrder) await dp.labels.reorder(order)
      if (result.groupOrder) await dp.labels.groups.reorder(result.groupOrder)
    } catch (e) {
      toastFailure(e)
    } finally {
      reload()
    }
  }, [dp, model, view, labels, reload])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) void persist(applyDrop(items, String(active.id), String(over.id)))
  }

  // Screen-reader wording: real names, and where a move landed.
  const itemName = useCallback((item: ManagerItem) => {
    if (item.kind === 'ungrouped') return 'Ungrouped'
    if (item.kind === 'group') return view.groups.find((g) => g.id === item.groupId)?.name ?? 'group'
    return view.labels.find((l) => l.id === item.labelId)?.name ?? 'label'
  }, [view])
  const keyName = useCallback((key: string | number) => {
    const item = items.find((i) => i.key === String(key))
    if (!item) return 'item'
    return item.kind === 'group' ? `group ${itemName(item)}` : itemName(item)
  }, [items, itemName])
  const announcements: Announcements = useMemo(() => ({
    onDragStart: ({ active }) => `Picked up ${keyName(active.id)}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${keyName(active.id)} is over ${keyName(over.id)}.` : `${keyName(active.id)} is no longer over a row.`),
    onDragEnd: ({ active, over }) => {
      const result = over && active.id !== over.id ? applyDrop(items, String(active.id), String(over.id)) : null
      return (result && describeMove(result.items, String(active.id), itemName)) ?? `Dropped ${keyName(active.id)}. Nothing moved.`
    },
    onDragCancel: ({ active }) => `Moving ${keyName(active.id)} was cancelled.`,
  }), [items, itemName, keyName])
  // ⌥↑/⌥↓ moves have no drag lifecycle: announce them in a polite status region.
  const [moveNote, setMoveNote] = useState('')
  // ⌥↑/⌥↓ from a row's grip (never from its rename field, where ⌥↑ moves the caret).
  const onMoveKey = (key: string) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    if ((e.target as HTMLElement).dataset.managerGrip === undefined) return
    e.preventDefault()
    e.stopPropagation()
    refocus.current = { selector: `[data-manager-grip="${window.CSS.escape(key)}"]` }
    const result = moveByKey(items, key, e.key === 'ArrowUp' ? 'up' : 'down')
    if (result) setMoveNote(describeMove(result.items, key, itemName) ?? '')
    void persist(result)
  }

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed || saving) return
    const archived = view.labels.find((l) => l.archived_at && l.name.toLowerCase() === trimmed.toLowerCase())
    if (archived) {
      toast(`"${archived.name}" is archived. Restore it from Archived below.`)
      return
    }
    setSaving(true)
    try {
      await dp.labels.create(trimmed, newColor)
      reload()
      toast.success(`Label created: "${trimmed}"`)
      setNewName('')
      setNewColor(DEFAULT_LABEL_COLOR)
      setShowForm(false)
    } catch (e) {
      toastFailure(e)
    } finally {
      setSaving(false)
    }
  }, [dp, newName, newColor, saving, view.labels, reload])

  const handleRename = useCallback(async (id: string, name: string): Promise<boolean> => {
    try {
      await dp.labels.update(id, { name })
      reload()
      return true
    } catch (e) {
      toastFailure(e)
      return false
    }
  }, [dp, reload])

  const handleColorChange = useCallback(async (id: string, color: string) => {
    try {
      await dp.labels.update(id, { color })
      reload()
    } catch (e) {
      toastFailure(e)
    }
  }, [dp, reload])

  // After a delete, focus goes to the next row's grip, else "New group".
  // The confirm dialog / menu reads this when it closes (finalFocus).
  const pendingFocus = useRef<string | null>(null)
  const nextFocusSelector = useCallback((key: string) => {
    const at = items.findIndex((i) => i.key === key)
    const next = items.slice(at + 1).find((i) => i.kind !== 'ungrouped')
    return next ? `[data-manager-grip="${window.CSS.escape(next.key)}"]` : '[data-new-group]'
  }, [items])
  const deleteFinalFocus = useCallback((): boolean | HTMLElement => {
    const selector = pendingFocus.current
    pendingFocus.current = null
    return (selector && document.querySelector<HTMLElement>(selector)) || true
  }, [])

  const handleDelete = useCallback((label: Label) => {
    pendingFocus.current = nextFocusSelector(`label:${label.id}`)
    defer(label.id, `Label "${label.name}" deleted`, async () => {
      try {
        await dp.labels.delete(label.id)
      } catch (e) {
        toastFailure(e)
      } finally {
        reload()
      }
    })
  }, [dp, defer, reload, nextFocusSelector])

  const newGroup = async () => {
    try {
      const group = await dp.labels.groups.create(nextGroupName(view.groups), false)
      refocus.current = { selector: `[data-group-name="${window.CSS.escape(group.id)}"]`, select: true }
      reload()
    } catch (e) {
      toastFailure(e)
    }
  }

  const renameGroup = async (id: string, name: string): Promise<boolean> => {
    try {
      await dp.labels.groups.update(id, { name })
      reload()
      return true
    } catch (e) {
      toastFailure(e)
      return false
    }
  }

  const setPickOne = async (id: string, exclusive: boolean) => {
    try {
      await dp.labels.groups.update(id, { exclusive })
      reload()
    } catch (e) {
      toastFailure(e)
    }
  }

  const deleteGroup = (group: LabelGroup) => {
    pendingFocus.current = nextFocusSelector(`group:${group.id}`)
    defer(`group:${group.id}`, `Group "${group.name}" deleted. Its labels are ungrouped.`, async () => {
      try {
        await dp.labels.groups.delete(group.id)
      } catch (e) {
        toastFailure(e)
      } finally {
        reload()
      }
    })
  }

  const archiveUnused = async () => {
    try {
      const archived = await dp.labels.archive(unused)
      reload()
      const ids = archived.map((l) => l.id)
      // Already committed; Undo restores exactly what this call archived.
      const pending = createUndoable({
        onCommit: () => {},
        onUndo: () => { dp.labels.restore(ids).then(() => reload(), toastFailure) },
      })
      showUndoToast(`Archived ${ids.length} label${ids.length === 1 ? '' : 's'}`, pending, DEFERRED_DELETE_MS)
    } catch (e) {
      toastFailure(e)
    }
  }

  const restore = async (label: Label) => {
    try {
      await dp.labels.restore([label.id])
      reload()
      toast.success(`Restored "${label.name}"`)
    } catch (e) {
      toastFailure(e)
    }
  }

  if (loading && labels.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    )
  }

  const labelRow = (label: Label) => (
    <LabelRow label={label} onRename={handleRename} onColorChange={handleColorChange} onDelete={() => handleDelete(label)} deleteFinalFocus={deleteFinalFocus} />
  )
  const systemCount = model.system.reduce((n, s) => n + s.labels.length, 0)

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">{moveNote}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
        <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {items.map((item) => {
              if (item.kind === 'group') {
                const group = view.groups.find((g) => g.id === item.groupId)
                if (!group) return null
                return (
                  <SortableRow key={item.key} id={item.key} gripLabel={`Drag group ${group.name}`} onKeyDown={onMoveKey(item.key)} className="pt-3 first:pt-0">
                    <GroupHeader group={group} onRename={renameGroup} onPickOne={setPickOne} onDelete={() => deleteGroup(group)} deleteFinalFocus={deleteFinalFocus} />
                  </SortableRow>
                )
              }
              if (item.kind === 'ungrouped') {
                return (
                  <SortableRow key={item.key} id={item.key} fixed className="pt-3 first:pt-0">
                    <Caption as="div" className="px-1 py-1">Ungrouped</Caption>
                  </SortableRow>
                )
              }
              const label = view.labels.find((l) => l.id === item.labelId)
              if (!label) return null
              return (
                <SortableRow key={item.key} id={item.key} gripLabel={`Drag label ${label.name}`} onKeyDown={onMoveKey(item.key)}>
                  {labelRow(label)}
                </SortableRow>
              )
            })}
            {items.length === 1 && (
              <p className="px-1 text-body text-muted-foreground">No labels yet.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {systemCount > 0 && (
        <CollapsibleSection title="System" count={systemCount} variant="nested" defaultOpen={false}>
          {model.system.map((section) => (
            <div key={section.group?.id} className="space-y-0.5 pl-5">
              <Caption as="div" className="px-1 py-1">{section.group?.name}</Caption>
              {section.labels.map((label) => <div key={label.id}>{labelRow(label)}</div>)}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {model.archived.length > 0 && (
        <CollapsibleSection title="Archived" count={model.archived.length} variant="nested" defaultOpen={false}>
          <div className="space-y-0.5 pl-5">
            {model.archived.map((label) => (
              <div key={label.id} className="flex items-center gap-2 rounded-md px-2 py-1">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: labelColor(label.color) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{label.name}</span>
                <Button variant="ghost" size="sm" onClick={() => void restore(label)} aria-label={`Restore ${label.name}`}>
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {showForm ? (
        <div className="space-y-4 rounded-md border p-4">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            placeholder="Label name"
            autoFocus
          />
          <div className="flex items-center gap-2">
            {LABEL_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'size-6 rounded-full border-2 transition-[border-color,scale] duration-(--transition-fast)',
                  newColor === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                )}
                style={{ backgroundColor: labelColor(c) }}
                onClick={() => setNewColor(c)}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || saving}>
              {saving ? 'Adding...' : 'Add label'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setNewName(''); setNewColor(DEFAULT_LABEL_COLOR) }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="size-3" />
            Add label
          </Button>
          <Button variant="outline" size="sm" onClick={() => void newGroup()} data-new-group="">
            <Plus className="size-3" />
            New group
          </Button>
          {unused.length > 0 && <ArchiveUnusedButton count={unused.length} onConfirm={() => void archiveUnused()} />}
        </div>
      )}
    </div>
  )
}

/** One row of the flat sortable list. Handle-only drag (FocusQueueList precedent). */
function SortableRow({
  id,
  fixed = false,
  gripLabel,
  onKeyDown,
  className,
  children,
}: {
  id: string
  fixed?: boolean
  gripLabel?: string
  onKeyDown?: (e: KeyboardEvent) => void
  className?: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: fixed ? { draggable: true, droppable: false } : false })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onKeyDown={onKeyDown}
      className={cn('group/row flex items-center gap-1', isDragging && 'relative z-10 rounded-md bg-background opacity-90 shadow-md', className)}
    >
      {fixed ? (
        <span className="w-5 shrink-0" aria-hidden />
      ) : (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          data-manager-grip={id}
          aria-label={gripLabel}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-opacity duration-(--transition-fast) group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function GroupHeader({
  group,
  onRename,
  onPickOne,
  onDelete,
  deleteFinalFocus,
}: {
  group: LabelGroup
  onRename: (id: string, name: string) => Promise<boolean>
  onPickOne: (id: string, exclusive: boolean) => void
  onDelete: () => void
  deleteFinalFocus: () => boolean | HTMLElement
}) {
  const [draft, setDraft] = useState(group.name)
  // A rename from elsewhere (sync, dt) resets the field — adjusted during
  // render rather than in an effect.
  const [seenName, setSeenName] = useState(group.name)
  if (seenName !== group.name) {
    setSeenName(group.name)
    setDraft(group.name)
  }
  const save = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === group.name) {
      setDraft(group.name)
      return
    }
    if (!(await onRename(group.id, trimmed))) setDraft(group.name)
  }
  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1">
      <input
        value={draft}
        data-group-name={group.id}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
          if (e.key === 'Escape') { setDraft(group.name); e.currentTarget.blur() }
        }}
        aria-label={`Group name ${group.name}`}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-body-strong underline-offset-4 decoration-muted-foreground-subtle hover:underline focus-visible:no-underline"
      />
      {/* The visible words are a real, clickable label for the switch; the
          switch's own name adds which group (it contains "Pick one"). */}
      <FieldLabel className="flex shrink-0 cursor-pointer items-center gap-1.5 text-meta text-muted-foreground">
        <Switch
          size="sm"
          checked={group.exclusive}
          onCheckedChange={(checked) => onPickOne(group.id, checked)}
          aria-label={`Pick one in ${group.name}`}
        />
        Pick one
      </FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton aria-label={`More for group ${group.name}`}>
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end" finalFocus={deleteFinalFocus}>
          <DropdownMenuItem onClick={onDelete}>
            <Trash2 className="size-3.5" />
            Delete group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ArchiveUnusedButton({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  const noun = count === 1 ? 'label' : 'labels'
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Archive className="size-3" />
            Archive unused
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {count} {noun} with no open tasks?</AlertDialogTitle>
          <AlertDialogDescription>Only ungrouped labels are included. They stay on completed tasks and you can restore them.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Archive {count}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function LabelRow({
  label,
  onRename,
  onColorChange,
  onDelete,
  deleteFinalFocus,
}: {
  label: Label
  onRename: (id: string, name: string) => Promise<boolean>
  onColorChange: (id: string, color: string) => void
  onDelete: () => void
  deleteFinalFocus: () => boolean | HTMLElement
}) {
  const [draft, setDraft] = useState(label.name)

  useEffect(() => { setDraft(label.name) }, [label.name])

  const save = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === label.name) {
      setDraft(label.name)
      return
    }
    // Optimistically-typed value stays on screen only if the rename lands —
    // a failed request (offline, validation) must not leave the input
    // showing text that never actually saved.
    const ok = await onRename(label.id, trimmed)
    if (!ok) setDraft(label.name)
  }

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover transition-colors">
      <Popover>
        <PopoverTrigger
          className="relative flex size-5 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1.5 before:content-[''] hover:ring-2 hover:ring-border/60 transition-shadow duration-(--transition-fast)"
          aria-label={`Change color for ${label.name}`}
        >
          <span className="size-2.5 rounded-full" style={{ backgroundColor: labelColor(label.color) }} />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-auto p-2">
          <div className="flex items-center gap-1.5">
            {LABEL_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'size-5 rounded-full border-2 transition-[border-color,scale] duration-(--transition-fast)',
                  label.color === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                )}
                style={{ backgroundColor: labelColor(c) }}
                onClick={() => onColorChange(label.id, c)}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Inline rename (settings P2-12): named for AT, keyboard focus ring
          from the global :focus-visible rule, a hover underline so the row
          reads as editable. */}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setDraft(label.name); (e.target as HTMLInputElement).blur() }
        }}
        aria-label={`Rename ${label.name}`}
        className="flex-1 min-w-0 rounded-md bg-transparent px-1 text-body underline-offset-4 decoration-muted-foreground-subtle hover:underline focus-visible:no-underline"
      />

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <IconButton
              tone="destructive"
              className="opacity-0 group-hover:opacity-100"
              aria-label={`Delete label ${label.name}`}
            >
              <Trash2 className="size-3" />
            </IconButton>
          }
        />
        <AlertDialogContent finalFocus={deleteFinalFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{label.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the label from any tasks that use it. You can undo this for a few seconds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
