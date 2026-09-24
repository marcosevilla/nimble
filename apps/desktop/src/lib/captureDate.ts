/* Natural-language dates for captures headed to a task (loop 2, decisions
   2026-09-23): day + time only, never recurrence. chrono-node finds the
   phrase; the rules below decide whether it counts.

   Plain TS, no JSX, no `@/` imports — tests/captureDate.test.mjs imports it. */
import * as chrono from 'chrono-node'
import { addDays, format, isSameDay } from 'date-fns'

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
const RECURRENCE_BEFORE = /\b(every|each)\s+$/i
const NOON_OR_MIDNIGHT = /\b(noon|midnight)\b/i

function localDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function dayLabel(d: Date, ref: Date): string {
  if (isSameDay(d, ref)) return 'Today'
  if (isSameDay(d, addDays(ref, 1))) return 'Tomorrow'
  return format(d, 'EEE, MMM d')
}

/** First date phrase in `text` that passes Nimble's rules, or null. */
export function parseCaptureDate(text: string, ref: Date, ignore: readonly string[] = []): ParsedCaptureDate | null {
  const results = chrono.parse(text, ref, { forwardDate: true })
  for (const r of results) {
    const s = r.start
    if (r.end) continue // ranges ("mon-fri")
    if (ignore.includes(r.text.toLowerCase())) continue
    if (r.text.trim().toLowerCase() === 'now') continue
    const before = text.slice(0, r.index)
    if (RECURRENCE_BEFORE.test(before)) continue

    const hasDay = s.isCertain('day') || s.isCertain('weekday')
    const hasTime = s.isCertain('hour') && (s.isCertain('meridiem') || NOON_OR_MIDNIGHT.test(r.text))
    if (!hasDay && !hasTime) continue // "call at 3" would read as 3 AM

    const connector = before.match(CONNECTOR_BEFORE)
    const start = connector ? r.index - connector[0].length : r.index
    const end = r.index + r.text.length
    const title = (text.slice(0, start) + ' ' + text.slice(end)).replace(/\s+/g, ' ').trim()
    if (!title) continue

    const date = s.date()
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
