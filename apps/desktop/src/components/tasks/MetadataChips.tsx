import { useEffect, useMemo, useState } from 'react'
import { format, isToday, isTomorrow, parseISO } from 'date-fns'
import { Calendar, FileText, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { labelColor } from '@/lib/labelColors'
import { useDataProvider } from '@/services/provider-context'
import type { DataProvider } from '@/services/data-provider'
import type { Document, Project, Section } from '@nimble/types'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { LabelPicker } from '@/components/tasks/LabelPicker'
import { DueDatePopover, type DueValue } from '@/components/tasks/DueDatePopover'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ChipValues {
  priority: number
  due: DueValue
  labelIds: string[]
  projectId?: string
  sectionId?: string | null
  linkedDocId?: string | null
}

export type ExtraField = 'project' | 'section' | 'linkedDoc'

interface MetadataChipsProps {
  values: ChipValues
  onChange: (patch: Partial<ChipValues>) => void
  /** composer's `[+]` adds Project, Section; details' `[+]` adds Section, Linked doc (Decision 17). */
  context: 'composer' | 'details'
  projects?: Project[]
  sections?: Section[]
  labels: { id: string; name: string; color: string }[]
}

// Normal 1 / Medium 2 / High 3 / Urgent 4.
const PRIORITY_OPTIONS = [
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

const EXTRA_FIELDS_BY_CONTEXT: Record<MetadataChipsProps['context'], ExtraField[]> = {
  composer: ['project', 'section'],
  details: ['section', 'linkedDoc'],
}

const EXTRA_FIELD_LABELS: Record<ExtraField, string> = {
  project: 'Project',
  section: 'Section',
  linkedDoc: 'Linked doc',
}

const EMPTY_DUE: DueValue = { dueDate: null, dueTime: null, durationMinutes: null, recurrenceRule: null }

const CHIP_EMPTY =
  'h-6 rounded-md border border-border px-2.5 text-body text-muted-foreground hover:bg-accent transition-colors inline-flex items-center outline-none'
const CHIP_FILLED = 'h-6 rounded-md bg-secondary border border-input pl-2.5 pr-1 text-body text-foreground flex items-center gap-[5px]'
const CHIP_PLUS =
  'h-6 rounded-md border border-dashed border-input px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors inline-flex items-center justify-center outline-none'

/** Relative due label, mirroring DueDateBadge's logic (TaskItem.tsx) — same
 * Today/Tomorrow/`MMM d` convention, kept in one place per that badge's own
 * date-math comment. */
function formatDueLabel(dateStr: string): string {
  const parsed = parseISO(dateStr)
  if (isToday(parsed)) return 'Today'
  if (isTomorrow(parsed)) return 'Tomorrow'
  return format(parsed, 'MMM d')
}

/** Trailing ✕ shared by every filled chip — 12px icon in a size-4 hit area,
 * revealed on chip hover via the chip's own `group/chip`. stopPropagation
 * keeps the click from also opening/toggling the chip's picker. */
function ClearButton({ onClear, label }: { onClear: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClear()
      }}
      className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/chip:opacity-100 hover:text-foreground"
    >
      <X className="size-3" />
    </button>
  )
}

// ── Priority ──

function PriorityChip({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  const filled = value >= 2
  const opt = PRIORITY_OPTIONS.find((o) => o.value === value)

  const menu = (
    <DropdownMenuContent align="start">
      {PRIORITY_OPTIONS.map((o) => (
        <DropdownMenuItem key={o.value} onClick={() => onChange(o.value)}>
          <PriorityBars priority={o.value} />
          {o.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  )

  if (!filled) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className={CHIP_EMPTY}>Priority</DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    )
  }

  return (
    <div className={cn(CHIP_FILLED, 'group/chip')}>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-[5px] outline-none">
          <PriorityBars priority={value} />
          {opt?.label}
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      <ClearButton onClear={() => onChange(1)} label="Clear priority" />
    </div>
  )
}

// ── Due ──

function DueChip({ value, onChange }: { value: DueValue; onChange: (v: DueValue) => void }) {
  if (!value.dueDate) {
    return (
      <DueDatePopover value={value} onChange={onChange}>
        {/* A real <button> here, not a plain <div> — DueDatePopover's own
            trigger wrapper is `display: contents` (see its doc comment), and
            display:contents elements are excluded from the browser's tab
            order even with an explicit tabIndex, so a non-interactive child
            would be keyboard-unreachable. Nesting a <button> inside that
            wrapper's <div> is valid HTML (only <button> inside <button> is
            the anti-pattern), and its native Enter/Space click bubbles up to
            the wrapper, which is what Base UI listens on to open the popover. */}
        <button type="button" className={CHIP_EMPTY}>
          Due
        </button>
      </DueDatePopover>
    )
  }

  return (
    <div className={cn(CHIP_FILLED, 'group/chip')}>
      <DueDatePopover value={value} onChange={onChange}>
        <button type="button" className="flex items-center gap-[5px] outline-none">
          <Calendar className="size-3" />
          Due {formatDueLabel(value.dueDate)}
        </button>
      </DueDatePopover>
      <ClearButton onClear={() => onChange(EMPTY_DUE)} label="Clear due date" />
    </div>
  )
}

// ── Labels ──

function LabelsChips({
  labelIds,
  labels,
  onChange,
}: {
  labelIds: string[]
  labels: { id: string; name: string; color: string }[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo(
    () => labelIds.map((id) => labels.find((l) => l.id === id)).filter((l): l is (typeof labels)[number] => !!l),
    [labelIds, labels],
  )

  const content = (
    <PopoverContent side="bottom" align="start" sideOffset={4} className="w-64 p-2">
      <LabelPicker value={labelIds} onChange={onChange} />
    </PopoverContent>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* nativeButton={false} + a <div> host avoids nesting <button> inside
          the default <button> trigger (see the Due chip's comment). The host
          must NOT be `display: contents`, though — floating-ui anchors the
          popover on this element's own getBoundingClientRect(), and a
          contents box collapses to a zero-size rect at (0,0), which pins
          every popover to the viewport's top-left corner instead of the
          chip. `inline-flex` keeps a real, correctly-sized box (verified via
          harness: contents anchored at x:0,y:0; inline-flex anchors flush
          under the chip) without disrupting the row's inline flow.

          tabIndex={-1}: now that the host is a real (focusable) box instead
          of an unfocusable `contents` one, useButton's unconditional
          tabIndex=0 + role="button" on it becomes a REAL, redundant Tab
          stop sitting directly in front of the real <button>s nested inside
          (verified via harness: without this, Tab order was host → label1 →
          clear1 → label2 → ..., an extra stop with no distinct action from
          the first label chip). The host's own click listener still opens
          the popover from a bubbled click or a real button's native
          Enter/Space-synthesized click, so it doesn't need to be
          independently tabbable. */}
      <PopoverTrigger
        className="inline-flex items-center gap-1.5"
        nativeButton={false}
        render={<div className="inline-flex items-center gap-1.5" tabIndex={-1} />}
      >
        {/* Real <button>s, not <div>s — see the Due chip's comment above:
            display:contents trigger wrappers drop non-button children from
            the tab order entirely. */}
        {selected.length === 0 ? (
          <button type="button" className={CHIP_EMPTY}>
            Labels
          </button>
        ) : (
          selected.map((label) => (
            <div key={label.id} className={cn(CHIP_FILLED, 'group/chip')}>
              <button type="button" className="flex items-center gap-[5px] outline-none">
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: labelColor(label.color) }} />
                {label.name}
              </button>
              <ClearButton
                onClear={() => onChange(labelIds.filter((id) => id !== label.id))}
                label={`Remove ${label.name}`}
              />
            </div>
          ))
        )}
      </PopoverTrigger>
      {content}
    </Popover>
  )
}

// ── Project / Section (shared shape: id + name) ──

function EntityChip<T extends { id: string; name: string }>({
  entity,
  options,
  emptyLabel,
  open,
  onOpenChange,
  onSelect,
  onClear,
  clearLabel,
}: {
  entity: T | undefined
  options: T[]
  emptyLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onClear: () => void
  clearLabel: string
}) {
  const menu = (
    <DropdownMenuContent align="start">
      {options.map((o) => (
        <DropdownMenuItem key={o.id} onClick={() => onSelect(o.id)}>
          {o.name}
        </DropdownMenuItem>
      ))}
      {options.length === 0 && <p className="px-1.5 py-1 text-label text-muted-foreground">None available</p>}
    </DropdownMenuContent>
  )

  if (!entity) {
    return (
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger className={CHIP_EMPTY}>{emptyLabel}</DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    )
  }

  return (
    <div className={cn(CHIP_FILLED, 'group/chip')}>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger className="outline-none">{entity.name}</DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      <ClearButton onClear={onClear} label={clearLabel} />
    </div>
  )
}

// ── Linked doc (lifted from TaskDetailPage.tsx's LinkedDocSection) ──

function LinkedDocChip({
  linkedDocId,
  dp,
  open,
  onOpenChange,
  onSelect,
  onClear,
}: {
  linkedDocId: string | null | undefined
  dp: DataProvider
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const [title, setTitle] = useState<string | null>(null)
  const [docs, setDocs] = useState<Document[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!linkedDocId) {
      setTitle(null)
      return
    }
    let cancelled = false
    dp.docs
      .getDocument(linkedDocId)
      .then((doc) => {
        if (!cancelled) setTitle(doc?.title ?? null)
      })
      .catch(() => {
        if (!cancelled) setTitle(null)
      })
    return () => {
      cancelled = true
    }
  }, [linkedDocId, dp])

  useEffect(() => {
    if (!open) return
    dp.docs
      .getDocuments()
      .then(setDocs)
      .catch(() => setDocs([]))
  }, [open, dp])

  const filtered = query.trim() ? docs.filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase())) : docs

  // Real <button>s, not <div>s — see the Due chip's comment: display:contents
  // trigger wrappers drop non-button children from the tab order entirely.
  const trigger = linkedDocId ? (
    <button type="button" className="flex items-center gap-[5px] outline-none">
      {title ?? 'Untitled'}
    </button>
  ) : (
    <button type="button" className={CHIP_EMPTY}>
      Linked doc
    </button>
  )

  const content = (
    <PopoverContent side="bottom" align="start" sideOffset={4} className="w-64 gap-1.5 p-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search docs..."
        className="w-full border-b border-border/20 bg-transparent py-1 text-body outline-none placeholder:text-muted-foreground"
        autoFocus
      />
      <div className="max-h-48 space-y-0.5 overflow-y-auto">
        {filtered.slice(0, 8).map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => {
              onSelect(doc.id)
              setQuery('')
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-body transition-colors hover:bg-accent/20"
          >
            <FileText className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{doc.title || 'Untitled'}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="py-1 text-meta text-muted-foreground">No docs found</p>}
      </div>
    </PopoverContent>
  )

  const popover = (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* inline-flex, not contents — see LabelsChips' comment: a
          display:contents host collapses to a zero-size rect and pins the
          popover to the viewport's top-left instead of anchoring to the chip.
          tabIndex={-1} — see LabelsChips' comment: without it, the now-real
          box picks up a redundant Tab stop in front of the real nested
          <button>. */}
      <PopoverTrigger
        className="inline-flex items-center"
        nativeButton={false}
        render={<div className="inline-flex items-center" tabIndex={-1} />}
      >
        {trigger}
      </PopoverTrigger>
      {content}
    </Popover>
  )

  if (!linkedDocId) return popover

  return (
    <div className={cn(CHIP_FILLED, 'group/chip')}>
      {popover}
      <ClearButton onClear={onClear} label="Clear linked doc" />
    </div>
  )
}

// ── Row ──

/**
 * Shared metadata chip row consumed by Task 8's composer and Task 9's
 * details page. Priority/Due/Labels are always visible (empty or filled);
 * Project/Section/LinkedDoc only render once set, and are otherwise reached
 * via the `[+]` menu, which lists only the not-yet-set extra fields for the
 * current context (Decision 17) and immediately opens the chosen field's
 * own picker.
 */
export function MetadataChips({ values, onChange, context, projects = [], sections = [], labels }: MetadataChipsProps) {
  const dp = useDataProvider()
  const [openField, setOpenField] = useState<ExtraField | null>(null)

  const extraFields = EXTRA_FIELDS_BY_CONTEXT[context]

  const isSet = (field: ExtraField): boolean => {
    if (field === 'project') return !!values.projectId
    if (field === 'section') return !!values.sectionId
    return !!values.linkedDocId
  }

  const availableExtraFields = useMemo(
    () => extraFields.filter((f) => !isSet(f)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extraFields, values.projectId, values.sectionId, values.linkedDocId],
  )

  const project = projects.find((p) => p.id === values.projectId)
  const section = sections.find((s) => s.id === values.sectionId)

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5')}>
      <PriorityChip value={values.priority} onChange={(priority) => onChange({ priority })} />
      <DueChip value={values.due} onChange={(due) => onChange({ due })} />
      <LabelsChips labelIds={values.labelIds} labels={labels} onChange={(labelIds) => onChange({ labelIds })} />

      {extraFields.map((field) => {
        const set = isSet(field)
        const pending = openField === field
        if (!set && !pending) return null

        if (field === 'project') {
          return (
            <EntityChip
              key="project"
              entity={project}
              options={projects}
              emptyLabel="Project"
              open={pending}
              onOpenChange={(o) => setOpenField(o ? 'project' : null)}
              onSelect={(id) => {
                onChange({ projectId: id })
                setOpenField(null)
              }}
              onClear={() => onChange({ projectId: undefined })}
              clearLabel="Clear project"
            />
          )
        }

        if (field === 'section') {
          return (
            <EntityChip
              key="section"
              entity={section}
              options={sections}
              emptyLabel="Section"
              open={pending}
              onOpenChange={(o) => setOpenField(o ? 'section' : null)}
              onSelect={(id) => {
                onChange({ sectionId: id })
                setOpenField(null)
              }}
              onClear={() => onChange({ sectionId: null })}
              clearLabel="Clear section"
            />
          )
        }

        return (
          <LinkedDocChip
            key="linkedDoc"
            linkedDocId={values.linkedDocId}
            dp={dp}
            open={pending}
            onOpenChange={(o) => setOpenField(o ? 'linkedDoc' : null)}
            onSelect={(id) => {
              onChange({ linkedDocId: id })
              setOpenField(null)
            }}
            onClear={() => onChange({ linkedDocId: null })}
          />
        )
      })}

      {availableExtraFields.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={CHIP_PLUS} aria-label="Add field">
            <Plus className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {availableExtraFields.map((f) => (
              <DropdownMenuItem key={f} onClick={() => setOpenField(f)}>
                {EXTRA_FIELD_LABELS[f]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
