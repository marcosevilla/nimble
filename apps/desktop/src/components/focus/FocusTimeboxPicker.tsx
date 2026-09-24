import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Caption } from '@/components/shared/typography'
import { cn } from '@/lib/utils'
import type { TimerPhase, TimerPresentation } from '@/lib/focusModel'
import {
  TIMEBOX_PRESETS,
  parseCustomMinutes,
  pomodoroConfig,
  timeboxConfig,
} from '@/lib/focusQueueIntents'
import type { FocusConfig } from '@nimble/types'

/* Count-up: amber at 25 min, deep amber at 45 (never red). Red is reserved
   for an exceeded timebox. Semantic tokens only — no copied literals. */
const PHASE_CLASS: Record<TimerPhase, string> = {
  normal: 'text-foreground',
  amber: 'text-warning',
  deepAmber: 'text-warning font-semibold',
  overtime: 'text-destructive',
}

/** `display` = --text-timer (48, full view); `sm` = --text-timer-sm (36, rail and companion). */
export type FocusTimerSize = 'sm' | 'display'

interface FocusTimeboxPickerProps {
  size?: FocusTimerSize
  config: FocusConfig
  presentation: TimerPresentation
  /** The line under the timer (budget caption joined with the task's meta). */
  caption: ReactNode
  /** Configure needs queue writes; the timer still displays when blocked. */
  disabledReason: string | null
  onConfigure: (config: FocusConfig) => void
}

/**
 * The prominent tabular timer (bottom-left of the card). Clicking it opens
 * 15/25/45/60, custom minutes and count-up; Pomodoro is a secondary option.
 * Changing a budget never starts, pauses or resets timing.
 */
export function FocusTimeboxPicker({ config, presentation, caption, disabledReason, onConfigure, size = 'sm' }: FocusTimeboxPickerProps) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const errorId = useId()
  const current = config.mode === 'timebox' ? config.budget_ms : null

  const pick = (next: FocusConfig) => {
    onConfigure(next)
    setOpen(false)
    setCustom('')
    setCustomError(null)
  }
  const commitCustom = () => {
    const minutes = parseCustomMinutes(custom)
    if (minutes == null) return setCustomError('Use whole minutes, 1–1440.')
    pick(timeboxConfig(config, minutes))
  }

  return (
    <div className="min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Focus timer ${presentation.text}, set timebox`}
          title={disabledReason ?? 'Set a timebox'}
          disabled={disabledReason != null}
          data-phase={presentation.phase}
          className={cn(
            size === 'display' ? 'text-timer' : 'text-timer-sm',
            'rounded-md transition-opacity duration-(--transition-fast) hover:opacity-70 focus-ring disabled:hover:opacity-100 motion-reduce:transition-none',
            PHASE_CLASS[presentation.phase],
          )}
        >
          {presentation.text}
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-60">
          <div role="group" aria-label="Timebox presets" className="flex gap-1.5">
            {TIMEBOX_PRESETS.map((minutes) => (
              <Button
                key={minutes}
                size="sm"
                variant={current === minutes * 60_000 ? 'default' : 'outline'}
                aria-pressed={current === minutes * 60_000}
                className="flex-1"
                onClick={() => pick(timeboxConfig(config, minutes))}
              >
                {`${minutes}m`}
              </Button>
            ))}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              commitCustom()
            }}
          >
            <input
              inputMode="numeric"
              aria-label="Custom minutes"
              aria-invalid={customError ? true : undefined}
              aria-describedby={customError ? errorId : undefined}
              placeholder="Custom min"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value)
                setCustomError(null)
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-meta outline-none focus-ring"
            />
            <Button type="submit" size="sm" variant="outline">
              Set
            </Button>
            <Button size="sm" variant="ghost" aria-pressed={config.mode === 'count_up'} onClick={() => pick(timeboxConfig(config, null))}>
              Count up
            </Button>
          </form>
          {customError && (
            <Caption id={errorId} className="text-destructive">
              {customError}
            </Caption>
          )}
          <Button
            size="xs"
            variant="ghost"
            aria-pressed={config.mode === 'pomodoro'}
            className="justify-start text-muted-foreground"
            onClick={() => pick(pomodoroConfig(config))}
          >
            {config.mode === 'pomodoro' ? 'Pomodoro on' : 'Use Pomodoro rounds'}
          </Button>
        </PopoverContent>
      </Popover>
      {caption && (
        <Caption as="div" data-slot="focus-timer-caption" className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {caption}
        </Caption>
      )}
    </div>
  )
}
