/**
 * Recurrence engine for the web build — a line-for-line port of the Rust engine.
 *
 * ⚠️ SOURCE OF TRUTH: `nimble-core/src/recurrence.rs`.
 * This file is a SECOND implementation of the same grammar, and it is only
 * worth having if it provably agrees with the first. Any change to
 * `recurrence.rs` — the grammar, the clamping rules, the parse failures — MUST
 * be mirrored here in the same commit, and the corresponding case added to
 * `recurrence.vectors.ts`. Run `npx tsx apps/desktop/src/services/turso/recurrence.selfcheck.ts`
 * afterwards; it exits non-zero on any divergence.
 *
 * Beyond those vectors, this port was differentially fuzzed against the real
 * Rust (an oracle binary built with `#[path] mod rec;` pointing at the actual
 * recurrence.rs): 39 adversarial parse inputs and 11,328 `next_occurrence`
 * cases — every month-end day across leap and non-leap years, all four units,
 * intervals 0 through 100,000, and randomised due/today pairs spanning
 * 1970-2079 in both directions — produced byte-identical output.
 *
 * Grammar (case-insensitive, this is the WHOLE grammar):
 *   "every day" | "every N days"
 *   "every week" | "every N weeks"
 *   "every month" | "every N months"
 *   "every year" | "every N years"
 * optionally followed by "@ HH:MM" or "at H[:MM][am|pm]".
 *
 * Calling convention (see `update_task_status` in `nimble-core/src/db/tasks.rs`,
 * ~line 550): on completing a task that has BOTH a parseable `recurrence_rule`
 * and a `due_date`, the task does not complete. Instead
 *   due_date = nextOccurrence(rule, due_date, today)
 *   due_time = rule.time ?? existing due_time      // rule.time WINS
 *   status   = 'todo'
 * A rule that fails to parse (null here, `None` in Rust) or a missing due date
 * falls through to a normal completion — the rule is inert in that case.
 *
 * Dates are handled as `YYYY-MM-DD` strings converted to plain {y, m, d}
 * integer triples and back. There is deliberately NO `Date` object anywhere in
 * this file: `new Date("2026-08-15")` parses as UTC while `new Date(2026, 7, 15)`
 * parses as local, and mixing them silently shifts a due date by a day.
 * Integer civil-date arithmetic has no timezone at all.
 */

/**
 * Sane upper bound on `interval`, mirroring `MAX_INTERVAL` in recurrence.rs.
 * Enforced by `parseRule`, and re-enforced defensively in `nextOccurrence`
 * because a `RecurrenceRule` can be built without going through the parser
 * (e.g. deserialized from storage): interval 0 would never advance past
 * `today` (infinite loop) and an unbounded interval would run the date
 * arithmetic off into nonsense.
 */
const MAX_INTERVAL = 100_000

/** Mirrors `u32::MAX` — the integer type Rust parses interval/hour/minute into. */
const U32_MAX = 4_294_967_295

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'

/** Mirrors the `RecurrenceRule` struct in recurrence.rs. */
export interface RecurrenceRule {
  /** every N units, >= 1 */
  interval: number
  unit: RecurrenceUnit
  /** "HH:MM" 24h, or null where Rust has `None` */
  time: string | null
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * `None` = string is not a supported rule (caller stores it anyway; the task
 * just won't auto-recur). Returns `null` at exactly the points where Rust's
 * `parse_rule` returns `None`.
 */
export function parseRule(rule: string): RecurrenceRule | null {
  const lower = rule.trim().toLowerCase()
  if (lower.length === 0) {
    return null
  }

  // Split off the time suffix, introduced by "@" or "at".
  const split = splitTimeSuffix(lower)
  if (split === null) {
    return null
  }
  const { body, time } = split

  const tokens = splitWhitespace(body)
  if (tokens[0] !== 'every') {
    return null
  }

  // Remaining tokens after "every": either [singular_unit] or [N, plural_unit],
  // matching the grammar exactly ("every day" / "every N days", never a bare
  // plural like "every days" or a singular with a count like "every 2 day").
  const rest = tokens.slice(1)
  let interval: number
  let unit: RecurrenceUnit | null
  if (rest.length === 1) {
    interval = 1
    unit = matchSingularUnit(rest[0])
  } else if (rest.length === 2) {
    const n = parseU32(rest[0])
    if (n === null) {
      return null
    }
    interval = n
    unit = matchPluralUnit(rest[1])
  } else {
    return null
  }
  if (unit === null) {
    return null
  }

  if (interval === 0 || interval > MAX_INTERVAL) {
    return null
  }

  return { interval, unit, time }
}

function matchSingularUnit(unit: string): RecurrenceUnit | null {
  switch (unit) {
    case 'day':
      return 'day'
    case 'week':
      return 'week'
    case 'month':
      return 'month'
    case 'year':
      return 'year'
    default:
      return null
  }
}

function matchPluralUnit(unit: string): RecurrenceUnit | null {
  switch (unit) {
    case 'days':
      return 'day'
    case 'weeks':
      return 'week'
    case 'months':
      return 'month'
    case 'years':
      return 'year'
    default:
      return null
  }
}

/**
 * Splits a lowercased rule string into (body, optional "HH:MM" time), where the
 * time suffix is introduced by "@" or the word "at". `null` = the suffix was
 * present but unparseable, which fails the whole rule (Rust's `?` on
 * `parse_time`).
 */
function splitTimeSuffix(lower: string): { body: string; time: string | null } | null {
  const idx = lower.indexOf('@')
  if (idx !== -1) {
    const body = lower.slice(0, idx).trim()
    const timeStr = lower.slice(idx + 1).trim()
    const time = parseTime(timeStr)
    if (time === null) {
      return null
    }
    return { body, time }
  }

  // Look for a standalone " at " token boundary.
  const tokens = splitWhitespace(lower)
  const pos = tokens.indexOf('at')
  if (pos !== -1) {
    const body = tokens.slice(0, pos).join(' ')
    const timeTokens = tokens.slice(pos + 1)
    if (timeTokens.length === 0) {
      return null
    }
    const time = parseTime(timeTokens.join(' '))
    if (time === null) {
      return null
    }
    return { body, time }
  }

  return { body: lower, time: null }
}

/** Parses "H[:MM][am|pm]" (or 24h "HH:MM") into "HH:MM". */
function parseTime(input: string): string | null {
  const s = input.trim()
  if (s.length === 0) {
    return null
  }

  let digits: string
  let isPm: boolean | null
  if (s.endsWith('am')) {
    digits = s.slice(0, -2).trim()
    isPm = false
  } else if (s.endsWith('pm')) {
    digits = s.slice(0, -2).trim()
    isPm = true
  } else {
    digits = s
    isPm = null
  }

  // `split_once(':')` — splits on the FIRST colon only, so "9:30:00" yields
  // minute_str "30:00", which then fails to parse. Same here.
  const colon = digits.indexOf(':')
  const hourStr = colon === -1 ? digits : digits.slice(0, colon)
  const minuteStr = colon === -1 ? '0' : digits.slice(colon + 1)

  let hour = parseU32(hourStr)
  const minute = parseU32(minuteStr)
  if (hour === null || minute === null) {
    return null
  }
  if (minute > 59) {
    return null
  }

  if (isPm !== null) {
    if (hour < 1 || hour > 12) {
      return null
    }
    hour %= 12 // 12am -> 0, 12pm -> 12 (below)
    if (isPm) {
      hour += 12
    }
  } else if (hour > 23) {
    return null
  }

  return `${pad2(hour)}:${pad2(minute)}`
}

/**
 * Mirrors Rust's `str::parse::<u32>()`: ASCII digits only, an optional leading
 * `+` is allowed, a leading `-` is not, surrounding whitespace is NOT allowed,
 * an empty string fails, and anything above u32::MAX overflows to an error.
 * `Number()`/`parseInt()` are both wrong here — `Number(" 9 ")` is 9 and
 * `parseInt("9abc")` is 9, where Rust rejects both.
 */
function parseU32(s: string): number | null {
  if (!/^\+?[0-9]+$/.test(s)) {
    return null
  }
  const n = Number(s)
  if (n > U32_MAX) {
    return null
  }
  return n
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/**
 * Mirrors Rust's `split_whitespace()`: splits on runs of whitespace and yields
 * no empty tokens (so a leading or trailing run does not produce `''`).
 */
function splitWhitespace(s: string): string[] {
  return s.split(/\s+/).filter((t) => t.length > 0)
}

// ---------------------------------------------------------------------------
// Date arithmetic — plain integer triples, never a `Date`
// ---------------------------------------------------------------------------

interface CivilDate {
  y: number
  m: number // 1-12
  d: number // 1-31
}

/** Parses a `YYYY-MM-DD` string. Throws on garbage — callers pass DB dates. */
function parseDate(s: string): CivilDate {
  const m = /^(-?\d+)-(\d{2})-(\d{2})$/.exec(s)
  if (m === null) {
    throw new Error(`recurrence: expected YYYY-MM-DD, got ${JSON.stringify(s)}`)
  }
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/**
 * Formats back to `YYYY-MM-DD`, mirroring chrono's `%Y`: 0..=9999 is
 * zero-padded to 4 digits, anything outside that range carries an explicit
 * sign. That sign is reachable through the parser — "every 100000 years" is a
 * legal rule — so the odd-looking "+102026-08-09" is what the desktop app
 * actually writes to `due_date`, and this port reproduces it rather than
 * quietly disagreeing. (Verified against chrono itself, not inferred from its
 * docs: `NaiveDate::from_ymd_opt(102026, 8, 9).format("%Y-%m-%d")` is
 * "+102026-08-09" and year -5 is "-0005-08-09".)
 */
function formatDate(date: CivilDate): string {
  const year =
    date.y >= 0 && date.y <= 9999
      ? String(date.y).padStart(4, '0')
      : date.y > 9999
        ? `+${date.y}`
        : `-${String(-date.y).padStart(4, '0')}`
  return `${year}-${pad2(date.m)}-${pad2(date.d)}`
}

/** Days since 1970-01-01, proleptic Gregorian (Howard Hinnant's days_from_civil). */
function daysFromCivil({ y, m, d }: CivilDate): number {
  const yy = y - (m <= 2 ? 1 : 0)
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400 // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1 // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
  return era * 146097 + doe - 719468
}

/** Inverse of `daysFromCivil` (civil_from_days). */
function civilFromDays(z: number): CivilDate {
  const zz = z + 719468
  const era = Math.floor(zz / 146097)
  const doe = zz - era * 146097 // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)) // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153) // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1 // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9) // [1, 12]
  return { y: y + (m <= 2 ? 1 : 0), m, d }
}

/** Negative when `a` is before `b`, positive when after, 0 when equal. */
function compareDates(a: CivilDate, b: CivilDate): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.m !== b.m) return a.m - b.m
  return a.d - b.d
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function addDays(date: CivilDate, days: number): CivilDate {
  return civilFromDays(daysFromCivil(date) + days)
}

/**
 * Adds N months, clamping the day-of-month to the target month's length:
 * first day of (month + N), then min(original day, days_in_that_month).
 */
function addMonthsClamped(date: CivilDate, months: number): CivilDate {
  const total = date.y * 12 + (date.m - 1) + months
  const y = Math.floor(total / 12)
  const m = total - y * 12 + 1
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) }
}

function addInterval(date: CivilDate, unit: RecurrenceUnit, interval: number): CivilDate {
  switch (unit) {
    case 'day':
      return addDays(date, interval)
    case 'week':
      return addDays(date, interval * 7)
    case 'month':
      return addMonthsClamped(date, interval)
    case 'year':
      // `interval` is already clamped to MAX_INTERVAL by the caller, so
      // interval * 12 stays well inside the safe-integer range.
      return addMonthsClamped(date, interval * 12)
  }
}

/**
 * Next due date STRICTLY after `today`, advancing by whole intervals from
 * `currentDue`. Both inputs and the result are `YYYY-MM-DD`.
 *
 * Landing exactly on `today` is not enough — it keeps advancing. Completing
 * early therefore advances one interval from the DUE date (not from the day
 * you completed it), and completing late skips every occurrence already in the
 * past in one go.
 *
 * The interval is clamped to [1, MAX_INTERVAL] here as well as in the parser,
 * so a hand-built rule with interval 0 terminates instead of looping forever.
 */
export function nextOccurrence(rule: RecurrenceRule, currentDue: string, today: string): string {
  const interval = Math.min(Math.max(Math.trunc(rule.interval), 1), MAX_INTERVAL)
  const todayDate = parseDate(today)
  let candidate = parseDate(currentDue)
  for (;;) {
    candidate = addInterval(candidate, rule.unit, interval)
    if (compareDates(candidate, todayDate) > 0) {
      return formatDate(candidate)
    }
  }
}
