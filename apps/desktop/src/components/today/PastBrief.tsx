import { useEffect, useState } from 'react'
import type { Brief } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { BriefDisplay } from '@/components/shared/BriefDisplay'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { hasValidSnapshot, pastBriefView } from '@/lib/todayBrief'
import { BriefBox } from './BriefBox'
import { ScheduleBox } from './ScheduleBox'
import { PrioritiesBox, PrioritiesSkeleton } from './PrioritiesBox'
import { StillOpenBox } from './StillOpenBox'
import { VaultBox } from './VaultBox'

/** Skeletons shaped like the boxes below (spec §3.7), shown while a past
 *  date's stored brief and vault fallback are both in flight. */
function PastBriefSkeleton() {
  return (
    <>
      <BriefBox title="Schedule">
        <div className="space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      </BriefBox>
      <BriefBox title="Top priorities">
        <PrioritiesSkeleton />
      </BriefBox>
    </>
  )
}

/** Due today as read-only rows: the same row markup as `StillOpenBox`, but
 *  without the age tag — every row belongs to `date` itself. */
function DueTodaySnapshot({ tasks }: { tasks: { id: string; content: string }[] }) {
  return (
    <BriefBox title="Due today" count={tasks.length}>
      {tasks.length === 0 ? (
        <Meta as="p">Nothing due that day.</Meta>
      ) : (
        <div className="-mx-2">
          {tasks.map((task) => (
            <div key={task.id} className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left">
              <span className="min-w-0 flex-1 truncate text-body">{task.content}</span>
            </div>
          ))}
        </div>
      )}
    </BriefBox>
  )
}

/** A past date's brief, entirely read-only: the frozen snapshot stored for
 *  that morning, the legacy vault markdown when no snapshot was ever
 *  stored, or a calm "no brief" line — never a count or a comment on the
 *  gap (spec §3.7). `TodayPage` swaps this in for the live body whenever
 *  the selected date isn't `today`. */
export function PastBrief({ date, today }: { date: string; today: string }) {
  const dp = useDataProvider()
  const [loaded, setLoaded] = useState<{ date: string; brief: Brief | null; vault: string | null } | null>(null)

  // Defensive only: `TodayPage` mounts this exclusively for `selected !== today`
  // (and swaps back to the live body itself otherwise), so this never renders
  // in practice — it just keeps a misuse from showing today twice.
  const isPast = date !== today

  useEffect(() => {
    let live = true
    ;(async () => {
      const brief = await dp.brief.get(date).catch(() => null)
      // A malformed stored row (Rust maps a bad layout_json/snapshot_json to
      // JSON null) is treated as if nothing were stored — fall through to
      // the vault fallback rather than render half a snapshot.
      const usable = brief && hasValidSnapshot(brief) ? brief : null
      if (usable) {
        if (live) setLoaded({ date, brief: usable, vault: null })
        return
      }
      const vault = await dp.dailyState.readDailyBrief(date).catch(() => null)
      if (live) setLoaded({ date, brief: null, vault })
    })()
    return () => {
      live = false
    }
  }, [dp, date])

  if (!isPast) return null

  // Keyed by date so a fast `[`/`]` flip never shows the previous date's brief.
  const current = loaded?.date === date ? loaded : null
  const view = pastBriefView(current?.brief, current?.vault)

  if (view === 'loading') return <PastBriefSkeleton />

  if (view === 'none') return <Meta as="p">No brief for this day.</Meta>

  if (view === 'vault') {
    return (
      <BriefBox title="From your vault">
        <BriefDisplay markdown={current!.vault!} />
      </BriefBox>
    )
  }

  // `view === 'snapshot'`: hasValidSnapshot already confirmed `snapshot` is
  // an object, but individual sub-fields still guard against a partial one.
  const snapshot = current!.brief!.snapshot
  const schedule = snapshot?.schedule
  const stillOpen = snapshot?.still_open

  return (
    <>
      <ScheduleBox
        events={schedule?.events ?? []}
        tomorrow={schedule?.tomorrow ?? []}
        loading={false}
        today={date}
        live={false}
      />
      <PrioritiesBox priorities={snapshot?.priorities ?? null} readOnly />
      <DueTodaySnapshot tasks={snapshot?.due_today ?? []} />
      <StillOpenBox
        tasks={stillOpen?.oldest ?? []}
        total={stillOpen?.total ?? 0}
        today={date}
        readOnly
      />
      <VaultBox date={date} />
    </>
  )
}
