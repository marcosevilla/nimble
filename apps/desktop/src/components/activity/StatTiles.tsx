import { useState } from 'react'
import type { MomentumRange, MomentumRangeStats } from '@nimble/types'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/shared/typography'
import { useDataProvider } from '@/services/provider-context'
import { useMomentumSummary } from '@/hooks/useMomentumSummary'
import { MOMENTUM_RANGES, parseRange, statTiles } from '@/lib/momentum'

const RANGE_KEY = 'nimble.activityRange'
const EMPTY: MomentumRangeStats = { from: null, completed: 0, active_days: 0, peak_hour: null, focused_ms: 0 }

function loadRange(): MomentumRange {
  try {
    return parseRange(localStorage.getItem(RANGE_KEY))
  } catch {
    return '7d'
  }
}

/** Activity tab stats (addendum §6): Completed · Active days · Peak hour ·
 *  Focused time over 7d / 30d / All, from the momentum ledger. Desktop only. */
export function StatTiles() {
  const dp = useDataProvider()
  const [range, setRange] = useState<MomentumRange>(loadRange)
  const { summary } = useMomentumSummary(range, dp.momentum.supported)
  if (!dp.momentum.supported) return null
  // Until the reply for *this* range arrives, skeletons: never the last range's numbers.
  const current = summary?.range === range ? summary : null
  const tiles = statTiles(current?.stats ?? EMPTY)

  const select = (next: MomentumRange) => {
    setRange(next)
    try {
      localStorage.setItem(RANGE_KEY, next)
    } catch {
      // remembered for this session only
    }
  }

  return (
    <section aria-labelledby="activity-stats" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label as="h3" id="activity-stats">Stats</Label>
        <ToggleGroup
          value={[range]}
          onValueChange={(v) => { const next = v[0] as MomentumRange | undefined; if (next) select(next) }}
          size="sm"
          aria-label="Stats range"
        >
          {MOMENTUM_RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} className="px-2 text-label">{r.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="surface-panel min-w-0 space-y-0.5 px-3 py-2">
            <dt className="truncate text-label text-muted-foreground">{t.label}</dt>
            <dd className="text-title tabular-nums">{current ? t.value : <Skeleton className="h-5 w-12" />}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
