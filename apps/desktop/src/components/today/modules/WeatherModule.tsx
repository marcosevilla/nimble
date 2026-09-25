import type { WeatherSnapshot } from '@nimble/types'
import { configValue } from '@/lib/briefLayout'
import { resolveUnits } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { WeatherChip } from '../WeatherChip'
import { useBriefLive } from '../briefLive'
import { STRIP_DOT } from '../stripSegment'
import type { BriefBoxProps, BriefStripProps } from '../briefModules'

/** Header slot: the chip. A past day shows the forecast frozen that morning
 *  (with its rain notes against that morning's schedule), or nothing. */
export function WeatherModule({ mode, date, config, payload, brief }: BriefBoxProps) {
  const live = useBriefLive()
  const unit = resolveUnits(config.units, navigator.language)
  const showRainNotes = configValue(config, 'rain_notes', true)
  if (mode === 'snapshot') {
    const snap = payload as WeatherSnapshot | null | undefined
    if (!snap?.forecast) return null
    return (
      <WeatherChip
        view={{ status: 'fresh', location: snap.location, forecast: snap.forecast, fetched_at: snap.fetched_at }}
        date={date}
        events={brief?.snapshot?.schedule?.events ?? []}
        unit={unit}
        showRainNotes={showRainNotes}
        live={false}
      />
    )
  }
  if (!live) return null
  return (
    <WeatherChip view={live.weather.view} loading={live.weather.loading} date={live.today} events={live.events} unit={unit} showRainNotes={showRainNotes} live />
  )
}

/** Compact strip: the same chip, first segment (UX checkpoint 1). */
export function WeatherStrip({ config }: BriefStripProps) {
  const live = useBriefLive()
  // No chip (off on the web, nothing loading): no segment, so no stray "·".
  if (!live || (!live.weather.view && !live.weather.loading)) return null
  return (
    <span className={cn('flex shrink-0 items-center', STRIP_DOT)}>
      <WeatherModule mode="live" date={live.today} config={config} />
    </span>
  )
}
