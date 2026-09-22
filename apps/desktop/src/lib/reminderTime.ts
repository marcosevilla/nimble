import { format, isSameDay, isValid } from 'date-fns'

/**
 * Relative reminder time for the Today catch-up rows: "Today · 9:00" for the
 * current day, otherwise "MMM d · H:mm". No seconds, no year — matches the
 * rest of the surface's date language (TaskItem's DueDateBadge).
 */
export function formatReminderTime(scheduledAt: string, now: Date = new Date()): string {
  const d = new Date(scheduledAt)
  if (!isValid(d)) return scheduledAt
  const time = format(d, 'H:mm')
  return isSameDay(d, now) ? `Today · ${time}` : `${format(d, 'MMM d')} · ${time}`
}
