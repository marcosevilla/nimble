import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSections, flattenRows, defaultIndex, selectedIndex, moveSelection,
  optionId, OMNIBAR_LISTBOX_ID, isFetchedRow, freshRow,
} from '../src/lib/omnibarRows.ts'

const empty = { tasks: [], notes: [], docs: [], goals: [] }
const hit = (id) => ({ task: { id, content: id, status: 'todo' }, snippet: null, matched_in: 'title' })
const suggestion = { pill: { kind: 'status', value: 'open', name: 'open' }, start: 0, end: 4, exact: true }
const action = (id) => ({ id, label: id, keywords: [], hint: '?' })
const input = (over = {}) => ({
  suggestions: [], recent: [], results: empty, actions: [],
  groups: ['tasks', 'notes', 'docs', 'goals', 'actions'], expanded: new Set(), creates: [], ...over,
})

test('sections in display order; empty groups are skipped', () => {
  const s = buildSections(input({
    suggestions: [suggestion],
    recent: ['zeph'],
    results: { ...empty, tasks: [hit('t1')], goals: [{ id: 'g1', name: 'Run' }] },
    actions: [action('go-today')],
    creates: ['task', 'note'],
  }))
  assert.deepEqual(s.map((x) => x.key), ['filters', 'recent', 'tasks', 'goals', 'actions', 'create'])
  assert.deepEqual(s.map((x) => x.title), ['Filters', 'Recent', 'Tasks', 'Goals', 'Actions', 'Create'])
})

test('groups outside the plan never show, even with results', () => {
  const s = buildSections(input({ groups: ['tasks'], results: { ...empty, tasks: [hit('t1')], notes: [{ id: 'c1', content: 'x' }] } }))
  assert.deepEqual(s.map((x) => x.key), ['tasks'])
})

test('five rows, then "Show all N" pointing at the sixth; expanded shows all', () => {
  const tasks = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(hit)
  const [capped] = buildSections(input({ results: { ...empty, tasks } }))
  assert.deepEqual(capped.rows.map((r) => r.key), ['task:a', 'task:b', 'task:c', 'task:d', 'task:e', 'more:tasks'])
  assert.deepEqual(capped.rows[5], { kind: 'more', key: 'more:tasks', group: 'tasks', total: 7, next: 'task:f' })
  const [open] = buildSections(input({ results: { ...empty, tasks }, expanded: new Set(['tasks']) }))
  assert.equal(open.rows.length, 7)
})

test('doc keys tell native docs from vault notes', () => {
  const docs = [{ backend: 'native', doc: { id: 'd1', title: 'D' } }, { backend: 'vault', note: { id: 'v', path: 'a/b.md', title: 'B', snippet: '' } }]
  const [s] = buildSections(input({ results: { ...empty, docs } }))
  assert.deepEqual(s.rows.map((r) => r.key), ['doc:d1', 'vault:a/b.md'])
})

/** Default-row context: the typed text and the effective type (pill or /doc). */
const ctx = (text, type = null) => ({ text, type })

test('default highlight: first result, else first create row, never a filter', () => {
  const withResult = flattenRows(buildSections(input({ suggestions: [suggestion], results: { ...empty, tasks: [hit('t1')] }, creates: ['task'] })))
  assert.equal(withResult[defaultIndex(withResult, ctx('x'))].key, 'task:t1')
  const noResult = flattenRows(buildSections(input({ suggestions: [suggestion], creates: ['note', 'task'] })))
  assert.equal(noResult[defaultIndex(noResult, ctx('x'))].key, 'create:note')
  const emptyQuery = flattenRows(buildSections(input({ recent: ['zeph'], actions: [action('go-today')] })))
  assert.equal(emptyQuery[defaultIndex(emptyQuery, ctx(''))].key, 'recent:zeph')
  assert.equal(defaultIndex([], ctx('x')), -1)
})

test('a picked row keeps the highlight while it exists; otherwise the default', () => {
  const rows = flattenRows(buildSections(input({ results: { ...empty, tasks: [hit('a'), hit('b')] }, creates: ['task'] })))
  assert.equal(selectedIndex(rows, 'task:b', ctx('x')), 1)
  assert.equal(selectedIndex(rows, 'task:gone', ctx('x')), 0)
  assert.equal(selectedIndex(rows, null, ctx('x')), 0)
})

test('arrows move across groups and wrap', () => {
  const rows = flattenRows(buildSections(input({ results: { ...empty, tasks: [hit('a')] }, actions: [action('go-today')], creates: ['task'] })))
  assert.deepEqual(rows.map((r) => r.key), ['task:a', 'action:go-today', 'create:task'])
  assert.equal(moveSelection(rows, 0, 1), 'action:go-today')
  assert.equal(moveSelection(rows, 2, 1), 'task:a')
  assert.equal(moveSelection(rows, 0, -1), 'create:task')
  assert.equal(moveSelection([], -1, 1), null)
})

// ── Checkpoint-2 review follow-ups ──

test('option ids are index-based and always valid ids (vault paths hold "/" and spaces)', () => {
  assert.equal(optionId(0), 'omnibar-option-0')
  assert.equal(optionId(12), 'omnibar-option-12')
  assert.match(OMNIBAR_LISTBOX_ID, /^[a-z-]+$/)
})

test('isFetchedRow: only rows from a fetched source can go stale', () => {
  const rows = flattenRows(buildSections(input({
    suggestions: [suggestion],
    recent: ['zeph'],
    results: { tasks: ['a', 'b', 'c', 'd', 'e', 'f'].map(hit), notes: [{ id: 'c1', content: 'x' }], docs: [], goals: [{ id: 'g1', name: 'Run' }] },
    actions: [action('go-today')],
    creates: ['task'],
  })))
  const fetched = rows.filter(isFetchedRow).map((r) => r.key)
  assert.deepEqual(fetched, ['task:a', 'task:b', 'task:c', 'task:d', 'task:e', 'more:tasks', 'note:c1', 'goal:g1'])
})

test('freshRow: the same key if it survived, the default row for no key, nothing if it vanished', () => {
  const rows = flattenRows(buildSections(input({ results: { ...empty, tasks: [hit('a'), hit('b')] }, creates: ['task'] })))
  assert.equal(freshRow(rows, 'task:b', ctx('x'))?.key, 'task:b')
  assert.equal(freshRow(rows, null, ctx('x'))?.key, 'task:a')
  assert.equal(freshRow(rows, 'task:gone', ctx('x')), null)
  assert.equal(freshRow([], null, ctx('x')), null)
})

// ── Enter's default row: "Tasks or create" (Marco, 2026-09-25) ──

const everything = (over = {}) => flattenRows(buildSections(input({
  results: {
    tasks: [hit('t1')],
    notes: [{ id: 'c1', content: 'x' }],
    docs: [{ backend: 'native', doc: { id: 'd1', title: 'D' } }, { backend: 'vault', note: { id: 'v', path: 'a/b.md', title: 'B', snippet: '' } }],
    goals: [{ id: 'g1', name: 'Run' }],
  },
  actions: [action('refresh')],
  creates: ['task', 'note', 'doc', 'goal', 'project', 'label'],
  ...over,
})))
const keyAt = (rows, c) => { const i = defaultIndex(rows, c); return i < 0 ? null : rows[i].key }
const noTasks = (over = {}) => everything({ results: { ...empty, notes: [{ id: 'c1', content: 'x' }], docs: [{ backend: 'vault', note: { id: 'v', path: 'a/b.md', title: 'B', snippet: '' } }], goals: [{ id: 'g1', name: 'Run' }] }, ...over })

test('Tasks or create: the first task when Tasks has rows', () => {
  assert.equal(keyAt(everything(), ctx('portola')), 'task:t1')
})

test('Tasks or create: notes, docs, vault notes, goals and actions never take the default', () => {
  assert.equal(keyAt(noTasks(), ctx('portola')), 'create:task')
  // A single word that is an action keyword ("sync" → Refresh) creates, too (review minor 9).
  assert.equal(keyAt(noTasks(), ctx('sync')), 'create:task')
})

test('an action verb first creates a task even when tasks match; case-insensitive, first word only', () => {
  for (const verb of ['buy', 'call', 'email', 'Book', 'SCHEDULE']) {
    assert.equal(keyAt(everything(), ctx(`${verb} the dentist`)), 'create:task', verb)
  }
  assert.equal(keyAt(everything(), ctx('the dentist call')), 'task:t1')
  assert.equal(keyAt(everything(), ctx('buyer list')), 'task:t1', 'a whole word, not a prefix')
})

test('"note:", "idea:" and "remember" default to Create note', () => {
  for (const q of ['note: portola lens', 'Idea: shoot film', 'remember the tripod']) {
    assert.equal(keyAt(everything(), ctx(q)), 'create:note', q)
  }
})

test('a non-task type (pill or /doc) defaults to its first row, else its create row', () => {
  assert.equal(keyAt(everything(), ctx('portola', 'doc')), 'doc:d1')
  assert.equal(keyAt(everything(), ctx('portola', 'goal')), 'goal:g1')
  assert.equal(keyAt(everything(), ctx('portola', 'note')), 'note:c1')
  assert.equal(keyAt(everything(), ctx('sync', 'action')), 'action:refresh')
  const noDocs = everything({ results: { ...empty }, creates: ['doc', 'task', 'note'] })
  assert.equal(keyAt(noDocs, ctx('portola', 'doc')), 'create:doc')
  assert.equal(keyAt(everything(), ctx('portola', 'task')), 'task:t1', 'type:task is the normal rule')
})

test('empty query: the first recent search, else nothing — never an action (review minor 8)', () => {
  const recents = flattenRows(buildSections(input({ recent: ['zeph'], actions: [action('go-today')] })))
  assert.equal(keyAt(recents, ctx('')), 'recent:zeph')
  const bare = flattenRows(buildSections(input({ actions: [action('go-today')] })))
  assert.equal(keyAt(bare, ctx('')), null)
  // Pill-only query (no text): the listed tasks still take the default.
  const pillOnly = flattenRows(buildSections(input({ results: { ...empty, tasks: [hit('t1')] } })))
  assert.equal(keyAt(pillOnly, ctx('')), 'task:t1')
})
