import type { CalendarEvent } from '@nimble/types'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { configValue } from '@/lib/briefLayout'
import { hhmm, nextEvent, nowHHMM } from '@/lib/todayBrief'
import { cn } from '@/lib/utils'
import { ScheduleBox } from '../ScheduleBox'
import { useBriefLive } from '../briefLive'
import { STRIP_DOT } from '../stripSegment'
import type { BriefBoxProps } from '../briefModules'

export function ScheduleModule({ mode, date, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const showTomorrow = configValue(config, 'tomorrow_peek', true)
  const showFreeBlock = configValue(config, 'free_block', true)
  if (mode === 'snapshot') {
    const p = (payload ?? {}) as { events?: CalendarEvent[]; tomorrow?: CalendarEvent[] }
    return (
      <ScheduleBox events={p.events ?? []} tomorrow={showTomorrow ? p.tomorrow ?? [] : []} loading={false} today={date} live={false} showFreeBlock={showFreeBlock} />
    )
  }
  if (!live) return null
  return (
    <ScheduleBox
      events={live.events}
      loading={!live.calReady}
      error={live.calError}
      tomorrow={showTomorrow ? live.tomorrow : []}
      today={live.today}
      live
      showFreeBlock={showFreeBlock}
    />
  )
}

/** Compact strip: the next event (phase-1 BriefStrip's first segment). */
export function ScheduleStrip() {
  const live = useBriefLive()
  if (!live) return null
  const next = nextEvent(live.events, nowHHMM())
  return (
    <span className={cn('min-w-0 shrink truncate text-body', STRIP_DOT)}>
      {!live.calReady ? (
        <Skeleton className="inline-block h-4 w-40 align-middle" />
      ) : live.calendarOffline ? (
        <Meta>Calendar offline.</Meta>
      ) : next ? (
        <>
          <Meta className="tabular-nums">Next: {hhmm(next.start_time)}</Meta> {next.summary}
        </>
      ) : (
        <Meta>No more events today</Meta>
      )}
    </span>
  )
}
