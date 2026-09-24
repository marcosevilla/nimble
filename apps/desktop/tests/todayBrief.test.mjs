import test from 'node:test'
import assert from 'node:assert/strict'
import { hhmm, splitDueTasks, ageLabel, largestFreeBlock, formatFreeBlock, nextEvent, greetingFor, shouldAutoGenerate, nowHHMM, briefReady } from '../src/lib/todayBrief.ts'

test('hhmm reads both the real "HH:MM" and the mock ISO shape', () => {
  assert.equal(hhmm('10:05'), '10:05')
  assert.equal(hhmm('2026-08-01T08:30:00'), '08:30')
})

test('splitDueTasks: today vs still open, top level only, oldest first', () => {
  const t = (id, due, parent = null) => ({ id, due_date: due, parent_id: parent, completed: false })
  const { dueToday, stillOpen } = splitDueTasks(
    [t('a', '2026-09-23'), t('b', '2026-09-20'), t('c', '2026-08-01'), t('d', '2026-09-23', 'a'), t('e', null)],
    '2026-09-23')
  assert.deepEqual(dueToday.map((x) => x.id), ['a'])
  assert.deepEqual(stillOpen.map((x) => x.id), ['c', 'b'])
})

test('ageLabel is short and neutral', () => {
  assert.equal(ageLabel('2026-09-22', '2026-09-23'), '1d')
  assert.equal(ageLabel('2026-09-09', '2026-09-23'), '2w')
  assert.equal(ageLabel('2026-06-01', '2026-09-23'), '3mo')
  assert.equal(ageLabel('2025-09-01', '2026-09-23'), '1y')
})

test('largestFreeBlock finds the widest gap in the working window', () => {
  const ev = (s, e) => ({ start_time: s, end_time: e, all_day: false })
  const b = largestFreeBlock([ev('09:00', '10:00'), ev('11:30', '13:00'), ev('15:30', '16:00')])
  assert.deepEqual(b, { start: '13:00', end: '15:30', minutes: 150 })
  assert.equal(formatFreeBlock(b), '2h 30m open, 13:00–15:30')
  assert.equal(largestFreeBlock([ev('09:00', '18:00')]), null)
  assert.deepEqual(largestFreeBlock([], { from: '16:00' }), { start: '16:00', end: '18:00', minutes: 120 })
  assert.equal(largestFreeBlock([{ start_time: '', end_time: '', all_day: true }], { from: '17:45' }), null)
})

test('nextEvent skips all-day and past events', () => {
  const ev = (id, s, all_day = false) => ({ id, start_time: s, all_day })
  assert.equal(nextEvent([ev('x', '', true), ev('a', '09:00'), ev('b', '14:00')], '10:15').id, 'b')
  assert.equal(nextEvent([ev('a', '09:00')], '10:15'), null)
})

test('greetingFor splits the day at 12 and 17', () => {
  assert.equal(greetingFor(8), 'Good morning')
  assert.equal(greetingFor(12), 'Good afternoon')
  assert.equal(greetingFor(17), 'Good evening')
})

test('auto-generate at most once a day, never without a key', () => {
  assert.equal(shouldAutoGenerate({ cached: false, tried: false, noKey: false }), true)
  assert.equal(shouldAutoGenerate({ cached: true, tried: false, noKey: false }), false)
  assert.equal(shouldAutoGenerate({ cached: false, tried: true, noKey: false }), false)
  assert.equal(shouldAutoGenerate({ cached: false, tried: false, noKey: true }), false)
})

test('nowHHMM is the local clock as zero-padded "HH:MM"', () => {
  assert.equal(nowHHMM(new Date(2026, 8, 23, 7, 5)), '07:05')
  assert.equal(nowHHMM(new Date(2026, 8, 23, 18, 30)), '18:30')
})

test('splitDueTasks: completed tasks stay in Due today but never count as still open', () => {
  const t = (id, due, completed) => ({ id, due_date: due, parent_id: null, completed })
  const { dueToday, stillOpen } = splitDueTasks(
    [t('done-today', '2026-09-23', true), t('open-today', '2026-09-23', false), t('done-old', '2026-09-01', true), t('open-old', '2026-09-02', false)],
    '2026-09-23')
  assert.deepEqual(dueToday.map((x) => x.id), ['done-today', 'open-today'])
  assert.deepEqual(stillOpen.map((x) => x.id), ['open-old'])
})

test('briefReady: only once the calendar and the task list have loaded this date (Review Focus 1)', () => {
  const today = '2026-09-24'
  assert.equal(briefReady({ today, calendarLoadedFor: today, tasksLoadedFor: today }), true)
  // Just past midnight: both hooks still hold yesterday's data.
  assert.equal(briefReady({ today, calendarLoadedFor: '2026-09-23', tasksLoadedFor: '2026-09-23' }), false)
  // The calendar has caught up, the task list hasn't (and vice versa).
  assert.equal(briefReady({ today, calendarLoadedFor: today, tasksLoadedFor: '2026-09-23' }), false)
  assert.equal(briefReady({ today, calendarLoadedFor: '2026-09-23', tasksLoadedFor: today }), false)
  // First open: nothing loaded yet.
  assert.equal(briefReady({ today, calendarLoadedFor: null, tasksLoadedFor: null }), false)
})
