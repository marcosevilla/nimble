import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, GripVertical } from 'lucide-react'
import type { BriefLayoutEntry, ConfigField, ModuleManifest } from '@nimble/types'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { IconButton } from '@/components/shared/IconButton'
import { boxRowKey, moveEntry, reorderEntries, setModuleConfig, setModuleEnabled } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { BRIEF_MODULES } from './briefModules'

/** One sortable list of every registered module (addendum §2), shared by
 *  Settings → Boxes and the setup's Arrange step. Controlled: every change
 *  hands the parent the whole next list. */
export function BoxesList({
  entries,
  manifests,
  onChange,
  label = 'Boxes',
}: {
  entries: BriefLayoutEntry[]
  manifests: ModuleManifest[]
  onChange: (next: BriefLayoutEntry[]) => void
  label?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const listRef = useRef<HTMLUListElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const ids = entries.map((x) => x.id)
  const stop = current && ids.includes(current) ? current : ids[0]
  const nameOf = (id: string) => manifests.find((m) => m.id === id)?.name ?? id
  const rowEl = (id: string | undefined) =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-box-row]') ?? []).find((el) => el.dataset.boxRow === id)

  // A keyboard move re-renders the list and WebKit drops focus from the
  // moved node: put it back on the same row once the new order is painted.
  // (The row ring keys off :focus, not :focus-visible, for the same reason
  // as FocusQueueList: WebKit carries a click's "no ring" state along.)
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    rowEl(id)?.focus()
  })

  const move = (index: number, direction: 'up' | 'down') => {
    const id = entries[index].id
    const next = moveEntry(entries, index, direction)
    if (next === entries) return
    pendingFocus.current = id
    onChange(next)
    setAnnouncement(`${nameOf(id)} moved to position ${next.findIndex((x) => x.id === id) + 1} of ${next.length}`)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const id = (e.target as HTMLElement).dataset?.boxRow
    if (e.defaultPrevented || !id) return
    const index = ids.indexOf(id)
    const intent = boxRowKey(e.key, { alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey }, index, ids.length)
    if (!intent) return
    e.preventDefault()
    e.stopPropagation()
    if (intent.kind === 'focus') rowEl(ids[intent.index])?.focus()
    else move(index, intent.direction)
  }

  // Drag announcements speak box names ("Schedule"), never ids ("schedule").
  const position = (id: string | number) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(String(active.id))}, ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(String(active.id))} is over ${position(over.id)}.` : `${nameOf(String(active.id))} is no longer over the list.`,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(String(active.id))} dropped at ${position(over.id)}.` : `${nameOf(String(active.id))} dropped.`,
    onDragCancel: ({ active }) => `Moving ${nameOf(String(active.id))} was cancelled.`,
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const next = reorderEntries(entries, String(active.id), String(over.id))
    if (next !== entries) onChange(next)
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul ref={listRef} aria-label={label} className="divide-y divide-border/50 rounded-lg border" onKeyDown={onKeyDown}>
            {entries.map((entry) => (
              <BoxRow
                key={entry.id}
                entry={entry}
                manifest={manifests.find((m) => m.id === entry.id)}
                current={entry.id === stop}
                onFocusRow={() => setCurrent(entry.id)}
                onToggle={(on) => onChange(setModuleEnabled(entries, entry.id, on))}
                onConfig={(patch) => onChange(setModuleConfig(entries, entry.id, patch))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  )
}

function BoxRow({
  entry,
  manifest,
  current,
  onFocusRow,
  onToggle,
  onConfig,
}: {
  entry: BriefLayoutEntry
  manifest: ModuleManifest | undefined
  current: boolean
  onFocusRow: () => void
  onToggle: (on: boolean) => void
  onConfig: (patch: Record<string, unknown>) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id })
  const [open, setOpen] = useState(false)
  const optionsId = useId()
  const name = manifest?.name ?? entry.id
  const schema = manifest?.config_schema ?? []
  const Custom = BRIEF_MODULES[entry.id]?.Settings
  const hasOptions = !!Custom || schema.length > 0

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-box-row={entry.id}
      tabIndex={current ? 0 : -1}
      aria-label={`${name}, ${entry.enabled ? 'shown' : 'hidden'}`}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onFocus={(e) => { if (e.target === e.currentTarget) onFocusRow() }}
      className={cn('bg-card outline-none first:rounded-t-lg last:rounded-b-lg focus:ring-2 focus:ring-ring focus:ring-inset', isDragging && 'relative z-10 shadow-popover')}
    >
      <div className="flex min-h-10 min-w-0 items-center gap-2 px-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          tabIndex={-1}
          aria-label={`Drag ${name}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
        <span className={cn('min-w-0 flex-1 truncate text-body', !entry.enabled && 'text-muted-foreground')}>{name}</span>
        <Switch checked={entry.enabled} onCheckedChange={(on) => onToggle(on)} aria-label={`Show ${name}`} />
        {hasOptions ? (
          <IconButton aria-label={`${name} options`} aria-expanded={open} aria-controls={optionsId} onClick={() => setOpen((o) => !o)}>
            <ChevronDown className={cn('size-3.5 transition-transform duration-(--transition-fast)', open && 'rotate-180')} />
          </IconButton>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
      </div>
      {open && hasOptions && (
        <div id={optionsId} className="space-y-3 pb-3 pl-10 pr-3">
          {Custom ? (
            <Custom entry={entry} onChange={onConfig} />
          ) : (
            schema.map((field) => (
              <ConfigFieldControl key={field.key} field={field} value={entry.config[field.key]} onChange={(v) => onConfig({ [field.key]: v })} />
            ))
          )}
        </div>
      )}
    </li>
  )
}

/** One `config_schema` field (addendum §1's closed set). */
function ConfigFieldControl({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void }) {
  const labelId = useId()
  if (field.type === 'bool') {
    return (
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-body">{field.label}</span>
        <Switch aria-labelledby={labelId} checked={typeof value === 'boolean' ? value : field.default} onCheckedChange={(on) => onChange(on)} />
      </div>
    )
  }
  if (field.type === 'choice') {
    const selected = String(value ?? field.default)
    return (
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-body">{field.label}</span>
        <ToggleGroup
          aria-labelledby={labelId}
          size="sm"
          value={[selected]}
          onValueChange={(v) => {
            const pick = field.options.find((o) => String(o.value) === v[0])
            if (pick) onChange(pick.value)
          }}
        >
          {field.options.map((o) => (
            <ToggleGroupItem key={String(o.value)} value={String(o.value)} className="px-2 text-label">{o.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    )
  }
  return <LabelFieldControl label={field.label} defaultName={field.default_name} value={value} onChange={onChange} />
}

/** A label name. Commits on blur or ↵ (and swallows that ↵ so a setup
 *  step doesn't advance). Phase 3 can swap in C4's LabelPicker through
 *  `BRIEF_MODULES[id].Settings`. */
function LabelFieldControl({ label, defaultName, value, onChange }: { label: string; defaultName: string; value: unknown; onChange: (v: unknown) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (typeof value === 'string' ? value : defaultName)
  const commit = () => {
    if (draft === null) return
    const next = draft.trim() || defaultName
    setDraft(null)
    if (next !== value) onChange(next)
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-body">{label}</label>
      <Input
        id={id}
        className="w-40"
        value={shown}
        placeholder={defaultName}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
    </div>
  )
}
