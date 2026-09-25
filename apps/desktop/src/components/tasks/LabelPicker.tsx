import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { Label } from '@nimble/types'
import { cn } from '@/lib/utils'
import { labelColor, DEFAULT_LABEL_COLOR } from '@/lib/labelColors'
import { useDataProvider } from '@/services/provider-context'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { filterSections, isFlat, orderTaskLabels, pickerCreateAction, pickerSections, toggleLabel } from '@/lib/labelTaxonomy'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Caption } from '@/components/shared/typography'

// `onClick` and `onRemove` are mutually exclusive by convention — the
// display/remove chip (LabelPicker's selected-labels row) never passes
// `onClick`, and the filter-chip usage (label filter row) never passes
// `onRemove` — a nested `<button>` for removal only ever renders inside
// the plain `<span>` branch below.
export function LabelChip({
  label,
  onRemove,
  onClick,
  selected,
}: {
  label: Label
  onRemove?: () => void
  onClick?: () => void
  selected?: boolean
}) {
  const classes = cn(
    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-meta transition-colors',
    selected
      ? 'border-transparent bg-secondary text-secondary-foreground'
      : 'border-border/60 text-muted-foreground',
    onClick && !selected && 'cursor-pointer hover:text-foreground hover:bg-hover',
  )

  const swatchAndName = (
    <>
      <span className="size-2 rounded-full" style={{ background: labelColor(label.color) }} />
      {label.name}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={selected} className={classes}>
        {swatchAndName}
      </button>
    )
  }

  return (
    <span className={classes}>
      {swatchAndName}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 opacity-50 hover:opacity-100" aria-label={`Remove ${label.name}`}>×</button>
      )}
    </span>
  )
}

/** A row is a <label> (whole row clickable, and the existing e2e selectors
 *  keep working) around a real role=checkbox / role=radio button, so Space
 *  and Enter toggle natively. The explicit aria-label names the control for
 *  every AT and axe (implicit <label> naming of a <button> is unreliable). */
function LabelOption({ label, checked, radio, onToggle }: { label: Label; checked: boolean; radio: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-hover has-[:focus-visible]:bg-hover">
      <button
        type="button"
        role={radio ? 'radio' : 'checkbox'}
        aria-checked={checked}
        aria-label={label.name}
        data-label-control=""
        // Explicit tabIndex: WebKit (and the app's WKWebView) skips plain
        // <button>s on Tab, which would drop keyboard users out of the list.
        tabIndex={0}
        onClick={onToggle}
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center border border-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          radio ? 'rounded-full' : 'rounded-[4px]',
          checked && 'border-transparent bg-primary text-primary-foreground',
        )}
      >
        {checked && (radio
          ? <span className="size-1.5 rounded-full bg-current" />
          : <Check className="size-2.5" strokeWidth={3} aria-hidden />)}
      </button>
      <span className="size-2 shrink-0 rounded-full" style={{ background: labelColor(label.color) }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-body">{label.name}</span>
    </label>
  )
}

export type LabelPickerMode = 'edit' | 'filter'

/** The searchable, grouped list. `edit` honours "Pick one" (radios) and can
 *  create or restore; `filter` is plain any-of and lists system labels last. */
export function LabelPickerList({ value, onChange, mode = 'edit' }: { value: string[]; onChange: (ids: string[]) => void; mode?: LabelPickerMode }) {
  const dp = useDataProvider()
  const { labels, groups, loading, reload } = useLabelTaxonomy()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()

  const all = useMemo(() => (mode === 'filter' ? filterSections(labels, groups) : pickerSections(labels, groups)), [mode, labels, groups])
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => (q ? all.map((s) => ({ ...s, labels: s.labels.filter((l) => l.name.toLowerCase().includes(q)) })).filter((s) => s.labels.length > 0) : all),
    [all, q],
  )
  const action = mode === 'edit' ? pickerCreateAction(query, labels, groups) : ({ kind: 'none' } as const)
  const flat = isFlat(shown)

  const toggle = (id: string) => {
    if (mode === 'filter') onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
    else onChange(toggleLabel(value, id, labels, groups))
  }

  const runAction = async () => {
    if (busy || action.kind === 'none') return
    if (action.kind === 'apply') {
      if (!value.includes(action.label.id)) toggle(action.label.id)
      setQuery('')
      return
    }
    setBusy(true)
    try {
      if (action.kind === 'restore') {
        await dp.labels.restore([action.label.id])
        onChange(toggleLabel(value, action.label.id, labels, groups))
      } else {
        const created = await dp.labels.create(action.name, DEFAULT_LABEL_COLOR)
        onChange([...value, created.id])
      }
      reload()
      setQuery('')
    } catch (e) {
      toast.error(`Couldn't save the label: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  // ↑/↓ move through every row across sections; ↑ from the first row returns to the field.
  const moveFocus = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const controls = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-label-control]') ?? [])
    if (controls.length === 0) return
    e.preventDefault()
    const at = controls.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') (controls[at + 1] ?? controls[controls.length - 1]).focus()
    else if (at <= 0) inputRef.current?.focus()
    else controls[at - 1].focus()
  }

  return (
    <div className="flex flex-col gap-1.5" onKeyDown={moveFocus}>
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (action.kind !== 'none') { void runAction(); return }
          const only = shown.flatMap((s) => s.labels)
          if (only.length === 1) toggle(only[0].id)
        }}
        placeholder={mode === 'filter' ? 'Filter labels…' : 'Search or create…'}
        aria-label={mode === 'filter' ? 'Filter labels' : 'Search or create a label'}
        className="h-7 text-meta"
        autoFocus
      />
      <div ref={listRef} className="max-h-64 space-y-1 overflow-y-auto">
        {loading && labels.length === 0 && (
          <div className="space-y-1.5 px-1.5 py-1" aria-hidden>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {shown.map((section) => {
          const headerId = `${baseId}-${section.group?.id ?? 'ungrouped'}`
          const radio = mode === 'edit' && !!section.group?.exclusive
          return (
            <div
              key={section.group?.id ?? 'ungrouped'}
              role={radio ? 'radiogroup' : 'group'}
              aria-labelledby={flat ? undefined : headerId}
              aria-label={flat ? 'Labels' : undefined}
            >
              {!flat && (
                <Caption as="div" id={headerId} className="px-1.5 pt-1 pb-0.5">
                  {section.group?.name ?? 'Ungrouped'}
                </Caption>
              )}
              {section.labels.map((label) => (
                <LabelOption key={label.id} label={label} checked={value.includes(label.id)} radio={radio} onToggle={() => toggle(label.id)} />
              ))}
            </div>
          )
        })}
        {!loading && all.length === 0 && !q && (
          <p className="px-1.5 py-1 text-label text-muted-foreground">No labels yet.</p>
        )}
        {(action.kind === 'create' || action.kind === 'restore') && (
          <button
            type="button"
            data-label-control=""
            tabIndex={0}
            onClick={() => void runAction()}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-body text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:bg-hover disabled:opacity-50"
          >
            {action.kind === 'restore' ? <RotateCcw className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
            {action.kind === 'restore' ? `Restore "${action.label.name}"` : `Create "${action.name}"`}
          </button>
        )}
      </div>
    </div>
  )
}

interface LabelPickerProps {
  value: string[]
  onChange: (labelIds: string[]) => void
  /** Controlled state of the "Add label" list. Omit both to let the picker own it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function LabelPicker({ value, onChange, open: openProp, onOpenChange }: LabelPickerProps) {
  const { labels, groups } = useLabelTaxonomy()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  // Chips: taxonomy order; system labels stay hidden (they are kept in `value`).
  const selectedLabels = useMemo(() => orderTaskLabels(value, labels, groups), [value, labels, groups])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedLabels.map((label) => (
        <LabelChip key={label.id} label={label} onRemove={() => onChange(value.filter((v) => v !== label.id))} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-meta text-muted-foreground hover:border-border hover:text-foreground transition-colors"
          aria-label="Add label"
        >
          <Plus className="size-3" />
          Label
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-60 gap-1.5 p-1.5">
          <LabelPickerList value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
