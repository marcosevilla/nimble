/**
 * Recurrence grammar mirror (Task 3, `nimble-core/src/recurrence.rs`).
 *
 * The Rust engine is the source of truth for what actually gets written and
 * for computing the *stored* next occurrence when a recurring task
 * completes (`db::tasks::update_task_status_at`). This module exists so the
 * frontend can, without a round trip:
 *   1. decide whether an arbitrary `recurrence_rule` string (own writes are
 *      always canonical, but Todoist-imported ones may not be) is
 *      "parseable" enough to show the recurring (↻) affordance, and
 *   2. predict the same next-occurrence date the backend is about to write,
 *      so the "Rescheduled to <date>" toast can fire immediately instead of
 *      waiting on a refetch.
 *
 * Keep this in sync with `nimble-core/src/recurrence.rs` if that grammar
 * ever changes — same interval bound, same unit words, same time-suffix
 * parsing, same month-end clamping.
 */

const MAX_INTERVAL = 100_000

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'

export interface ParsedRecurrenceRule {
  interval: number
  unit: RecurrenceUnit
  time: string | null // "HH:MM" 24h
}

/** Fixed canonical options for the TaskEditor recurrence select (base only, no time suffix). */
export const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'every day', label: 'Every day' },
  { value: 'every week', label: 'Every week' },
  { value: 'every 2 weeks', label: 'Every 2 weeks' },
  { value: 'every month', label: 'Every month' },
  { value: 'every 3 months', label: 'Every 3 months' },
  { value: 'every year', label: 'Every year' },
]

/** None = not a supported rule (caller still stores/displays it verbatim; it just won't auto-recur). */
export function parseRecurrenceRule(input: string): ParsedRecurrenceRule | null {
  const lower = input.trim().toLowerCase()
  if (!lower) return null

  const split = splitTimeSuffix(lower)
  if (!split) return null
  const { body, time } = split

  const tokens = body.split(/\s+/).filter(Boolean)
  if (tokens[0] !== 'every') return null

  const rest = tokens.slice(1)
  let interval: number
  let unit: RecurrenceUnit | null

  if (rest.length === 1) {
    interval = 1
    unit = matchSingularUnit(rest[0])
  } else if (rest.length === 2) {
    if (!/^\d+$/.test(rest[0])) return null
    interval = Number(rest[0])
    unit = matchPluralUnit(rest[1])
  } else {
    return null
  }

  if (!unit) return null
  if (interval <= 0 || interval > MAX_INTERVAL) return null

  return { interval, unit, time }
}

/** Reconstructs the canonical base string ("every day", "every 2 weeks") for a parsed rule, dropping any time suffix. */
export function formatRecurrenceBase(rule: ParsedRecurrenceRule): string {
  if (rule.interval === 1) return `every ${rule.unit}`
  return `every ${rule.interval} ${rule.unit}s`
}

/**
 * Semantic equality for two recurrence_rule strings — used to decide whether
 * an editor's recomposed rule actually differs from what's stored, rather
 * than comparing raw text. Two parseable rules with the same
 * interval/unit/time are equal even if their surface text differs (e.g. a
 * Todoist-imported "every day at 9am" vs. this editor's canonical
 * "every day @ 09:00" — same rule, different formatting). If either side
 * doesn't parse, fall back to exact (trimmed) text comparison, so an
 * unparseable/verbatim-preserved rule is only "changed" once actually
 * edited.
 */
export function recurrenceRulesEqual(a: string, b: string): boolean {
  const pa = parseRecurrenceRule(a)
  const pb = parseRecurrenceRule(b)
  if (pa && pb) return pa.interval === pb.interval && pa.unit === pb.unit && pa.time === pb.time
  return a.trim() === b.trim()
}

function matchSingularUnit(unit: string): RecurrenceUnit | null {
  switch (unit) {
    case 'day': return 'day'
    case 'week': return 'week'
    case 'month': return 'month'
    case 'year': return 'year'
    default: return null
  }
}

function matchPluralUnit(unit: string): RecurrenceUnit | null {
  switch (unit) {
    case 'days': return 'day'
    case 'weeks': return 'week'
    case 'months': return 'month'
    case 'years': return 'year'
    default: return null
  }
}

function splitTimeSuffix(lower: string): { body: string; time: string | null } | null {
  const atIdx = lower.indexOf('@')
  if (atIdx !== -1) {
    const body = lower.slice(0, atIdx).trim()
    const time = parseTime(lower.slice(atIdx + 1).trim())
    if (time === null) return null
    return { body, time }
  }

  const tokens = lower.split(/\s+/).filter(Boolean)
  const atPos = tokens.indexOf('at')
  if (atPos !== -1) {
    const body = tokens.slice(0, atPos).join(' ')
    const timeTokens = tokens.slice(atPos + 1)
    if (timeTokens.length === 0) return null
    const time = parseTime(timeTokens.join(' '))
    if (time === null) return null
    return { body, time }
  }

  return { body: lower, time: null }
}

/** Parses "H[:MM][am|pm]" (or 24h "HH:MM") into "HH:MM". */
function parseTime(s: string): string | null {
  s = s.trim()
  if (!s) return null

  let meridiem: boolean | null = null // false = am, true = pm
  let digits = s
  if (s.endsWith('am')) {
    meridiem = false
    digits = s.slice(0, -2).trim()
  } else if (s.endsWith('pm')) {
    meridiem = true
    digits = s.slice(0, -2).trim()
  }

  const colonIdx = digits.indexOf(':')
  const hourStr = colonIdx === -1 ? digits : digits.slice(0, colonIdx)
  const minuteStr = colonIdx === -1 ? '0' : digits.slice(colonIdx + 1)
  if (!/^\d+$/.test(hourStr) || !/^\d+$/.test(minuteStr)) return null

  let hour = Number(hourStr)
  const minute = Number(minuteStr)
  if (minute > 59) return null

  if (meridiem !== null) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12
    if (meridiem) hour += 12
  } else if (hour > 23) {
    return null
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// ── Next-occurrence prediction (date-only, UTC-anchored calendar math to
//    avoid DST/timezone drift — mirrors `add_interval` / `add_months_clamped`
//    in the Rust engine) ──

function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Today's local calendar date as "YYYY-MM-DD" (matches `chrono::Local::now().date_naive()`). */
export function todayLocalISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysInMonthUTC(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate()
  const targetFirst = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const daysInTarget = daysInMonthUTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth())
  return new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(day, daysInTarget)))
}

function addInterval(date: Date, unit: RecurrenceUnit, interval: number): Date {
  switch (unit) {
    case 'day': {
      const d = new Date(date)
      d.setUTCDate(d.getUTCDate() + interval)
      return d
    }
    case 'week': {
      const d = new Date(date)
      d.setUTCDate(d.getUTCDate() + interval * 7)
      return d
    }
    case 'month':
      return addMonthsClamped(date, interval)
    case 'year':
      return addMonthsClamped(date, interval * 12)
  }
}

/** Next due date strictly after `today`, advancing by whole intervals from `currentDue`. Both args are "YYYY-MM-DD". */
export function nextOccurrenceDate(rule: ParsedRecurrenceRule, currentDueISO: string, todayISO: string): string {
  const interval = Math.min(Math.max(rule.interval, 1), MAX_INTERVAL)
  const today = parseDateOnly(todayISO)
  let candidate = parseDateOnly(currentDueISO)
  do {
    candidate = addInterval(candidate, rule.unit, interval)
  } while (candidate <= today)
  return formatDateOnly(candidate)
}

/**
 * Predicts the date a recurring task will be rescheduled to if completed
 * right now — used to fire the "Rescheduled to <date>" toast without
 * waiting on a refetch. Returns null if the rule doesn't parse or there's
 * no due date (backend falls through to a normal completion in that case,
 * per Task 8's semantics — no reschedule happens).
 */
export function predictReschedule(recurrenceRule: string | null | undefined, dueDate: string | null | undefined): string | null {
  if (!recurrenceRule || !dueDate) return null
  const rule = parseRecurrenceRule(recurrenceRule)
  if (!rule) return null
  return nextOccurrenceDate(rule, dueDate, todayLocalISO())
}
