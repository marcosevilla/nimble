import type { CalendarEvent, Priority } from '@nimble/types'
import { ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/shared/IconButton'
import { Meta } from '@/components/shared/typography'
import { hhmm, nextEvent, nowHHMM } from '@/lib/todayBrief'

/** The compact brief: one line with the next event and up to three
 *  priority titles, so the task list below stays in view. */
export function BriefStrip({
  events,
  priorities,
  onExpand,
}: {
  events: CalendarEvent[]
  priorities: Priority[] | null | undefined
  onExpand: () => void
}) {
  const next = nextEvent(events, nowHHMM())
  const top = (priorities ?? []).slice(0, 3)

  return (
    <div className="surface-panel flex min-w-0 items-center gap-3 px-4 py-2">
      <span className="min-w-0 shrink truncate text-body">
        {next ? (
          <>
            <Meta className="tabular-nums">Next: {hhmm(next.start_time)}</Meta> {next.summary}
          </>
        ) : (
          <Meta>No more events today</Meta>
        )}
      </span>
      {top.length > 0 && (
        <>
          <Meta aria-hidden="true">·</Meta>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {top.map((p, i) => (
              <span
                key={i}
                className="flex min-w-0 max-w-56 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-meta"
                title={p.title}
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="truncate">{p.title}</span>
              </span>
            ))}
          </div>
        </>
      )}
      <IconButton aria-label="Expand the brief" onClick={onExpand} className="ml-auto">
        <ChevronDown className="size-3.5" />
      </IconButton>
    </div>
  )
}
