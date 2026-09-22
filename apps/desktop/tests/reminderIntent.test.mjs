import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReminderIntent } from '../src/lib/reminderIntent.ts'
const task = {id:'t', due_date:'2026-09-22', due_time:'09:00', reminder_offset_minutes:30, google_calendar_enabled:true, content:'Keep', labels:['l']}
test('changing offset preserves unrelated task fields', () => {
  const next = applyReminderIntent(task, {reminderOffsetMinutes:15})
  assert.equal(next.reminder_offset_minutes, 15)
  assert.equal(next.content, 'Keep'); assert.deepEqual(next.labels,['l'])
})
test('clearing offset also disables phone publishing', () => {
  const next = applyReminderIntent(task, {clearReminder:true, googleCalendarEnabled:true})
  assert.equal(next.reminder_offset_minutes,null); assert.equal(next.google_calendar_enabled,false)
})
test('rejects untimed tasks and invalid offsets', () => {
  for (const n of [-1, 0.5, 40321, NaN]) assert.throws(() => applyReminderIntent(task,{reminderOffsetMinutes:n}))
  assert.throws(() => applyReminderIntent({...task,due_time:null},{reminderOffsetMinutes:5}))
})
