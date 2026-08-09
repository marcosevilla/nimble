import { useEffect, useRef, useState, useCallback } from 'react'
import { useCalendar } from '@/hooks/useCalendar'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDataProvider } from '@/services/provider-context'
import type { DataProvider } from '@/services/data-provider'
import type { CalendarEvent } from '@nimble/types'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// ── Helpers ──

const HOUR_HEIGHT = 56
const TIME_LABEL_WIDTH = 28
const MIN_BLOCK_HEIGHT = 24

function formatCompactTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  if (isNaN(h)) return time
  const hour = h % 12 || 12
  const suffix = h >= 12 ? 'p' : 'a'
  if (m === 0) return `${hour}${suffix}`
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`
}

function formatTimeRange(start: string, end: string): string {
  return `${formatCompactTime(start)} – ${formatCompactTime(end)}`
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  if (isNaN(h)) return 0
  return h * 60 + (m || 0)
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[d.getDay()]} ${d.getDate()}`
}

function formatMonthShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return months[d.getMonth()]
}

function isDatePast(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T12:00:00')
  d.setHours(0, 0, 0, 0)
  return d < today
}

// ── Sub-Components ──

function DayNavigationHeader({
  selectedDate,
  isToday,
  onPrev,
  onNext,
  onGoToday,
}: {
  selectedDate: string
  isToday: boolean
  onPrev: () => void
  onNext: () => void
  onGoToday: () => void
}) {
  return (
    <div className="flex items-center justify-between px-1 mb-2">
      <span className="text-label text-muted-foreground">
        {formatMonthShort(selectedDate)}
      </span>

      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          title="Previous day"
        >
          <ChevronLeft className="size-3.5" />
        </button>

        <button
          onClick={onGoToday}
          className={cn(
            'text-label transition-colors px-1.5 tabular-nums',
            isToday ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          title="Jump to today"
        >
          {formatShortDate(selectedDate)}
        </button>

        <button
          onClick={onNext}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          title="Next day"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function AllDayStrip({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null

  const visible = events.slice(0, 2)
  const overflow = events.length - 2

  return (
    <div className="mb-2 space-y-1">
      {visible.map((event) => (
        <div
          key={event.id}
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-label bg-muted/30"
          style={{
            borderLeft: `3px solid ${event.feed_color || '#6366f1'}`,
          }}
        >
          <span className="truncate">{event.summary}</span>
        </div>
      ))}
      {overflow > 0 && (
        <span className="text-label text-muted-foreground pl-2">
          +{overflow} more
        </span>
      )}
    </div>
  )
}

function CurrentTimeIndicator({ startHour }: { startHour: number }) {
  const [offset, setOffset] = useState(() => {
    const now = new Date()
    const minutes = now.getHours() * 60 + now.getMinutes()
    return ((minutes - startHour * 60) / 60) * HOUR_HEIGHT
  })

  useEffect(() => {
    function update() {
      const now = new Date()
      const minutes = now.getHours() * 60 + now.getMinutes()
      setOffset(((minutes - startHour * 60) / 60) * HOUR_HEIGHT)
    }
    update()
    const interval = setInterval(update, 60_000)
    return () => clearInterval(interval)
  }, [startHour])

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: offset }}
    >
      <div className="relative flex items-center">
        {/* now-line red is intentionally not a semantic token — see Figma Refactor Plan §3.7 */}
        <div className="size-2 rounded-full bg-[#de1f1f] shrink-0" />
        <div className="flex-1 h-[1.5px] bg-[#de1f1f] -ml-1" />
      </div>
    </div>
  )
}

interface PositionedEvent extends CalendarEvent {
  _column: number
  _totalColumns: number
}

/**
 * Assigns each event a column index so overlapping events render side-by-side.
 * Events that share any time window are grouped into a "cluster" and each
 * cluster's total column count becomes the denominator for width.
 */
function layoutEvents(events: CalendarEvent[]): PositionedEvent[] {
  if (events.length === 0) return []

  const sorted = [...events].sort((a, b) => {
    const aStart = timeToMinutes(a.start_time)
    const bStart = timeToMinutes(b.start_time)
    if (aStart !== bStart) return aStart - bStart
    return timeToMinutes(b.end_time) - timeToMinutes(a.end_time)
  })

  const clusters: CalendarEvent[][] = []
  for (const event of sorted) {
    const eventStart = timeToMinutes(event.start_time)
    let placed = false
    for (const cluster of clusters) {
      const latestEnd = Math.max(...cluster.map((e) => timeToMinutes(e.end_time)))
      if (latestEnd > eventStart) {
        cluster.push(event)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([event])
  }

  const result: PositionedEvent[] = []
  for (const cluster of clusters) {
    const columnEnds: number[] = []
    const assignments: { event: CalendarEvent; column: number }[] = []

    for (const event of cluster) {
      const eventStart = timeToMinutes(event.start_time)
      const eventEnd = timeToMinutes(event.end_time)
      let assignedCol = columnEnds.findIndex((end) => end <= eventStart)
      if (assignedCol === -1) {
        assignedCol = columnEnds.length
        columnEnds.push(eventEnd)
      } else {
        columnEnds[assignedCol] = eventEnd
      }
      assignments.push({ event, column: assignedCol })
    }

    const totalColumns = columnEnds.length
    for (const { event, column } of assignments) {
      result.push({ ...event, _column: column, _totalColumns: totalColumns })
    }
  }

  return result
}

function EventBlock({
  event,
  startHour,
  dp,
}: {
  event: PositionedEvent
  startHour: number
  dp: DataProvider
}) {
  const [hovered, setHovered] = useState(false)
  const startMin = timeToMinutes(event.start_time)
  const endMin = timeToMinutes(event.end_time)
  const durationMin = Math.max(endMin - startMin, 0)
  const isShort = durationMin < 30

  const topPx = ((startMin - startHour * 60) / 60) * HOUR_HEIGHT
  const rawHeight = (durationMin / 60) * HOUR_HEIGHT
  const height = Math.max(rawHeight, MIN_BLOCK_HEIGHT)

  const feedColor = event.feed_color || '#6366f1'

  const columnGap = 2
  const columnWidthPct = 100 / event._totalColumns
  const leftPct = event._column * columnWidthPct
  const isNarrow = event._totalColumns > 1

  return (
    <div
      className="absolute rounded-sm overflow-hidden cursor-default transition-shadow hover:shadow-md hover:z-10"
      style={{
        top: topPx,
        height,
        left: `calc(${TIME_LABEL_WIDTH + 4}px + (100% - ${TIME_LABEL_WIDTH + 4}px) * ${leftPct / 100})`,
        width: `calc((100% - ${TIME_LABEL_WIDTH + 4}px) * ${columnWidthPct / 100} - ${columnGap}px)`,
        borderLeft: `2px solid ${feedColor}`,
        backgroundColor: `${feedColor}15`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={event.summary}
    >
      <div className="px-1.5 py-0.5 h-full flex flex-col justify-start overflow-hidden min-w-0">
        <p className="text-label truncate">
          {event.summary}
        </p>
        {!isShort && !isNarrow && (
          <p className="text-label text-muted-foreground truncate mt-px">
            {formatTimeRange(event.start_time, event.end_time)}
          </p>
        )}
        {!isShort && !isNarrow && event.location && !event.meeting_url && (
          <p className="text-label text-muted-foreground truncate">
            {event.location}
          </p>
        )}
        {!isShort && isNarrow && (
          <p className="text-label text-muted-foreground truncate mt-px">
            {formatCompactTime(event.start_time)}
          </p>
        )}
      </div>
      {event.meeting_url && hovered && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute bottom-0.5 right-0.5 h-5 px-1.5 text-label opacity-90"
          onClick={(e) => {
            e.stopPropagation()
            dp.system.openUrl(event.meeting_url!)
          }}
        >
          Join
        </Button>
      )}
    </div>
  )
}

function TimeGrid({
  events,
  isToday,
  dp,
}: {
  events: CalendarEvent[]
  isToday: boolean
  dp: DataProvider
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const timedEvents = events.filter((e) => !e.all_day)

  if (timedEvents.length === 0) return null

  // Full-day grid: midnight to midnight. User can scroll back to see any
  // earlier hour of the day, and the grid continues past the last event
  // to the end of the day.
  const startHour = 0
  const endHour = 24
  const totalHours = endHour - startHour
  const gridHeight = totalHours * HOUR_HEIGHT

  // Initial scroll: center on current time if today, otherwise on the
  // earliest event. Either way, position ~1/3 from the top of the viewport.
  useEffect(() => {
    if (!scrollRef.current) return

    let anchorMinutes: number
    if (isToday) {
      const now = new Date()
      anchorMinutes = now.getHours() * 60 + now.getMinutes()
    } else {
      const allMinutes = timedEvents.map((e) => timeToMinutes(e.start_time))
      anchorMinutes = allMinutes.length > 0 ? Math.min(...allMinutes) : 8 * 60
    }

    const offset = (anchorMinutes / 60) * HOUR_HEIGHT
    const scrollTop = Math.max(0, offset - scrollRef.current.clientHeight / 3)
    scrollRef.current.scrollTop = scrollTop
    // Intentionally only run on mount and when the day changes — subsequent
    // re-renders shouldn't reset the user's scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday])

  // Generate hour labels
  const hourLabels: { hour: number; label: string }[] = []
  for (let h = startHour; h < endHour; h++) {
    const h12 = h % 12 || 12
    const suffix = h >= 12 ? 'p' : 'a'
    hourLabels.push({ hour: h, label: `${h12}${suffix}` })
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto flex-1 min-h-0"
    >
      <div className="relative" style={{ height: gridHeight }}>
        {/* Hour lines and labels */}
        {hourLabels.map(({ hour, label }) => {
          const y = (hour - startHour) * HOUR_HEIGHT
          return (
            <div key={hour} className="absolute left-0 right-0" style={{ top: y }}>
              <div className="flex items-start">
                <span className="text-label tabular-nums text-muted-foreground leading-none -mt-[5px]" style={{ width: TIME_LABEL_WIDTH }}>
                  {label}
                </span>
                <div className="flex-1 border-t border-border/40" />
              </div>
            </div>
          )
        })}

        {/* Current time indicator */}
        {isToday && (
          <div style={{ marginLeft: TIME_LABEL_WIDTH }}>
            <CurrentTimeIndicator startHour={startHour} />
          </div>
        )}

        {/* Event blocks */}
        {layoutEvents(timedEvents).map((event) => (
          <EventBlock key={event.id} event={event} startHour={startHour} dp={dp} />
        ))}
      </div>
    </div>
  )
}

function EmptyDayState({ dateStr, isToday }: { dateStr: string; isToday: boolean }) {
  const isPast = isDatePast(dateStr)
  const message = isToday
    ? 'Nothing scheduled — deep work time.'
    : isPast
    ? 'No events'
    : 'Clear day ahead'

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <p className="text-meta text-muted-foreground">{message}</p>
    </div>
  )
}

// ── Main Component ──

export function CalendarPanel() {
  const dp = useDataProvider()
  const {
    events,
    error,
    loading,
    selectedDate,
    isToday,
    goToToday,
    goNext,
    goPrev,
    refresh,
  } = useCalendar()

  // Keyboard shortcuts when panel is focused/hovered
  const panelRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!focused) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        goToToday()
      }
    },
    [focused, goPrev, goNext, goToToday],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const allDayEvents = events.filter((e) => e.all_day)
  const timedEvents = events.filter((e) => !e.all_day)

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1 mb-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4" />
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-10 flex-1 rounded-md" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="flex flex-col h-full"
      onMouseEnter={() => setFocused(true)}
      onMouseLeave={() => setFocused(false)}
    >
      <DayNavigationHeader
        selectedDate={selectedDate}
        isToday={isToday}
        onPrev={goPrev}
        onNext={goNext}
        onGoToday={goToToday}
      />

      {error && (
        <div className="flex items-center gap-2 mb-2 text-meta text-muted-foreground">
          <span>Calendar offline.</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={refresh}
            className="h-5 px-1 text-muted-foreground hover:text-foreground"
          >
            Retry
          </Button>
        </div>
      )}

      {!error && (
        <>
          <AllDayStrip events={allDayEvents} />

          {timedEvents.length > 0 ? (
            <TimeGrid events={timedEvents} isToday={isToday} dp={dp} />
          ) : (
            allDayEvents.length === 0 && (
              <EmptyDayState dateStr={selectedDate} isToday={isToday} />
            )
          )}
        </>
      )}
    </div>
  )
}
