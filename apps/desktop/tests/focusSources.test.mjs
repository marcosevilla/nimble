// Pin a timezone west of UTC before any Date work so "local date" differs
// from the UTC date for evening timestamps.
process.env.TZ = 'America/Los_Angeles'

import test from 'node:test'
import assert from 'node:assert/strict'
import { candidateIds, queueTheseAction, localDueDate } from '../src/lib/focusSources.ts'

const TODAY = '2026-09-22'
let seq = 0
const task = (over = {}) => ({
  sync_policy: 'default', reminder_offset_minutes: null, google_calendar_enabled: false,
  id: `t${++seq}`, parent_id: null, content: 'Task', description: null, project_id: 'inbox',
  priority: 1, due_date: null, due_time: null, duration_minutes: null, recurrence_rule: null,
  section_id: null, labels: [], completed: false, completed_at: null, status: 'todo',
  linked_doc_id: null, position: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  external_id: null, external_source: null, remote_updated_at: null, synced_snapshot: null, ...over,
})
const config = { mode: 'count_up', budget_ms: null, work_ms: 0, break_ms: 0, rounds: 1 }
const snapshotWith = (taskIds) => ({
  queue_revision: 1, engine_revision: 1, owner_epoch: 'e', process_generation: 1, writer_device_id: 'mac',
  queue: taskIds.map((task_id, i) => ({ id: `entry-${i}`, task_id, occurrence_id: `occ-${i}`,
    added_at: '2026-09-22T00:00:00Z', source: { kind: 'today' }, explicit_still_open: false, config })),
  selected_occurrence_id: null, session: null, totals: {}, as_of: '2026-09-22T00:00:00Z',
  checkpoint_at: null, recovery_reason: null, replica: false,
})

test('Today: due today in candidates, earlier open work in still-open, undated and future excluded', () => {
  const tasks = [
    task({ id: 'a', due_date: TODAY }),
    task({ id: 'old', due_date: '2026-09-20' }),
    task({ id: 'b', due_date: TODAY }),
    task({ id: 'none' }),
    task({ id: 'later', due_date: '2026-09-23' }),
    task({ id: 'done', due_date: TODAY, completed: true, status: 'complete' }),
    task({ id: 'doneStatus', due_date: '2026-09-01', status: 'complete' }),
  ]
  assert.deepEqual(candidateIds(tasks, { kind: 'today' }, TODAY), { ids: ['a', 'b'], still_open_ids: ['old'] })
})

test('Today compares local calendar dates, not UTC dates', () => {
  // 02:00Z on the 23rd is 19:00 on the 22nd in Los Angeles: due today.
  assert.equal(localDueDate('2026-09-23T02:00:00Z'), TODAY)
  // A date-only value is already a local calendar date — never parsed as UTC midnight.
  assert.equal(localDueDate(TODAY), TODAY)
  // A floating (no offset) datetime keeps its written date.
  assert.equal(localDueDate('2026-09-22T23:30:00'), TODAY)
  const tasks = [
    task({ id: 'evening', due_date: '2026-09-23T02:00:00Z' }),
    task({ id: 'plain', due_date: TODAY }),
    task({ id: 'utcYesterdayLocal', due_date: '2026-09-22T06:00:00Z' }), // 23:00 on the 21st locally
  ]
  assert.deepEqual(candidateIds(tasks, { kind: 'today' }, TODAY),
    { ids: ['evening', 'plain'], still_open_ids: ['utcYesterdayLocal'] })
})

test('Project: open tasks in project order, undated and past-due included, nothing collapsed', () => {
  const tasks = [
    task({ id: 'p3', project_id: 'proj', position: 3 }),
    task({ id: 'other', project_id: 'elsewhere', position: 0 }),
    task({ id: 'p1', project_id: 'proj', position: 1, due_date: '2026-01-01' }),
    task({ id: 'p2', project_id: 'proj', position: 2, due_date: '2026-12-31' }),
    task({ id: 'p1b', project_id: 'proj', position: 1 }), // tie keeps input order
    task({ id: 'pdone', project_id: 'proj', position: 0, completed: true }),
  ]
  assert.deepEqual(candidateIds(tasks, { kind: 'project', project_id: 'proj' }, TODAY),
    { ids: ['p1', 'p1b', 'p2', 'p3'], still_open_ids: [] })
})

test('Project order follows section lanes like the project view: unsectioned, then sections by position', () => {
  const sections = [
    { id: 'sec-late', project_id: 'proj', name: 'Later', position: 2, external_id: null, external_source: null, created_at: '' },
    { id: 'sec-first', project_id: 'proj', name: 'First', position: 1, external_id: null, external_source: null, created_at: '' },
  ]
  const tasks = [
    task({ id: 'late0', project_id: 'proj', section_id: 'sec-late', position: 0 }),
    task({ id: 'first1', project_id: 'proj', section_id: 'sec-first', position: 1 }),
    task({ id: 'none5', project_id: 'proj', position: 5 }),
    task({ id: 'first0', project_id: 'proj', section_id: 'sec-first', position: 0 }),
    task({ id: 'ghost', project_id: 'proj', section_id: 'deleted-section', position: 9 }), // unknown -> unsectioned lane
    task({ id: 'none2', project_id: 'proj', position: 2 }),
  ]
  assert.deepEqual(candidateIds(tasks, { kind: 'project', project_id: 'proj' }, TODAY, sections).ids,
    ['none2', 'none5', 'ghost', 'first0', 'first1', 'late0'])
  const action = queueTheseAction(tasks, { kind: 'project', project_id: 'proj' }, TODAY, snapshotWith(['none5']), { sections })
  assert.deepEqual(action.task_ids, ['none2', 'ghost', 'first0', 'first1', 'late0'])
})

test('Local-only: only tasks flagged local_only, in input order', () => {
  const tasks = [
    task({ id: 'bound', external_id: '123', external_source: 'todoist' }),
    task({ id: 'l1', sync_policy: 'local_only', due_date: '2026-01-01' }),
    task({ id: 'plain' }),
    task({ id: 'l2', sync_policy: 'local_only' }),
  ]
  assert.deepEqual(candidateIds(tasks, { kind: 'local' }, TODAY), { ids: ['l1', 'l2'], still_open_ids: [] })
})

test('children fold under a candidate ancestor; a lone child stays a candidate', () => {
  const tasks = [
    task({ id: 'parent', project_id: 'p', position: 0 }),
    task({ id: 'child', parent_id: 'parent', project_id: 'p', position: 1 }),
    task({ id: 'mid', parent_id: 'parent', project_id: 'p', position: 2, completed: true }),
    task({ id: 'grand', parent_id: 'mid', project_id: 'p', position: 3 }),
    task({ id: 'orphanChild', parent_id: 'notACandidate', project_id: 'p', position: 4 }),
  ]
  assert.deepEqual(candidateIds(tasks, { kind: 'project', project_id: 'p' }, TODAY).ids, ['parent', 'orphanChild'])
  // Today: the parent is not due today, so its due-today child is its own candidate.
  const today = [task({ id: 'P', due_date: '2026-09-25' }), task({ id: 'C', parent_id: 'P', due_date: TODAY })]
  assert.deepEqual(candidateIds(today, { kind: 'today' }, TODAY).ids, ['C'])
})

test('cyclic parent links do not hang folding', () => {
  const tasks = [task({ id: 'x', parent_id: 'y', project_id: 'p' }), task({ id: 'y', parent_id: 'x', project_id: 'p' })]
  const out = candidateIds(tasks, { kind: 'project', project_id: 'p' }, TODAY)
  assert.ok(Array.isArray(out.ids))
})

test('huge string IDs are kept verbatim and never numerically coerced or sorted', () => {
  const big = ['9007199254740993123456', '9007199254740993123455', '00042']
  const tasks = big.map((id) => task({ id, sync_policy: 'local_only' }))
  const out = candidateIds(tasks, { kind: 'local' }, TODAY)
  assert.deepEqual(out.ids, big)
  const action = queueTheseAction(tasks, { kind: 'local' }, TODAY, snapshotWith([]))
  assert.deepEqual(action.task_ids, big)
})

test('queue these: candidate order once, omits queued tasks and children of queued parents', () => {
  const tasks = [
    task({ id: 'q', project_id: 'p', position: 0 }),
    task({ id: 'qChild', parent_id: 'q', project_id: 'p', position: 1 }),
    task({ id: 'queuedParent', project_id: 'x', position: 0 }),
    task({ id: 'kid', parent_id: 'queuedParent', project_id: 'p', position: 2 }),
    task({ id: 'r', project_id: 'p', position: 3 }),
    task({ id: 's', project_id: 'p', position: 4 }),
  ]
  const source = { kind: 'project', project_id: 'p' }
  const action = queueTheseAction(tasks, source, TODAY, snapshotWith(['queuedParent', 'r']))
  assert.deepEqual(action, { kind: 'enqueue', task_ids: ['q', 's'], source: { kind: 'project', project_id: 'p' },
    explicit_still_open: false })
  // Nothing new to add yields no action rather than an empty command.
  assert.equal(queueTheseAction(tasks, source, TODAY, snapshotWith(['q', 'queuedParent', 'r', 's'])), null)
})

test('queue these captures the source at intent time; later source switches cannot move it', () => {
  const source = { kind: 'project', project_id: 'p' }
  const action = queueTheseAction([task({ id: 'a', project_id: 'p' })], source, TODAY, snapshotWith([]))
  source.project_id = 'switched' // the view changes source while the command is in flight
  assert.deepEqual(action.source, { kind: 'project', project_id: 'p' })
})

test('still-open work joins only by explicit request and is flagged as such', () => {
  const tasks = [task({ id: 'old', due_date: '2026-09-01' }), task({ id: 'now', due_date: TODAY })]
  const snap = snapshotWith([])
  assert.deepEqual(queueTheseAction(tasks, { kind: 'today' }, TODAY, snap).task_ids, ['now'])
  const explicit = queueTheseAction(tasks, { kind: 'today' }, TODAY, snap, { stillOpen: true })
  assert.deepEqual(explicit, { kind: 'enqueue', task_ids: ['old'], source: { kind: 'today' }, explicit_still_open: true })
})
