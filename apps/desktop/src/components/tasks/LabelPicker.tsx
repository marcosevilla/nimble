import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { labelColor, DEFAULT_LABEL_COLOR } from '@/lib/labelColors'
import { useDataProvider } from '@/services/provider-context'
import type { Label } from '@nimble/types'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

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
    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
    selected
      ? 'border-transparent bg-secondary text-secondary-foreground'
      : 'border-border/60 text-muted-foreground',
    onClick && !selected && 'cursor-pointer hover:text-foreground hover:bg-accent/20',
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

interface LabelPickerProps {
  value: string[]
  onChange: (labelIds: string[]) => void
}

export function LabelPicker({ value, onChange }: LabelPickerProps) {
  const dp = useDataProvider()
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    dp.labels
      .list()
      .then(setLabels)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [dp])

  const selectedLabels = useMemo(
    () => value.map((id) => labels.find((l) => l.id === id)).filter((l): l is Label => !!l),
    [value, labels],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return labels
    return labels.filter((l) => l.name.toLowerCase().includes(q))
  }, [labels, query])

  const exactMatch = useMemo(
    () => labels.find((l) => l.name.toLowerCase() === query.trim().toLowerCase()),
    [labels, query],
  )

  const toggleLabel = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  const handleRemove = (id: string) => {
    onChange(value.filter((v) => v !== id))
  }

  const handleEnter = async () => {
    const trimmed = query.trim()
    if (!trimmed || creating) return

    if (exactMatch) {
      if (!value.includes(exactMatch.id)) toggleLabel(exactMatch.id)
      setQuery('')
      return
    }

    setCreating(true)
    try {
      const label = await dp.labels.create(trimmed, DEFAULT_LABEL_COLOR)
      setLabels((prev) => [...prev, label])
      onChange([...value, label.id])
      setQuery('')
    } catch (e) {
      toast.error(`Failed to create label: ${e}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedLabels.map((label) => (
        <LabelChip key={label.id} label={label} onRemove={() => handleRemove(label.id)} />
      ))}

      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery('') }}>
        <PopoverTrigger
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-xs text-muted-foreground hover:border-border hover:text-foreground transition-colors"
          aria-label="Add label"
        >
          <Plus className="size-3" />
          Label
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-56 gap-1.5 p-1.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleEnter() }
            }}
            placeholder="Search or create..."
            className="h-7 text-meta"
            autoFocus
          />

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {loading && (
              <p className="px-1.5 py-1 text-label text-muted-foreground">Loading...</p>
            )}

            {!loading && filtered.map((label) => {
              const checked = value.includes(label.id)
              return (
                <label
                  key={label.id}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/10 transition-colors cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleLabel(label.id)}
                  />
                  <span className="size-2 rounded-full shrink-0" style={{ background: labelColor(label.color) }} />
                  <span className="flex-1 min-w-0 truncate text-body">{label.name}</span>
                </label>
              )
            })}

            {!loading && filtered.length === 0 && !query.trim() && (
              <p className="px-1.5 py-1 text-label text-muted-foreground">No labels yet.</p>
            )}

            {!loading && query.trim() && !exactMatch && (
              <button
                onClick={handleEnter}
                disabled={creating}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-body text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <Plus className="size-3" />
                {creating ? 'Creating...' : `Create "${query.trim()}"`}
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
