import type { LocalTask } from '@nimble/types'
export interface ReminderIntent { reminderOffsetMinutes?: number; googleCalendarEnabled?: boolean; clearReminder?: boolean }
export function applyReminderIntent(task: LocalTask, opts: ReminderIntent): LocalTask {
  const next = { ...task }
  if (opts.reminderOffsetMinutes !== undefined) {
    if (!Number.isInteger(opts.reminderOffsetMinutes) || opts.reminderOffsetMinutes < 0 || opts.reminderOffsetMinutes > 40320) throw new Error('Invalid reminder offset')
    next.reminder_offset_minutes = opts.reminderOffsetMinutes
  }
  if (opts.googleCalendarEnabled !== undefined) next.google_calendar_enabled = opts.googleCalendarEnabled
  if (opts.clearReminder) { next.reminder_offset_minutes = null; next.google_calendar_enabled = false }
  if (next.reminder_offset_minutes !== null && (!next.due_date || !next.due_time)) throw new Error('A reminder needs a date and time')
  if (next.google_calendar_enabled && next.reminder_offset_minutes === null) throw new Error('Phone alerts need a reminder')
  return next
}
