// Calendar-date helpers for the Today brief's date control (today P2-5).
// Inputs and outputs are `YYYY-MM-DD` strings; all math runs in UTC so a
// date never drifts across a timezone or DST boundary.

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** The ISO date `days` away from `date` (negative steps back). */
export function shiftIsoDate(date: string, days: number): string {
  const d = parse(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "Today", or "Sat, Aug 1" (plus ", 2025" when the year differs). */
export function formatBriefDate(date: string, today: string): string {
  if (date === today) return 'Today'
  const d = parse(date)
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
}

// ── "Today" in the user's timezone ──
// `toISOString()` is UTC: in Pacific time it rolls to tomorrow at 5pm, so
// "Today", the next-day guard and the brief dot all pointed at the wrong
// day every evening. These read the local calendar instead.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The local calendar date of `now` as `YYYY-MM-DD`. */
export function localIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Milliseconds from `now` until the next local midnight (23h / 25h on DST days). */
export function msUntilNextLocalDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}
