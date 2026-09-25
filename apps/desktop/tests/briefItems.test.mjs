import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_LINE, composeView, summaryLine, legacyPriorities, itemsOf, isItemDone, itemTitle, stripTitles, producedIds, briefItemFromRow,
} from '../src/lib/briefItems.ts'

const T = '2026-09-25'
const shell = { status: 'ready', composed_at: null, snapshot: { priorities: null } }
const ai = { status: 'ready', composed_at: '2026-09-25 06:30:05', snapshot: { compose: { summary: '  A calm day.  ', origin: 'ai', wins: [] } } }
const rule = { status: 'fallback', composed_at: '2026-09-25 06:30:05', snapshot: { compose: { summary: '', origin: 'rule', wins: [] } } }

const item = (o = {}) => ({
  id: `${T}:priority:a`, date: T, module_id: 'priorities', kind: 'priority', title: 'Frozen title', body: null, task_id: 'a',
  origin: 'ai', dedupe_key: 'priority:a', action_kind: null, action_state: 'none', produced_ref: null, position: 0,
  created_at: 'n', updated_at: 'n',
  task: { status: 'todo', completed: false, due_date: null, content: 'Live title', description: null, project_id: 'inbox' },
  ...o,
})

test('composeView: skeletons only while today composes on a client that can', () => {
  const base = { date: T, today: T, supported: true, settled: false }
  assert.equal(composeView({ ...base, brief: undefined }), 'pending')
  assert.equal(composeView({ ...base, brief: null }), 'pending')
  assert.equal(composeView({ ...base, brief: shell }), 'pending')
  assert.equal(composeView({ ...base, brief: ai }), 'ai')
  assert.equal(composeView({ ...base, brief: rule }), 'fallback')
})

test('composeView: a settled call, a past date or the web never shows endless skeletons', () => {
  assert.equal(composeView({ date: T, today: T, supported: true, settled: true, brief: shell }), 'none')
  assert.equal(composeView({ date: T, today: T, supported: true, settled: true, brief: null }), 'none')
  assert.equal(composeView({ date: '2026-09-24', today: T, supported: true, settled: false, brief: undefined }), 'none')
  assert.equal(composeView({ date: T, today: T, supported: false, settled: false, brief: shell }), 'none')
  assert.equal(composeView({ date: T, today: T, supported: false, settled: false, brief: ai }), 'ai')
})

test('summaryLine: the fallback line, a trimmed summary, or nothing', () => {
  assert.equal(summaryLine(rule), FALLBACK_LINE)
  assert.equal(FALLBACK_LINE, 'Sorted by priority. AI unavailable.')
  assert.equal(summaryLine(ai), 'A calm day.')
  assert.equal(summaryLine({ ...ai, snapshot: { compose: { summary: '   ' } } }), null)
  assert.equal(summaryLine(shell), null)
  assert.equal(summaryLine({ ...ai, snapshot: null }), null)
  assert.equal(summaryLine(undefined), null)
})

test('legacyPriorities reads phase-1/2 free-text priorities from the snapshot', () => {
  const p = [{ title: 'Ship', source: 'General', reasoning: 'r' }]
  assert.deepEqual(legacyPriorities({ ...shell, snapshot: { priorities: p } }), p)
  assert.equal(legacyPriorities(shell), null)
  assert.equal(legacyPriorities({ ...shell, snapshot: { priorities: 'nope' } }), null)
})

test('itemsOf filters one kind, orders by position and caps at 3', () => {
  const rows = [item({ id: 'x3', position: 2 }), item({ id: 'q', kind: 'quick_help' }), item({ id: 'x1', position: 0 }), item({ id: 'x2', position: 1 }), item({ id: 'x4', position: 3 })]
  assert.deepEqual(itemsOf(rows, 'priority').map((i) => i.id), ['x1', 'x2', 'x3'])
  assert.deepEqual(itemsOf(rows, 'priority', 1).map((i) => i.id), ['x1'])
  assert.deepEqual(itemsOf(undefined, 'quick_self'), [])
})

test('done state, live vs frozen titles, strip titles', () => {
  assert.equal(isItemDone(item()), false)
  assert.equal(isItemDone(item({ task: { ...item().task, status: 'complete' } })), true)
  assert.equal(isItemDone(item({ task: null })), false)
  assert.equal(itemTitle(item(), true), 'Live title')
  assert.equal(itemTitle(item(), false), 'Frozen title')
  assert.equal(itemTitle(item({ task: null }), true), 'Frozen title')
  assert.deepEqual(stripTitles([item()], [{ title: 'Legacy' }]), [{ title: 'Live title' }])
  assert.deepEqual(stripTitles([], [{ title: 'Legacy' }]), [{ title: 'Legacy' }])
  assert.equal(stripTitles(undefined, undefined), undefined)
})

test('producedIds only reads a produced item and survives bad JSON', () => {
  assert.deepEqual(producedIds(item({ action_state: 'produced', produced_ref: '["s1","s2"]' })), ['s1', 's2'])
  assert.deepEqual(producedIds(item({ action_state: 'produced', produced_ref: '{oops' })), [])
  assert.deepEqual(producedIds(item({ action_state: 'none', produced_ref: '["s1"]' })), [])
})

test('briefItemFromRow decodes a Turso row with and without its task', () => {
  const row = {
    id: 'i', date: T, module_id: 'quick_wins', kind: 'quick_help', title: 'T', body: 'Why', task_id: 'a', origin: 'ai',
    dedupe_key: 'quick_help:a', action_kind: null, action_state: 'none', produced_ref: null, position: '2', created_at: 'n', updated_at: 'n',
    t_status: 'in_progress', t_completed: '0', t_due_date: null, t_content: 'Live', t_description: null, t_project_id: 'inbox',
  }
  const decoded = briefItemFromRow(row)
  assert.equal(decoded.position, 2)
  assert.deepEqual(decoded.task, { status: 'in_progress', completed: false, due_date: null, content: 'Live', description: null, project_id: 'inbox' })
  assert.equal(briefItemFromRow({ ...row, t_content: null, t_status: null, t_project_id: null }).task, null)
  assert.equal(briefItemFromRow({ ...row, t_completed: '1' }).task.completed, true)
})

test('composeView and summaryLine treat an AI success on a partial snapshot as AI', () => {
  const partial = { ...ai, status: 'partial' }
  assert.equal(composeView({ date: T, today: T, supported: true, settled: false, brief: partial }), 'ai')
  assert.equal(summaryLine(partial), 'A calm day.')
})

