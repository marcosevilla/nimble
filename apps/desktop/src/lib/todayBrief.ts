// Pure helpers for the Today brief (spec 2026-09-23, phase 1). Plain TS so
// node tests import it directly. Times are local "HH:MM".

export const TODAY_LAYOUT = ['schedule', 'priorities', 'due_today', 'still_open', 'vault'] as const

/** Real events carry "HH:MM"; the browser mock carries ISO datetimes. */
export function hhmm(time: string): string {
  return time.includes('T') ? time.slice(11, 16) : time.slice(0, 5)
}

const toMin = (t: string) => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m }
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

export function splitDueTasks<T extends { due_date: string | null; parent_id: string | null }>(tasks: T[], today: string) {
  const top = tasks.filter((t) => !t.parent_id && t.due_date)
  return {
    dueToday: top.filter((t) => t.due_date === today),
    stillOpen: top.filter((t) => (t.due_date as string) < today)
      .sort((a, b) => (a.due_date as string).localeCompare(b.due_date as string)),
  }
}

const DAY = 86_400_000
export function ageLabel(due: string, today: string): string {
  const days = Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / DAY))
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

export function largestFreeBlock(
  events: { start_time: string; end_time: string; all_day: boolean }[],
  opts: { from?: string; to?: string } = {},
): { start: string; end: string; minutes: number } | null {
  const lo = Math.max(toMin('09:00'), opts.from ? toMin(opts.from) : 0)
  const hi = toMin(opts.to ?? '18:00')
  const busy = events.filter((e) => !e.all_day && e.start_time && e.end_time)
    .map((e) => [toMin(e.start_time), toMin(e.end_time)] as const)
    .sort((a, b) => a[0] - b[0])
  let best: { start: number; end: number } | null = null
  let cursor = lo
  for (const [s, e] of [...busy, [hi, hi] as const]) {
    const gapEnd = Math.min(s, hi)
    if (gapEnd - cursor >= 30 && (!best || gapEnd - cursor > best.end - best.start)) best = { start: cursor, end: gapEnd }
    cursor = Math.max(cursor, e)
    if (cursor >= hi) break
  }
  return best && { start: fromMin(best.start), end: fromMin(best.end), minutes: best.end - best.start }
}

export function formatFreeBlock(b: { start: string; end: string; minutes: number }): string {
  const h = Math.floor(b.minutes / 60), m = b.minutes % 60
  const len = h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
  return `${len} open, ${b.start}–${b.end}`
}

/** The local clock as "HH:MM", the shape `nextEvent` and `largestFreeBlock` take. */
export function nowHHMM(now: Date = new Date()): string {
  return fromMin(now.getHours() * 60 + now.getMinutes())
}

export function nextEvent<E extends { start_time: string; all_day: boolean }>(events: E[], now: string): E | null {
  return events.find((e) => !e.all_day && e.start_time && toMin(e.start_time) >= toMin(now)) ?? null
}

export function greetingFor(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

/** Priorities auto-generate once per day: never over a cached set, never
 *  twice after a try, never without a key (Review Focus 3). */
export function shouldAutoGenerate(s: { cached: boolean; tried: boolean; noKey: boolean }): boolean {
  return !s.cached && !s.tried && !s.noKey
}

// Compact brief: a per-device view preference, never reset by a new day (§0 Q3).
const COMPACT_KEY = 'nimble.todayCompact'
export function loadTodayCompact(): boolean {
  try { return localStorage.getItem(COMPACT_KEY) === '1' } catch { return false }
}
export function saveTodayCompact(v: boolean): void {
  try { localStorage.setItem(COMPACT_KEY, v ? '1' : '0') } catch { /* session-only */ }
}
