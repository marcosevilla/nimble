import { IconButton } from '@/components/shared/IconButton'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatBriefDate, shiftIsoDate } from '@/lib/briefDate'
import { cn } from '@/lib/utils'

interface DateStripProps {
  briefDates: Set<string>
  selected: string
  today: string
  onSelect: (date: string) => void
}

/** Brief date control — "‹ Sat, Aug 1 ›" in text-meta, living in the brief
 *  card's header (today P2-5). The old 29-pill strip used the page-title
 *  token for every numeral; the calendar rail already navigates dates. The
 *  dot marks a date that has a brief; the label returns to today. */
export function DateStrip({ briefDates, selected, today, onSelect }: DateStripProps) {
  const isToday = selected === today
  const hasBrief = briefDates.has(selected)
  return (
    <div className="flex items-center gap-0.5 text-meta text-muted-foreground">
      <IconButton
        onClick={() => onSelect(shiftIsoDate(selected, -1))}
        tone="subtle"
        aria-label="Previous day's brief"
      >
        <ChevronLeft className="size-3.5" />
      </IconButton>
      <button
        type="button"
        onClick={() => onSelect(today)}
        disabled={isToday}
        title={isToday ? undefined : 'Back to today'}
        className={cn(
          'inline-flex min-w-20 items-center justify-center gap-1.5 rounded-md px-1 tabular-nums transition-colors',
          !isToday && 'hover:text-foreground',
        )}
      >
        {formatBriefDate(selected, today)}
        <span
          className={cn('size-1 rounded-full', hasBrief ? 'bg-foreground/40' : 'bg-transparent')}
          aria-hidden="true"
        />
        {hasBrief && <span className="sr-only">, brief available</span>}
      </button>
      <IconButton
        onClick={() => onSelect(shiftIsoDate(selected, 1))}
        disabled={selected >= today}
        tone="subtle"
        className="disabled:pointer-events-none disabled:opacity-40"
        aria-label="Next day's brief"
      >
        <ChevronRight className="size-3.5" />
      </IconButton>
    </div>
  )
}
