import { useEffect, useState } from 'react'
import type { Brief } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { BriefDisplay } from '@/components/shared/BriefDisplay'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { hasValidSnapshot, pastBriefView } from '@/lib/todayBrief'
import { arrangeBrief, normalizeLayout } from '@/lib/briefLayout'
import { BriefBox } from './BriefBox'
import { PrioritiesSkeleton } from './PrioritiesBox'
import { ModuleBox } from './ModuleBox'
import { briefModuleInfo } from './briefModules'

/** Skeletons shaped like the brief's first boxes (spec §3.7), shown while a
 *  past date's stored brief is in flight, or today's layout is loading. */
export function BriefSkeleton() {
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

  if (view === 'loading') return <BriefSkeleton />

  if (view === 'none') return <Meta as="p">No brief for this day.</Meta>

  if (view === 'vault') {
    return (
      <BriefBox title="From your vault">
        <BriefDisplay markdown={current!.vault!} />
      </BriefBox>
    )
  }

  // `view === 'snapshot'`: each module renders its own frozen payload, in
  // the order and with the config recorded that morning. Phase-1 rows
  // (layout = module ids) normalize to the same boxes as before.
  const stored = current!.brief!
  const snapshot = stored.snapshot as Record<string, unknown>
  const { header, body } = arrangeBrief(normalizeLayout(stored.layout), briefModuleInfo, false)
  return (
    <>
      {header.length > 0 && (
        <div className="flex items-center gap-2">
          {header.map((e) => (
            <ModuleBox key={e.id} id={e.id} mode="snapshot" date={date} config={e.config} payload={snapshot[e.id]} brief={stored} />
          ))}
        </div>
      )}
      {body.map((e) => (
        <ModuleBox key={e.id} id={e.id} mode="snapshot" date={date} config={e.config} payload={snapshot[e.id]} brief={stored} />
      ))}
    </>
  )
}
