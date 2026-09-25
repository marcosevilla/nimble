// Pure helpers for Momentum (addendum 2026-09-25 §6): the Today box view
// model, the Activity stat tiles and the goal form. Plain TS so node tests
// import it directly.
//
// Copy rules (ux-intent §3.1 as amended by Q2): with karma off there are no
// streaks, no penalties and no red. Nothing here reads a past day's goal, so
// missing one can't change the next day's copy. Paused copy is one neutral
// word and never mentions the gap.
import type {
  GoalTargets, KarmaParity, MomentumRange, MomentumRangeStats, MomentumSummary, MomentumTrendDay, WeekdayKey,
} from '@nimble/types'

export const MOMENTUM_RANGES: readonly { value: MomentumRange; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]

export const WEEKDAY_OPTIONS: readonly { value: WeekdayKey; short: string; name: string }[] = [
  { value: 'mon', short: 'Mo', name: 'Monday' },
  { value: 'tue', short: 'Tu', name: 'Tuesday' },
  { value: 'wed', short: 'We', name: 'Wednesday' },
  { value: 'thu', short: 'Th', name: 'Thursday' },
  { value: 'fri', short: 'Fr', name: 'Friday' },
  { value: 'sat', short: 'Sa', name: 'Saturday' },
  { value: 'sun', short: 'Su', name: 'Sunday' },
]

export const KARMA_DESCRIPTION =
  "Todoist's full system: points, levels, daily and weekly streaks, and −1 point when an open task reaches 5 days past due. Counted from when you turn it on. Off by default."

/** One days-off rule for the setup, Settings and Rust (`karma::save_goals`,
 *  `brief::settings`): at least one day is a goal day. */
export const DAYS_OFF_ERROR = "Leave at least one day that isn't a day off."

export function daysOffError(days: readonly string[]): string | null {
  const distinct = new Set(WEEKDAY_OPTIONS.map((d) => d.value).filter((d) => days.includes(d)))
  return distinct.size >= WEEKDAY_OPTIONS.length ? DAYS_OFF_ERROR : null
}

export interface MeterView { label: 'Today' | 'This week'; value: number; max: number; percent: number; text: string }
export interface TrendBar { date: string; initial: string; done: number; height: number; tone: 'amber' | 'grey' | 'empty'; title: string }
export interface MomentumView {
  headline: string
  wins: string[]
  paused: boolean
  todayMeter: MeterView | null
  todayNote: string | null
  weekMeter: MeterView | null
  trend: TrendBar[]
  karmaLine: string | null
}

const WEEKDAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function parseRange(value: string | null | undefined): MomentumRange {
  return value === '30d' || value === 'all' ? value : '7d'
}

/** A brief snapshot payload for the `momentum` module (web / past dates). */
export function isMomentumSummary(value: unknown): value is MomentumSummary {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.week_done === 'number' && Array.isArray(v.trend) && typeof v.settings === 'object' && v.settings !== null
}

function meter(label: MeterView['label'], value: number, max: number): MeterView {
  const safeMax = Math.max(1, max)
  const done = Math.max(0, value)
  return { label, value: done, max: safeMax, percent: Math.round(Math.min(1, done / safeMax) * 100), text: `${done} of ${safeMax}` }
}

export function trendBars(days: MomentumTrendDay[]): TrendBar[] {
  const peak = Math.max(1, ...days.map((d) => d.done))
  return days.map((d) => {
    const dt = new Date(`${d.date}T00:00:00Z`)
    const grey = d.day_off || d.paused
    const done = Math.max(0, d.done)
    const height = done === 0 ? (grey ? 15 : 0) : Math.max(12, Math.round((done / peak) * 100))
    const label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    return {
      date: d.date,
      initial: WEEKDAY_INITIAL[dt.getUTCDay()],
      done,
      height,
      tone: grey ? 'grey' : done === 0 ? 'empty' : 'amber',
      title: `${label} · ${done} done${d.day_off ? ' · day off' : ''}`,
    }
  })
}

export function karmaLine(k: KarmaParity): string {
  const parts = [`${k.total.toLocaleString('en-US')} points`, k.level]
  if (k.daily_streak > 0) parts.push(`${k.daily_streak}-day streak`)
  if (k.weekly_streak > 0) parts.push(`${k.weekly_streak}-week streak`)
  return parts.join(' · ')
}

/** `aiWins`: task titles the brief's AI picked (phase 3 `wins`), if any. */
export function momentumView(s: MomentumSummary, aiWins: string[] = []): MomentumView {
  const paused = s.settings.paused
  return {
    headline: s.week_done > 0 ? `This week: ${s.week_done} done` : 'Your week starts here.',
    wins: (aiWins.length > 0 ? aiWins : s.wins.map((w) => w.content)).slice(0, 3),
    paused,
    todayMeter: paused || s.is_day_off ? null : meter('Today', s.today_done, s.settings.daily_goal),
    todayNote: paused ? 'Paused' : s.is_day_off ? (s.today_done > 0 ? `Day off · ${s.today_done} done` : 'Day off') : null,
    weekMeter: paused ? null : meter('This week', s.week_done, s.settings.weekly_goal),
    trend: trendBars(s.trend),
    karmaLine: s.karma ? karmaLine(s.karma) : null,
  }
}

export function formatPeakHour(hour: number | null): string {
  if (hour === null || hour < 0 || hour > 23) return '—'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`
}

export function formatFocused(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function statTiles(s: MomentumRangeStats): { label: string; value: string }[] {
  return [
    { label: 'Completed', value: Math.max(0, s.completed).toLocaleString('en-US') },
    { label: 'Active days', value: String(s.active_days) },
    { label: 'Peak hour', value: formatPeakHour(s.peak_hour) },
    { label: 'Focused time', value: formatFocused(s.focused_ms) },
  ]
}

/** The Settings goal form → the `goals_save` payload, or the message to show. */
export function goalTargetsFrom(input: { daily: string; weekly: string; daysOff: WeekdayKey[]; karmaEnabled: boolean }):
  { value: GoalTargets } | { error: string } {
  const daily = Number(input.daily.trim())
  const weekly = Number(input.weekly.trim())
  if (input.daily.trim() === '' || !Number.isInteger(daily) || daily < 1 || daily > 100) return { error: 'Daily goal must be a whole number from 1 to 100.' }
  if (input.weekly.trim() === '' || !Number.isInteger(weekly) || weekly < 1 || weekly > 700) return { error: 'Weekly goal must be a whole number from 1 to 700.' }
  const days = WEEKDAY_OPTIONS.map((d) => d.value).filter((d) => input.daysOff.includes(d))
  const daysError = daysOffError(days)
  if (daysError) return { error: daysError }
  return { value: { daily, weekly, days_off: days, karma_enabled: input.karmaEnabled } }
}
