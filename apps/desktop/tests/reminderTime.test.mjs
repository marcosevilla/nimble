import test from 'node:test'
import assert from 'node:assert/strict'
import { formatReminderTime } from '../src/lib/reminderTime.ts'

const now = new Date(2026, 7, 1, 10, 30) // Sat Aug 1 2026, 10:30 local

test('a reminder scheduled today reads "Today · H:mm"', () => {
  assert.equal(formatReminderTime(new Date(2026, 7, 1, 9, 0).toISOString(), now), 'Today · 9:00')
})

test('a reminder on another day reads "MMM d · H:mm" with no seconds or year', () => {
  assert.equal(formatReminderTime(new Date(2026, 6, 30, 14, 5).toISOString(), now), 'Jul 30 · 14:05')
})

test('an unparseable time falls back to the raw string rather than "Invalid Date"', () => {
  assert.equal(formatReminderTime('not-a-date', now), 'not-a-date')
})
