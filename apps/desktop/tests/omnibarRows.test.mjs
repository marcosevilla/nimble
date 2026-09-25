import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSections, flattenRows, defaultIndex, selectedIndex, moveSelection } from '../src/lib/omnibarRows.ts'

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

test('default highlight: first result, else first create row, never a filter', () => {
  const withResult = flattenRows(buildSections(input({ suggestions: [suggestion], results: { ...empty, tasks: [hit('t1')] }, creates: ['task'] })))
  assert.equal(withResult[defaultIndex(withResult)].key, 'task:t1')
  const noResult = flattenRows(buildSections(input({ suggestions: [suggestion], creates: ['note', 'task'] })))
  assert.equal(noResult[defaultIndex(noResult)].key, 'create:note')
  const emptyQuery = flattenRows(buildSections(input({ recent: ['zeph'], actions: [action('go-today')] })))
  assert.equal(emptyQuery[defaultIndex(emptyQuery)].key, 'recent:zeph')
  assert.equal(defaultIndex([]), -1)
})

test('a picked row keeps the highlight while it exists; otherwise the default', () => {
  const rows = flattenRows(buildSections(input({ results: { ...empty, tasks: [hit('a'), hit('b')] }, creates: ['task'] })))
  assert.equal(selectedIndex(rows, 'task:b'), 1)
  assert.equal(selectedIndex(rows, 'task:gone'), 0)
  assert.equal(selectedIndex(rows, null), 0)
})

test('arrows move across groups and wrap', () => {
  const rows = flattenRows(buildSections(input({ results: { ...empty, tasks: [hit('a')] }, actions: [action('go-today')], creates: ['task'] })))
  assert.deepEqual(rows.map((r) => r.key), ['task:a', 'action:go-today', 'create:task'])
  assert.equal(moveSelection(rows, 0, 1), 'action:go-today')
  assert.equal(moveSelection(rows, 2, 1), 'task:a')
  assert.equal(moveSelection(rows, 0, -1), 'create:task')
  assert.equal(moveSelection([], -1, 1), null)
})
