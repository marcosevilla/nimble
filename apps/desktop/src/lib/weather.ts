// Pure weather helpers for the brief chip and popover (addendum §4).
// Forecasts arrive in °C (nimble-core api/weather.rs); units convert here,
// so a units change never refetches. Plain TS for node tests.
import type { CalendarEvent, Forecast, GeoPlace, WeatherDay, WeatherHour } from '@nimble/types'
import { hhmm } from './todayBrief.ts'

export type TempUnit = 'F' | 'C'
/** The chip shows the day's rain chance from this %. */
export const RAIN_SHOWN = 20
/** An hour counts as "rain likely" (window, rain notes) from this %. */
export const RAIN_LIKELY = 50
const EVENING = 21

export function resolveUnits(setting: unknown, locale: string | undefined): TempUnit {
  if (setting === 'F' || setting === 'C') return setting
  return locale === 'en-US' ? 'F' : 'C'
}

export function toUnit(celsius: number, unit: TempUnit): number {
  return Math.round(unit === 'F' ? (celsius * 9) / 5 + 32 : celsius)
}

export function dayFor(forecast: Forecast | null | undefined, date: string): WeatherDay | null {
  return forecast?.days.find((d) => d.date === date) ?? null
}

export function chipLabel(day: WeatherDay, unit: TempUnit): string {
  const temps = `${toUnit(day.high_c, unit)}°/${toUnit(day.low_c, unit)}°`
  return day.precip_max != null && day.precip_max >= RAIN_SHOWN ? `${temps} · ${day.precip_max}%` : temps
}

export function chipIcon(day: WeatherDay): 'sun' | 'cloud-sun' | 'rain' {
  const p = day.precip_max ?? 0
  return p >= RAIN_LIKELY ? 'rain' : p >= RAIN_SHOWN ? 'cloud-sun' : 'sun'
}

export function hourOf(time: string): number {
  return Number(time.slice(11, 13))
}

export function hoursOn(forecast: Forecast | null | undefined, date: string): WeatherHour[] {
  return (forecast?.hourly ?? []).filter((h) => h.time.startsWith(date))
}

/** Up to four points from `fromHour` to the evening (21:00); late in the
 *  day, the next hours instead. */
export function hourlyPoints(hours: WeatherHour[], fromHour: number): WeatherHour[] {
  const wanted =
    fromHour >= EVENING - 3
      ? [0, 1, 2, 3].map((i) => fromHour + i).filter((h) => h <= 23)
      : [0, 1, 2, 3].map((i) => fromHour + Math.round(((EVENING - fromHour) * i) / 3))
  return wanted
    .map((h) => hours.find((x) => hourOf(x.time) === h))
    .filter((x): x is WeatherHour => x !== undefined)
}

/** The first run of consecutive "rain likely" hours at or after `fromHour`
 *  (`end` is exclusive). */
export function rainWindow(hours: WeatherHour[], fromHour: number): { start: number; end: number } | null {
  let start: number | null = null
  let end = 0
  for (const h of hours) {
    const hour = hourOf(h.time)
    if (hour < fromHour) continue
    const wet = (h.precip ?? 0) >= RAIN_LIKELY
    if (wet && start === null) {
      start = hour
      end = hour + 1
    } else if (wet && hour === end) {
      end = hour + 1
    } else if (start !== null) {
      break
    }
  }
  return start === null ? null : { start, end }
}

export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`
}

export function formatRainWindow(w: { start: number; end: number }): string {
  return `Rain likely ${hourLabel(w.start)} to ${hourLabel(w.end)}`
}

/** "19:00" (or the mock's ISO datetime) → "7:00". */
export function clock12(time: string): string {
  const [h, m] = hhmm(time).split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`
}

/** Timed events whose start hour is "rain likely" at the brief location. */
export function rainNotes(
  events: Pick<CalendarEvent, 'summary' | 'start_time' | 'all_day'>[],
  hours: WeatherHour[],
): { summary: string; time: string }[] {
  return events
    .filter((e) => !e.all_day && e.start_time)
    .flatMap((e) => {
      const hour = Number(hhmm(e.start_time).slice(0, 2))
      const slot = hours.find((x) => hourOf(x.time) === hour)
      return slot && (slot.precip ?? 0) >= RAIN_LIKELY ? [{ summary: e.summary, time: clock12(e.start_time) }] : []
    })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A fetch time as the local clock, "6:31". Given the brief date, a fetch
 *  from another day carries its date, "Sep 25, 2:05", so yesterday's
 *  forecast never passes for this morning's. */
export function asOfLabel(iso: string, today?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const clock = clock12(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return today === undefined || day === today ? clock : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clock}`
}

/** "San Francisco, California"; the country when there's no distinct region. */
export function placeLabel(p: Pick<GeoPlace, 'name' | 'admin1' | 'country'>): string {
  const region = p.admin1 && p.admin1 !== p.name ? p.admin1 : p.country
  return region ? `${p.name}, ${region}` : p.name
}
