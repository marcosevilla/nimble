import { useMemo, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/shared/IconButton'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface DateStripProps {
  briefDates: Set<string>
  selected: string
  onSelect: (date: string) => void
}

function formatDatePill(dateStr: string): { day: string; weekday: string; isToday: boolean } {
  const date = new Date(dateStr + 'T12:00:00') // avoid timezone issues
  const today = new Date()
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return {
    day: date.getDate().toString(),
    weekday: date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2),
    isToday,
  }
}

function generateDateRange(center: string, range: number): string[] {
  const dates: string[] = []
  const centerDate = new Date(center + 'T12:00:00')
  for (let i = -range; i <= range; i++) {
    const d = new Date(centerDate)
    d.setDate(d.getDate() + i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

export function DateStrip({ briefDates, selected, onSelect }: DateStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dates = useMemo(() => generateDateRange(selected, 14), [selected])

  // Scroll to selected date on mount
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-selected="true"]')
    if (el) el.scrollIntoView({ inline: 'center', behavior: 'instant' })
  }, [selected])

  // Scroll one date pill at a time
  const scroll = (dir: number) => {
    const container = scrollRef.current
    if (!container) return
    const pills = container.querySelectorAll('button')
    if (pills.length === 0) return
    const pillWidth = pills[0].offsetWidth + 4 // pill width + gap
    container.scrollBy({ left: dir * pillWidth, behavior: 'instant' })
  }

  return (
    <div className="flex items-center gap-1">
      <IconButton
        onClick={() => scroll(-1)}
        tone="subtle"
        aria-label="Scroll dates left"
      >
        <ChevronLeft className="size-3.5" />
      </IconButton>

      <div
        ref={scrollRef}
        className="flex-1 flex gap-1 overflow-x-hidden py-1 snap-x snap-mandatory"
      >
        {dates.map((dateStr) => {
          const { day, weekday, isToday } = formatDatePill(dateStr)
          const isSelected = dateStr === selected
          const hasBrief = briefDates.has(dateStr)

          return (
            <button
              key={dateStr}
              data-selected={isSelected}
              onClick={() => onSelect(dateStr)}
              style={{ scrollSnapAlign: 'center' }}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg px-3 py-2 min-w-[44px] transition-all duration-150',
                isSelected
                  ? 'bg-card text-foreground ring-1 ring-border shadow-xs'
                  : isToday
                    ? 'bg-accent-blue/10 text-accent-blue'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/20',
              )}
            >
              <span className="text-label">{weekday}</span>
              <span className="text-title tabular-nums">{day}</span>
              {hasBrief && !isSelected && (
                <span className="size-1 rounded-full bg-accent-blue/60" />
              )}
              {!hasBrief && <span className="size-1" />}
            </button>
          )
        })}
      </div>

      <IconButton
        onClick={() => scroll(1)}
        tone="subtle"
        aria-label="Scroll dates right"
      >
        <ChevronRight className="size-3.5" />
      </IconButton>
    </div>
  )
}
