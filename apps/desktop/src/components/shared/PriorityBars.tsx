import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface PriorityBarsProps {
  /** 1 (Normal) - 4 (Urgent). Higher = more urgent. */
  priority: number
  /** Visual size. `md` is ~50% larger, suitable for pickers/dialogs. */
  size?: 'sm' | 'md'
  className?: string
  /** Accessibility label override. Default is `Priority {level}`. */
  label?: string
}

/**
 * Linear-style cell-signal priority indicator: three bars of increasing
 * height. Filled bars = urgency level.
 *
 * - Normal (1):  nothing (blank spacer)
 * - Medium (2):  ▁▁▁ → ▂
 * - High   (3):  ▂▄
 * - Urgent (4):  ▂▄▆
 *
 * Color-agnostic — all bars share the foreground / muted-foreground tokens.
 */
export function PriorityBars({ priority, size = 'sm', className, label }: PriorityBarsProps) {
  const filled = priority >= 2 ? Math.min(3, priority - 1) : 0

  // Trigger a micro-pulse on the bars whenever the priority changes.
  // Skip the initial render so rows don't all pulse when a list mounts.
  const [pulseKey, setPulseKey] = useState(0)
  const prev = useRef(priority)
  useEffect(() => {
    if (prev.current !== priority) {
      setPulseKey((k) => k + 1)
      prev.current = priority
    }
  }, [priority])

  // Container height matches the tallest bar exactly (not a padded box) —
  // `items-end` on a taller box shifts the visible bars' optical center
  // below the box's own center, which is what a flex parent's
  // `items-center` centers against. That mismatch is what made the chip's
  // icon read as sitting low relative to the label text (QA item 6).
  const container =
    size === 'md'
      ? 'w-4 h-3.5 gap-[2px]'
      : 'w-3 h-2 gap-[1.5px]'

  const heights = size === 'md'
    ? ['h-1.5', 'h-2.5', 'h-3.5']
    : ['h-1', 'h-1.5', 'h-2']

  const barWidth = size === 'md' ? 'w-[3px]' : 'w-[2px]'

  return (
    <div
      key={pulseKey}
      className={cn(
        'inline-flex shrink-0 items-end justify-center origin-center',
        container,
        pulseKey > 0 && 'animate-count-pulse',
        className,
      )}
      aria-label={label ?? (priority >= 2 ? `Priority ${priority}` : undefined)}
      role={priority >= 2 ? 'img' : undefined}
    >
      {priority >= 2 && (
        <>
          {[0, 1, 2].map((i) => {
            const isActive = i < filled
            return (
              <span
                key={i}
                className={cn(
                  'rounded-sm',
                  barWidth,
                  heights[i],
                  isActive ? 'bg-foreground' : 'bg-muted-foreground/30',
                )}
              />
            )
          })}
        </>
      )}
    </div>
  )
}
