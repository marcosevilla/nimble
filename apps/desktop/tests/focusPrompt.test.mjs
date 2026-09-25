import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFocusPrompt, copyFocusPrompt } from '../src/lib/focusPrompt.ts'

const MIN = 60000
const task = (over = {}) => ({
  sync_policy: 'default', reminder_offset_minutes: null, google_calendar_enabled: false,
  id: 'task-9007199254740993123', parent_id: null, content: 'Write the launch brief',
  description: 'Two pages, audience is the label.', project_id: 'proj-1', priority: 4,
  due_date: '2026-09-22', due_time: '14:00', duration_minutes: null, recurrence_rule: null,
  section_id: null, labels: [], completed: false, completed_at: null, status: 'in_progress',
  linked_doc_id: null, position: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  external_id: '8123456789012345678', external_source: 'todoist', remote_updated_at: null,
  synced_snapshot: null, ...over,
})
const config = (budget_ms) => ({ mode: budget_ms == null ? 'count_up' : 'timebox', budget_ms,
  work_ms: 0, break_ms: 0, rounds: 1 })
const snapshot = ({ budget = 45 * MIN, total = 25 * MIN, session = 'paused', queued = true } = {}) => ({
  queue_revision: 3, engine_revision: 7, owner_epoch: 'e', process_generation: 1, writer_device_id: 'mac',
  queue: queued ? [{ id: 'entry-1', task_id: 'task-9007199254740993123', occurrence_id: 'occ-1',
    added_at: '2026-09-22T00:00:00Z', source: { kind: 'today' }, explicit_still_open: false, config: config(budget) }] : [],
  selected_occurrence_id: queued ? 'occ-1' : null,
  session: session ? { id: 'sess-1', occurrence_id: 'occ-1', status: session, phase: 'work', work_ms: total,
    break_ms: 0, round_work_ms: total, round: 1, config: config(budget) } : null,
  totals: queued ? { 'occ-1': total } : {}, as_of: '2026-09-22T17:00:00Z', checkpoint_at: null,
  recovery_reason: null, replica: false,
})
const children = [
  task({ id: 'sub-1', parent_id: 'task-9007199254740993123', content: 'Outline sections', description: null }),
  task({ id: 'sub-2', parent_id: 'task-9007199254740993123', content: 'Pull stats', completed: true,
    status: 'complete', description: null }),
]
const caps = { queue_read: true, queue_write: true, history_read: true, live_timing: false,
  companion: false, import: false, reason: null }

test('prompt includes identity, project, due, priority, description, subtasks, time and budget', () => {
  const text = buildFocusPrompt(task(), children, snapshot(), { projectName: 'Label work', capabilities: caps })
  for (const needle of [
    'Write the launch brief',
    'task-9007199254740993123', // native ID verbatim, never numerically coerced
    '8123456789012345678', // external ID verbatim
    'todoist',
    'Label work', 'proj-1',
    '2026-09-22 14:00',
    'Urgent',
    'Two pages, audience is the label.',
    'Outline sections', 'sub-1', 'Pull stats',
    '25:00', // accumulated work
    '45:00', // budget
    'paused',
  ]) assert.ok(text.includes(needle), `missing ${needle}\n${text}`)
  assert.match(text, /\[ \] Outline sections/)
  assert.match(text, /\[x\] Pull stats/)
})

test('prompt never promises comment refresh or guilt framing', () => {
  const bound = buildFocusPrompt(task(), children, snapshot(), { capabilities: caps })
  const local = buildFocusPrompt(task({ external_id: null, external_source: null, sync_policy: 'local_only' }),
    [], snapshot(), { capabilities: caps })
  for (const text of [bound, local]) {
    assert.doesNotMatch(text, /comments?\s+(will\s+)?(refresh|sync|appear|show up)/i)
    assert.doesNotMatch(text, /\b(overdue|late|behind)\b/i)
  }
  // Bound task: truthful about the Todoist route, and says comments are not shown in Nimble.
  assert.match(bound, /comments are not shown in Nimble/i)
  // Local-only task: no external link is claimed (Todoist is only named as forbidden).
  assert.match(local, /exists only in Nimble/i)
  assert.doesNotMatch(local, /linked to/i)
})

test('linked route names the external task and how results reach Nimble', () => {
  const text = buildFocusPrompt(task(), [], snapshot(), { capabilities: caps })
  assert.ok(text.includes('It is linked to todoist task 8123456789012345678.'), text)
  assert.ok(text.includes('Write results to Nimble with the `dt` CLI using Nimble task ID'), text)
  assert.ok(text.includes('Nimble syncs them to the todoist task. Do not also write them to todoist; that creates duplicates.'), text)
  assert.doesNotMatch(text, /Put results in subtasks or the description of that/)
  assert.ok(text.includes('Task comments are not shown in Nimble.'), text)
  assert.doesNotMatch(text, /reply here/i)
  assert.ok(text.includes('**External ID:** todoist 8123456789012345678'))
})

test('local-only route writes back with dt on the Nimble task ID, never Todoist', () => {
  const text = buildFocusPrompt(task({ external_id: null, external_source: null, sync_policy: 'local_only' }),
    [], snapshot(), { capabilities: caps })
  assert.ok(text.includes('It exists only in Nimble, with no external link.'), text)
  assert.ok(text.includes('Write results to Nimble with the `dt` CLI using Nimble task ID task-9007199254740993123.'), text)
  assert.ok(text.includes('Never write them to Todoist or any external service.'), text)
  assert.doesNotMatch(text, /reply here/i)
  assert.doesNotMatch(text, /External ID/)
})

test('local_only task with a stale external_id prints no External ID line and the local-only route', () => {
  const text = buildFocusPrompt(task({ sync_policy: 'local_only' }), [], snapshot(), { capabilities: caps })
  assert.doesNotMatch(text, /External ID/)
  assert.doesNotMatch(text, /8123456789012345678/)
  assert.doesNotMatch(text, /linked to/i)
  assert.ok(text.includes('Write results to Nimble with the `dt` CLI using Nimble task ID task-9007199254740993123.'), text)
  assert.ok(text.includes('Never write them to Todoist or any external service.'), text)
})

test('prompt reports capability limits truthfully', () => {
  const readOnly = { ...caps, queue_write: false, reason: 'The web shows the settled focus queue.' }
  const text = buildFocusPrompt(task(), [], snapshot(), { capabilities: readOnly })
  assert.match(text, /read-only/i)
  assert.ok(text.includes('The web shows the settled focus queue.'))
  // live_timing false: the total is the last settled figure, labelled with its as-of time.
  assert.match(text, /as of 2026-09-22T17:00:00Z/)
})

test('prompt handles count-up, no session, unqueued and sparse tasks', () => {
  const countUp = buildFocusPrompt(task(), [], snapshot({ budget: null, session: null }))
  assert.match(countUp, /Budget:\*\* none \(count-up\)/)
  assert.match(countUp, /not started/i)
  const bare = buildFocusPrompt(task({ due_date: null, due_time: null, description: null, priority: 1 }), [],
    snapshot({ queued: false, session: null }))
  assert.match(bare, /Due:\*\* none/)
  assert.match(bare, /Not in the focus queue/)
  assert.match(bare, /Subtasks:\*\* none/)
  assert.doesNotMatch(bare, /Description/)
  assert.doesNotMatch(bare, /undefined|null|NaN/)
})

test('clipboard success reports ok', async () => {
  let written = null
  const result = await copyFocusPrompt('hello', async (t) => { written = t })
  assert.deepEqual(result, { ok: true })
  assert.equal(written, 'hello')
})

test('clipboard failure is visible and preserves the text for manual copy', async () => {
  const result = await copyFocusPrompt('keep me', async () => { throw new Error('denied') })
  assert.deepEqual(result, { ok: false, text: 'keep me', message: 'denied' })
  const missing = await copyFocusPrompt('keep me too', undefined)
  assert.equal(missing.ok, false)
  assert.equal(missing.text, 'keep me too')
})
