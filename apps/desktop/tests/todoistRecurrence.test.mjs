import test from 'node:test'
import assert from 'node:assert/strict'
import { todoistOwnsRecurrence, recurringCompletionNotice, TODOIST_SCHEDULES_NEXT } from '../src/lib/todoistRecurrence.ts'
import { completionPlan } from '../src/services/turso/completionPlan.ts'

// 2026-09-25: Todoist advances a task it says is recurring. Completing one
// anywhere in Nimble must complete it (the Mac pushes item_close) — never
// advance it with Nimble's own calculation, which Todoist would receive as a
// re-anchoring due update.

const snapshot = (recurring, string = 'every 2 weeks @ 09:00') =>
  JSON.stringify({ content: 'x', due_date: '2026-10-04', due: { date: '2026-10-04', string, is_recurring: recurring }, checked: false })

const task = (over = {}) => ({
  id: 't1',
  due_date: '2026-10-04',
  due_time: '09:00',
  recurrence_rule: 'every 2 weeks @ 09:00',
  external_source: 'todoist',
  external_id: 'R1',
  sync_policy: 'default',
  synced_snapshot: snapshot(true),
  ...over,
})

test('linked + recurring in stored Todoist state is Todoist-owned', () => {
  assert.equal(todoistOwnsRecurrence(task()), true)
})

test('native, local-only, non-recurring in Todoist, or unreadable snapshots are not', () => {
  assert.equal(todoistOwnsRecurrence(task({ external_source: null, external_id: null, synced_snapshot: null })), false)
  assert.equal(todoistOwnsRecurrence(task({ sync_policy: 'local_only' })), false)
  assert.equal(todoistOwnsRecurrence(task({ synced_snapshot: snapshot(false, 'Oct 4') })), false)
  assert.equal(todoistOwnsRecurrence(task({ synced_snapshot: '{not json' })), false)
})

test('web completion of a Todoist-owned task completes without cascade', () => {
  assert.deepEqual(completionPlan(task(), undefined, '2026-10-04'), { kind: 'complete', cascade: false })
})

test('web completion of a native recurring task still advances', () => {
  const native = task({ external_source: null, external_id: null, synced_snapshot: null })
  assert.deepEqual(completionPlan(native, undefined, '2026-10-04'), { kind: 'advance', nextDue: '2026-10-18', nextDueTime: '09:00' })
})

test('plain tasks complete with cascade', () => {
  assert.deepEqual(completionPlan(task({ recurrence_rule: null, synced_snapshot: null, external_source: null, external_id: null }), undefined, '2026-10-04'), { kind: 'complete', cascade: true })
})

test('a stale occurrence is refused for Todoist-owned tasks too', () => {
  assert.throws(() => completionPlan(task(), '2026-09-20', '2026-10-04'), /stale_occurrence/)
  assert.deepEqual(completionPlan(task(), '2026-10-04', '2026-10-04'), { kind: 'complete', cascade: false })
})

test('completion notice never predicts a date Todoist will choose', () => {
  assert.deepEqual(recurringCompletionNotice(task(), '2026-10-04'), { kind: 'todoist', message: TODOIST_SCHEDULES_NEXT })
  assert.equal(TODOIST_SCHEDULES_NEXT, 'Todoist will schedule the next one.')
  const native = task({ external_source: null, external_id: null, synced_snapshot: null })
  assert.deepEqual(recurringCompletionNotice(native, '2026-10-04'), { kind: 'rescheduled', nextDue: '2026-10-18' })
  assert.equal(recurringCompletionNotice(task({ recurrence_rule: null, synced_snapshot: null }), '2026-10-04'), null)
})
