/* Natural-language dates for captures headed to a task (loop 2, decisions
   2026-09-23): day + time only, never recurrence. chrono-node finds the
   phrase; the rules below decide whether it counts.

   Rules (fix round 1, 2026-09-23 — Opus review + controller rulings):
   - A bare hour with no meridiem/noon/midnight ("at 3", "at 10:30") rejects
     the whole match, even alongside a day ("fri at 3") — too ambiguous.
   - Any recurrence word anywhere in the text ("every", "each", "daily",
     "weekly", "monthly", "yearly", "weekdays", "weekends") disqualifies the
     whole input, not just the words immediately before the match.
   - A possessive right after the match ("today's", "friday's") means the
     words aren't a date reference — skip that match.
   - A resolved date before ref's local day is skipped (captures don't
     schedule into the past).
   - The label spells out the year when the resolved date's year differs
     from ref's (Today/Tomorrow stay bare).

   Plain TS, no JSX, no `@/` imports — tests/captureDate.test.mjs imports it. */
import * as chrono from 'chrono-node'
import { addDays, format, isBefore, isSameDay, startOfDay } from 'date-fns'

export interface ParsedCaptureDate {
  /** YYYY-MM-DD, local. */
  dueDate: string
  /** HH:MM 24h, or null when no time was given. */
  dueTime: string | null
  /** Span in the parsed text, including a leading connector ("by monday"). */
  start: number
  end: number
  /** chrono's matched text, as typed. Lowercased, it is what ⌫ ignores. */
  matchText: string
  /** The text with the span removed and whitespace collapsed. */
  title: string
  /** 'Today' | 'Tomorrow' | 'Fri, Sep 25', plus ' · 3:00 PM' when timed. */
  label: string
}

const CONNECTOR_BEFORE = /\b(on|by|due|at|for)\s+$/i
const RECURRENCE_ANYWHERE = /\b(every|each|daily|weekly|monthly|yearly|weekdays|weekends)\b/i
const POSSESSIVE_AFTER = /^['’]s\b/i
const NOON_OR_MIDNIGHT = /\b(noon|midnight)\b/i

function localDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function dayLabel(d: Date, ref: Date): string {
  if (isSameDay(d, ref)) return 'Today'
  if (isSameDay(d, addDays(ref, 1))) return 'Tomorrow'
  if (d.getFullYear() !== ref.getFullYear()) return format(d, 'EEE, MMM d, yyyy')
  return format(d, 'EEE, MMM d')
}

/** First date phrase in `text` that passes Nimble's rules, or null. */
export function parseCaptureDate(text: string, ref: Date, ignore: readonly string[] = []): ParsedCaptureDate | null {
  if (RECURRENCE_ANYWHERE.test(text)) return null // any recurrence word disqualifies the whole capture

  const results = chrono.parse(text, ref, { forwardDate: true })
  for (const r of results) {
    const s = r.start
    if (r.end) continue // ranges ("mon-fri")
    if (ignore.includes(r.text.toLowerCase())) continue
    if (r.text.trim().toLowerCase() === 'now') continue

    const hourCertain = s.isCertain('hour')
    const hasTime = hourCertain && (s.isCertain('meridiem') || NOON_OR_MIDNIGHT.test(r.text))
    if (hourCertain && !hasTime) continue // bare hour ("at 3", "at 10:30") is too ambiguous - reject the whole match
    const hasDay = s.isCertain('day') || s.isCertain('weekday')
    if (!hasDay && !hasTime) continue // no usable day or time

    const end = r.index + r.text.length
    if (POSSESSIVE_AFTER.test(text.slice(end))) continue // "today's", "friday's" - not a date reference

    const date = s.date()
    if (isBefore(startOfDay(date), startOfDay(ref))) continue // don't schedule captures into the past

    const before = text.slice(0, r.index)
    const connector = before.match(CONNECTOR_BEFORE)
    const start = connector ? r.index - connector[0].length : r.index
    const title = (text.slice(0, start) + ' ' + text.slice(end)).replace(/\s+/g, ' ').trim()
    if (!title) continue

    const dueTime = hasTime ? format(date, 'HH:mm') : null
    const label = dayLabel(date, ref) + (hasTime ? ` · ${format(date, 'h:mm a')}` : '')
    return { dueDate: localDate(date), dueTime, start, end, matchText: r.text, title, label }
  }
  return null
}

/** ⌫ keeps the date words as text when the caret sits right after the
 *  date span (only spaces between) with nothing selected. */
export function isKeepAsTextKey(e: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  selectionStart: number | null
  selectionEnd: number | null
  spanEnd: number
  value: string
}): boolean {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false
  if (e.selectionStart === null || e.selectionStart !== e.selectionEnd) return false
  if (e.selectionStart < e.spanEnd) return false
  return e.value.slice(e.spanEnd, e.selectionStart).trim() === ''
}
