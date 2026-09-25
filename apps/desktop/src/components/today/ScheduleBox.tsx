import type { CalendarEvent } from '@nimble/types'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta } from '@/components/shared/typography'
import { formatFreeBlock, hhmm, largestFreeBlock, nowHHMM } from '@/lib/todayBrief'
import { localIsoDate } from '@/lib/briefDate'
import { BriefBox } from './BriefBox'

const MAX_ROWS = 5

/** Today's events in a time gutter, a one-line tomorrow peek and the
 *  largest free block. `live` counts the free block from now; a snapshot
 *  (`live={false}`) reads the whole working window of its own day. A load
 *  `error` with nothing to show reads "Calendar offline." — an unknown
 *  schedule is never presented as a wide-open day. */
export function ScheduleBox({
  events,
  loading,
  tomorrow,
  today,
  live,
  error = null,
  showFreeBlock = true,
}: {
  events: CalendarEvent[]
  loading: boolean
  tomorrow: CalendarEvent[]
  today: string
  live: boolean
  error?: string | null
  showFreeBlock?: boolean
}) {
  const offline = !loading && !!error && events.length === 0
  // "From now" only while the wall clock is still on this box's day.
  const from = live && localIsoDate() === today ? nowHHMM() : undefined
  const block = loading || offline || !showFreeBlock ? null : largestFreeBlock(events, { from })
  const peek = tomorrow[0]

  return (
    <BriefBox
      title="Schedule"
      action={
        peek ? (
          <Meta className="min-w-0 truncate tabular-nums">
            Tomorrow: {peek.all_day ? 'All day' : hhmm(peek.start_time)} {peek.summary}
          </Meta>
        ) : undefined
      }
    >
      {loading ? (
        <div className="space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : offline ? (
        <Meta as="p">Calendar offline.</Meta>
      ) : events.length === 0 ? (
        <Meta as="p">No events. Wide open.</Meta>
      ) : (
        <div className="space-y-1">
          {events.slice(0, MAX_ROWS).map((event) => (
            <div key={event.id} className="flex min-w-0 items-center gap-3 text-body">
              <span className="w-14 shrink-0 text-right text-meta tabular-nums text-muted-foreground">
                {event.all_day ? 'All day' : hhmm(event.start_time)}
              </span>
              {event.feed_color && (
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: event.feed_color }} />
              )}
              <span className="min-w-0 truncate">{event.summary}</span>
            </div>
          ))}
          {events.length > MAX_ROWS && (
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0" />
              <Meta as="p">+{events.length - MAX_ROWS} more</Meta>
            </div>
          )}
        </div>
      )}
      {block && <Meta as="p" className="mt-2">{formatFreeBlock(block)}</Meta>}
    </BriefBox>
  )
}
