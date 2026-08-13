import { useRef, useState, type ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  RECURRENCE_OPTIONS,
  parseRecurrenceRule,
  formatRecurrenceBase,
  type RecurrenceUnit,
} from '@/lib/recurrence'

export interface DueValue {
  dueDate: string | null
  dueTime: string | null
  durationMinutes: number | null
  recurrenceRule: string | null
}

interface DueDatePopoverProps {
  value: DueValue
  onChange: (v: DueValue) => void
  children: ReactNode /* trigger */
}

const DURATION_PRESETS = [
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
]

/* Presets pulled straight from the canonical RECURRENCE_OPTIONS grammar
 * (@/lib/recurrence, mirroring nimble-core/src/recurrence.rs). "Weekdays"
 * is deliberately omitted here — the grammar has no weekday-only unit
 * (nimble-core/src/recurrence.rs's own test suite asserts "weekdays" is
 * unparseable), so synthesizing that string would write a rule that can
 * never auto-recur. */
const REPEAT_PRESETS = RECURRENCE_OPTIONS.filter((o) =>
  ['every day', 'every week', 'every month'].includes(o.value),
)

const CUSTOM_UNITS: { value: RecurrenceUnit; label: string }[] = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
]

function formatDurationLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatTimeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

function formatRecurrenceLabel(rule: string): string {
  const parsed = parseRecurrenceRule(rule)
  return parsed ? formatRecurrenceBase(parsed) : rule
}

type ExpandedSection = 'time' | 'duration' | 'repeat' | null

const COLLAPSED_EMPTY =
  'h-7 w-full rounded-[7px] border border-border text-body text-muted-foreground/60 flex items-center justify-center hover:bg-accent transition-colors'
const COLLAPSED_FILLED =
  'h-7 w-full rounded-[7px] border border-border flex items-center justify-between px-2'

/**
 * Due-date popover: shadcn Calendar plus optional time, duration, and
 * repeat, all inside one popover. Fully controlled — every interaction
 * calls `onChange` with the next full `DueValue`; the caller (Task 7's
 * MetadataChips) owns persistence. Local state here is UI-only: which
 * row is expanded, and the transient text buffers for the two custom
 * inputs (minutes / recurrence interval).
 */
export function DueDatePopover({ value, onChange, children }: DueDatePopoverProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<ExpandedSection>(null)
  const [customMinutes, setCustomMinutes] = useState('')
  const [customInterval, setCustomInterval] = useState('1')
  const [customUnit, setCustomUnit] = useState<RecurrenceUnit>('day')
  // Sibling-control containers for the two custom-input blur races below —
  // see commitCustomMinutes/commitCustomRecurrence.
  const durationRowRef = useRef<HTMLDivElement>(null)
  const repeatSectionRef = useRef<HTMLDivElement>(null)

  const selectedDate = value.dueDate ? parseISO(value.dueDate) : undefined

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setExpanded(null)
  }

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      // Clearing the date also clears time + duration client-side (a
      // time/duration with no date is meaningless). Recurrence is left
      // untouched.
      onChange({ ...value, dueDate: null, dueTime: null, durationMinutes: null })
      return
    }
    // format(date, 'yyyy-MM-dd') / parseISO round-trip in local time (no
    // toISOString/UTC conversion) — same local-date convention TaskItem's
    // DueDateBadge uses for this app's date-only strings.
    onChange({ ...value, dueDate: format(date, 'yyyy-MM-dd') })
  }

  const commitTime = (time: string) => {
    onChange({ ...value, dueTime: time || null })
  }

  const commitDuration = (minutes: number | null) => {
    onChange({ ...value, durationMinutes: minutes })
    setExpanded(null)
    setCustomMinutes('')
  }

  // relatedTarget is the element about to receive focus. When it's a sibling
  // control inside the same expanded row (a duration chip, a repeat preset,
  // or the unit Select's trigger), that control's own click/select handler
  // is about to run and should be the one to decide the value — committing
  // here first would set durationMinutes/recurrenceRule AND collapse the row
  // (unmounting the chip) before its click ever lands, so the click gets
  // silently swallowed and the abandoned typed-but-not-confirmed value wins
  // instead. Skip the blur-commit in that case and let the sibling's own
  // handler run normally; only commit when focus is truly leaving the row
  // (e.g. clicking the calendar, or clicking outside the popover).
  const commitCustomMinutes = (relatedTarget?: EventTarget | null) => {
    if (relatedTarget instanceof Node && durationRowRef.current?.contains(relatedTarget)) return
    const n = Number(customMinutes)
    if (customMinutes.trim() && Number.isFinite(n) && n > 0) {
      commitDuration(Math.round(n))
    }
  }

  const commitRecurrence = (rule: string | null) => {
    onChange({ ...value, recurrenceRule: rule })
    setExpanded(null)
  }

  const commitCustomRecurrence = (unit: RecurrenceUnit, relatedTarget?: EventTarget | null) => {
    if (relatedTarget instanceof Node && repeatSectionRef.current?.contains(relatedTarget)) return
    const n = Number(customInterval)
    if (!Number.isFinite(n) || n <= 0) return
    commitRecurrence(formatRecurrenceBase({ interval: Math.round(n), unit, time: null }))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* render as a <div>, not the default <button> — the caller's trigger
          (e.g. Task 7's MetadataChips chip) is very likely a <button> of its
          own, and nesting <button> inside <button> is invalid HTML that
          silently breaks click handling (same class of bug the codebase
          already avoids for TooltipTrigger). nativeButton={false} tells
          Base UI's useButton to add the button a11y semantics (role,
          tabIndex, Enter/Space handling) onto the div host instead.

          `inline-flex`, NOT `contents` — a `display: contents` host has no
          box, so `getBoundingClientRect()` on it collapses to a zero-size
          rect at (0,0), and floating-ui (which Popover positioning is built
          on) anchors the popup there instead of near the trigger — every
          consumer's popover rendered pinned to the page's top-left corner.
          `inline-flex items-center` gives a real, correctly-sized box
          without disrupting the caller's inline layout (verified via
          harness: contents anchored at x:0,y:0; inline-flex anchors flush
          under the trigger).

          tabIndex={-1} on the render div: useButton unconditionally adds
          tabIndex=0 + role="button" to this host, which (now that the host
          is a real, focusable box instead of an unfocusable `contents` one)
          becomes a redundant Tab stop sitting in front of whatever real
          control the caller nests inside `children` — e.g. MetadataChips'
          chip buttons. The host doesn't need to be independently
          reachable: its own click listener is what opens the popover, and
          that still fires from a bubbled click OR a real nested button's
          native Enter/Space-synthesized click, so removing this host from
          the tab order doesn't break keyboard activation, only the extra
          stop. */}
      <PopoverTrigger
        className="inline-flex items-center"
        nativeButton={false}
        render={<div className="inline-flex items-center" tabIndex={-1} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-[228px] rounded-[10px] border border-input bg-card p-2 shadow-[0px_6px_16px_-2px_rgba(0,0,0,0.12)] ring-0"
      >
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          className="p-0"
        />

        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
          {/* Add time */}
          {expanded === 'time' ? (
            <Input
              type="time"
              autoFocus
              value={value.dueTime ?? ''}
              onChange={(e) => commitTime(e.target.value)}
              onBlur={() => setExpanded(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setExpanded(null)
              }}
              className="h-7 text-meta"
              aria-label="Due time"
            />
          ) : value.dueTime ? (
            <div className={COLLAPSED_FILLED}>
              <button
                type="button"
                onClick={() => setExpanded('time')}
                className="text-body text-foreground"
              >
                {formatTimeLabel(value.dueTime)}
              </button>
              <button
                type="button"
                aria-label="Clear due time"
                onClick={() => commitTime('')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setExpanded('time')} className={COLLAPSED_EMPTY}>
              Add time
            </button>
          )}

          {/* Duration */}
          {expanded === 'duration' ? (
            <div ref={durationRowRef} className="flex items-center gap-1">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => commitDuration(preset.value)}
                  className={cn(
                    'h-6 rounded-md border border-border px-2 text-meta hover:bg-accent transition-colors',
                    value.durationMinutes === preset.value && 'bg-secondary border-input',
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <Input
                autoFocus
                inputMode="numeric"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={(e) => commitCustomMinutes(e.relatedTarget)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCustomMinutes()
                }}
                placeholder="min"
                className="h-6 w-[3ch] px-1 text-center text-meta"
                aria-label="Custom duration in minutes"
              />
            </div>
          ) : value.durationMinutes != null ? (
            <div className={COLLAPSED_FILLED}>
              <button
                type="button"
                onClick={() => setExpanded('duration')}
                className="text-body text-foreground"
              >
                {formatDurationLabel(value.durationMinutes)}
              </button>
              <button
                type="button"
                aria-label="Clear duration"
                onClick={() => commitDuration(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setExpanded('duration')} className={COLLAPSED_EMPTY}>
              Duration
            </button>
          )}

          {/* Repeat */}
          {expanded === 'repeat' ? (
            <div ref={repeatSectionRef} className="flex flex-col gap-0.5">
              {REPEAT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => commitRecurrence(preset.value)}
                  className={cn(
                    'flex h-7 items-center rounded-md px-1.5 text-left text-body hover:bg-accent transition-colors',
                    value.recurrenceRule === preset.value && 'bg-secondary',
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <div className="mt-0.5 flex items-center gap-1.5 border-t border-border pt-1.5">
                <span className="text-meta text-muted-foreground">Every</span>
                <Input
                  inputMode="numeric"
                  value={customInterval}
                  onChange={(e) => setCustomInterval(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={(e) => commitCustomRecurrence(customUnit, e.relatedTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitCustomRecurrence(customUnit)
                  }}
                  className="h-6 w-[3ch] px-1 text-center text-meta"
                  aria-label="Recurrence interval"
                />
                <Select
                  value={customUnit}
                  onValueChange={(v) => {
                    const unit = v as RecurrenceUnit
                    setCustomUnit(unit)
                    commitCustomRecurrence(unit)
                  }}
                >
                  <SelectTrigger size="sm" className="h-6 text-meta">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOM_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : value.recurrenceRule ? (
            <div className={COLLAPSED_FILLED}>
              <button
                type="button"
                onClick={() => setExpanded('repeat')}
                className="text-body text-foreground"
              >
                {formatRecurrenceLabel(value.recurrenceRule)}
              </button>
              <button
                type="button"
                aria-label="Clear repeat"
                onClick={() => commitRecurrence(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setExpanded('repeat')} className={COLLAPSED_EMPTY}>
              Repeat
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
