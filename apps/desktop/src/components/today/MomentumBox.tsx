import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import type { MomentumSummary } from '@nimble/types'
import { BodyStrong, Meta } from '@/components/shared/typography'
import { IconButton } from '@/components/shared/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import { ProgressIndicator, ProgressLabel, ProgressTrack } from '@/components/ui/progress'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDataProvider } from '@/services/provider-context'
import { emitMomentumChanged, useMomentumSummary } from '@/hooks/useMomentumSummary'
import { openSettings } from '@/stores/settingsNavStore'
import { isMomentumSummary, momentumView, type MeterView, type TrendBar } from '@/lib/momentum'
import { cn } from '@/lib/utils'
import { BriefBox } from './BriefBox'
import { useBriefLive } from './briefLive'
import type { BriefBoxProps } from './briefModules'

/** A plain bar: `--success` fill on a neutral track, the count in tabular figures. */
function Meter({ meter }: { meter: MeterView }) {
  return (
    <ProgressPrimitive.Root
      value={Math.min(meter.value, meter.max)}
      max={meter.max}
      getAriaValueText={() => meter.text}
      className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2"
    >
      <ProgressLabel className="text-meta text-muted-foreground">{meter.label}</ProgressLabel>
      <ProgressTrack className="h-1.5 bg-muted">
        <ProgressIndicator className="bg-success" />
      </ProgressTrack>
      <Meta className="tabular-nums">{meter.text}</Meta>
    </ProgressPrimitive.Root>
  )
}

/** Seven bars, oldest first, weekday initials beneath: amber when something
 *  got done, a grey stub on days off and paused days, a hairline otherwise. */
function Trend({ bars }: { bars: TrendBar[] }) {
  return (
    <div className="space-y-1">
      <div role="img" aria-label={`Last 7 days: ${bars.map((b) => b.title).join('; ')}`} className="flex h-8 items-end gap-1">
        {bars.map((b) => (
          <div
            key={b.date}
            title={b.title}
            className={cn(
              'flex-1 rounded-xs',
              b.tone === 'amber' && 'bg-(--heat-3)',
              b.tone === 'grey' && 'bg-muted-foreground/25',
              b.tone === 'empty' && 'h-px bg-(--heat-empty)',
            )}
            style={b.tone === 'empty' ? undefined : { height: `${b.height}%` }}
          />
        ))}
      </div>
      <div className="flex gap-1" aria-hidden>
        {bars.map((b) => (
          <span key={b.date} className="flex-1 text-center text-label text-muted-foreground">{b.initial}</span>
        ))}
      </div>
    </div>
  )
}

function MomentumSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-4 w-40" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
      </div>
      <Skeleton className="h-8 w-full" />
    </div>
  )
}

/** Today's Momentum box (addendum §6): wins, then today/week meters, then the
 *  7-day trend; parity mode adds one quiet line. `live` reads the ledger
 *  (desktop); otherwise it renders `snapshot` (a past brief, the web).
 *  `interactive` adds the ⋯ menu (Pause / Resume, settings). */
export function MomentumBox({ snapshot, live, interactive }: { snapshot: MomentumSummary | null; live: boolean; interactive: boolean }) {
  const dp = useDataProvider()
  const { summary, loading, refresh } = useMomentumSummary('7d', live)
  const [busy, setBusy] = useState(false)
  const data = live ? summary : snapshot
  const view = data ? momentumView(data) : null

  async function togglePause() {
    if (!data) return
    setBusy(true)
    try {
      await dp.momentum.setPaused(!data.settings.paused)
      await refresh()
      emitMomentumChanged()
    } catch {
      toast("Momentum didn't change. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const action = interactive && live && data ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        render={<IconButton aria-label="Momentum options" title="Momentum options" className="focus-ring data-popup-open:bg-hover data-popup-open:text-foreground" />}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => void togglePause()}>
          {data.settings.paused ? 'Resume momentum' : 'Pause momentum'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openSettings('momentum')}>Goals & momentum settings</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined

  return (
    <BriefBox title="Momentum" action={action}>
      {live && loading && !data ? (
        <MomentumSkeleton />
      ) : !view ? (
        <Meta as="p">Your week starts here.</Meta>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <BodyStrong as="p" className="tabular-nums">{view.headline}</BodyStrong>
            {view.wins.length > 0 && (
              <ul className="space-y-0.5" aria-label="Wins this week">
                {view.wins.map((w, i) => (
                  <li key={`${i}-${w}`} className="min-w-0">
                    <Meta className="block truncate">{w}</Meta>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {view.paused ? (
            <Meta as="p">Paused</Meta>
          ) : (
            <div className="space-y-1.5">
              {view.todayMeter ? <Meter meter={view.todayMeter} /> : <Meta as="p" className="tabular-nums">{view.todayNote}</Meta>}
              {view.weekMeter && <Meter meter={view.weekMeter} />}
            </div>
          )}
          <Trend bars={view.trend} />
          {view.karmaLine && <Meta as="p" className="tabular-nums">{view.karmaLine}</Meta>}
        </div>
      )}
    </BriefBox>
  )
}

/** Registry adapter (`BRIEF_MODULES.momentum.Box`). `live` on the desktop
 *  reads the ledger with the ⋯ menu; `preview` (the setup) reads it without
 *  one; `snapshot` (a past brief) and the web (no ledger) render the frozen
 *  morning payload. */
export function MomentumModuleBox({ mode, payload }: BriefBoxProps) {
  const dp = useDataProvider()
  const brief = useBriefLive()?.brief
  if (mode === 'snapshot' || !dp.momentum.supported) {
    const frozen = mode === 'snapshot' ? payload : brief?.snapshot?.momentum
    return <MomentumBox snapshot={isMomentumSummary(frozen) ? frozen : null} live={false} interactive={false} />
  }
  return <MomentumBox snapshot={null} live interactive={mode === 'live'} />
}
