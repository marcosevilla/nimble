import { CloudRain, CloudSun, MapPin, Sun } from 'lucide-react'
import type { CalendarEvent, WeatherView } from '@nimble/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Label, Meta } from '@/components/shared/typography'
import { openSettings } from '@/stores/settingsNavStore'
import { nowHHMM } from '@/lib/todayBrief'
import {
  RAIN_SHOWN, asOfLabel, chipIcon, chipLabel, dayFor, formatRainWindow, hourLabel, hourOf, hourlyPoints, hoursOn,
  rainNotes, rainWindow, toUnit, type TempUnit,
} from '@/lib/weather'
import { cn } from '@/lib/utils'

const ICONS = { sun: Sun, 'cloud-sun': CloudSun, rain: CloudRain } as const
const CHIP =
  'focus-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-meta tabular-nums text-foreground transition-colors duration-(--transition-fast) hover:bg-hover data-popup-open:bg-hover'

/** The brief's weather (addendum §4, Fantastical pattern): icon + high/low
 *  (+ rain chance ≥20%) in the header; click or Enter opens place + now,
 *  four hourly points, the rain window, rain notes for timed events and
 *  "as of · Open-Meteo". `live` = today (hours count from now, "Add
 *  location" offered); false = a past snapshot. */
export function WeatherChip({
  view,
  loading = false,
  date,
  events,
  unit,
  showRainNotes,
  live,
}: {
  view: WeatherView | null
  loading?: boolean
  date: string
  events: CalendarEvent[]
  unit: TempUnit
  showRainNotes: boolean
  live: boolean
}) {
  if (loading) return <Skeleton className="h-7 w-24 rounded-full" />
  if (!view) return null
  if (view.status === 'no_location') {
    if (!live) return null
    return (
      <button type="button" className={cn(CHIP, 'text-muted-foreground')} onClick={() => openSettings('today-location')}>
        <MapPin className="size-3.5" aria-hidden />
        Add location
      </button>
    )
  }
  const day = dayFor(view.forecast, date)
  if (!view.forecast || !day) return <Meta className="shrink-0">Weather unavailable</Meta>

  const Icon = ICONS[chipIcon(day)]
  const label = chipLabel(day, unit)
  const asOf = view.fetched_at ? asOfLabel(view.fetched_at, date) : ''
  // Stale (offline), or fetched on another day: the chip says when.
  const fromToday = view.fetched_at ? asOfLabel(view.fetched_at, date) === asOfLabel(view.fetched_at) : true
  const stale = (view.status === 'stale' || !fromToday) && asOf !== ''
  const hours = hoursOn(view.forecast, date)
  const fromHour = live ? Number(nowHHMM().slice(0, 2)) : 7
  const points = hourlyPoints(hours, fromHour)
  const rainSpan = rainWindow(hours, fromHour)
  const notes = showRainNotes ? rainNotes(events, hours) : []
  const now = live && view.forecast.current_c != null ? toUnit(view.forecast.current_c, unit) : null

  return (
    <Popover>
      <PopoverTrigger className={CHIP} aria-label={`Weather: ${label}${stale ? `, as of ${asOf}` : ''}. Details`}>
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
        <span>{label}</span>
        {stale && <span className="text-muted-foreground">· as of {asOf}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="surface-popover w-72 gap-3 rounded-xl p-3 shadow-popover ring-0">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-body-strong">{view.location?.name}</span>
          {now != null && <Meta className="shrink-0 tabular-nums">Now {now}°</Meta>}
        </div>
        {points.length > 0 && (
          <ol aria-label="Next hours" className="grid grid-cols-4 gap-1">
            {points.map((h, i) => (
              <li key={h.time} className="flex flex-col items-center gap-0.5 rounded-md bg-muted/40 py-1.5">
                <Label>{i === 0 && live ? 'Now' : hourLabel(hourOf(h.time))}</Label>
                <span className="text-body tabular-nums">{toUnit(h.temp_c, unit)}°</span>
                {h.precip != null && h.precip >= RAIN_SHOWN && <Meta className="tabular-nums">{h.precip}%</Meta>}
              </li>
            ))}
          </ol>
        )}
        {rainSpan && <p className="text-body">{formatRainWindow(rainSpan)}</p>}
        {notes.length > 0 && (
          <ul className="space-y-0.5">
            {notes.map((n) => (
              <li key={`${n.summary}-${n.time}`} className="text-body">
                Rain likely during {n.summary} ({n.time})
              </li>
            ))}
          </ul>
        )}
        <Meta as="p">{asOf ? `as of ${asOf} · ` : ''}Open-Meteo</Meta>
      </PopoverContent>
    </Popover>
  )
}
