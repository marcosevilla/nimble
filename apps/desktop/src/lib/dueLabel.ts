import { format, isToday, isTomorrow, parseISO } from 'date-fns'

/** A due date's short label: Today / Tomorrow / `MMM d`. Date-only strings
 * round-trip in local time (parseISO, no UTC conversion). Shared by the
 * task row's due badge and the detail page's due chip. */
export function dueBadgeLabel(date: string): string {
  const parsed = parseISO(date)
  if (isToday(parsed)) return 'Today'
  if (isTomorrow(parsed)) return 'Tomorrow'
  return format(parsed, 'MMM d')
}
