import test from 'node:test'
import assert from 'node:assert/strict'
import { planSearch, needsFetch, runSearch, browseTasks, matchesAllLabels, capGroup, GROUP_LIMIT } from '../src/lib/omnibarSearch.ts'
import { createLatestGuard } from '../src/lib/taskSearch.ts'

const desktop = { docs: true, goals: true, createProject: true, createLabel: true, taskLabelsOnCreate: true }
const web = { docs: false, goals: false, createProject: false, createLabel: false, taskLabelsOnCreate: false }
const task = (id, status = 'todo', extra = {}) => ({ id, status, content: id, labels: [], project_id: 'inbox', ...extra })
const hit = (t) => ({ task: t, snippet: null, matched_in: 'title' })
const plan = (text, pills = [], mode = 'search', capability = desktop) => planSearch({ text, pills, mode, capability })
const label = (value) => ({ kind: 'label', value, name: value })

function sources(overrides = {}) {
  const calls = []
  const src = {
    searchTasks: async (q, f) => { calls.push(['tasks', q, f]); return [] },
    listTasks: async (inc) => { calls.push(['list', inc]); return [] },
    searchNotes: async (q) => { calls.push(['notes', q]); return [] },
    searchDocs: async (q) => { calls.push(['docs', q]); return [] },
    searchVault: async (q) => { calls.push(['vault', q]); return [] },
    searchGoals: async (q) => { calls.push(['goals', q]); return [] },
    ...overrides,
  }
  return { src, calls }
}

test('plan: every group by default, in order; web drops Docs and Goals', () => {
  assert.deepEqual(plan('x').groups, ['tasks', 'notes', 'docs', 'goals', 'actions'])
  assert.deepEqual(plan('x', [], 'search', web).groups, ['tasks', 'notes', 'actions'])
})

test('plan: a type pill shows only its group; task filters hide every other group', () => {
  assert.deepEqual(plan('x', [{ kind: 'type', value: 'doc', name: 'doc' }]).groups, ['docs'])
  assert.deepEqual(plan('x', [{ kind: 'type', value: 'action', name: 'action' }]).groups, ['actions'])
  assert.deepEqual(plan('x', [label('l')]).groups, ['tasks'])
  assert.deepEqual(plan('x', [{ kind: 'type', value: 'goal', name: 'goal' }, { kind: 'status', value: 'open', name: 'open' }]).groups, [])
})

test('plan: /task, /note and routes search nothing; /doc searches Docs only', () => {
  for (const mode of ['task', 'capture', 'route', 'breakdown']) assert.deepEqual(plan('x', [], mode).groups, [], mode)
  assert.deepEqual(plan('x', [], 'doc').groups, ['docs'])
  assert.equal(plan('  x  ').text, 'x')
})

test('needsFetch: text, or a task filter with no text; never for actions alone', () => {
  assert.equal(needsFetch(plan('')), false)
  assert.equal(needsFetch(plan('', [label('l')])), true)
  assert.equal(needsFetch(plan('x', [{ kind: 'type', value: 'action', name: 'action' }])), false)
  assert.equal(needsFetch(plan('x')), true)
})

test('runSearch: one request per source; the task filter carries the pills; native docs before vault', async () => {
  // Overrides replace the recording stubs, so they record their own calls.
  const s = sources({
    searchDocs: async (q) => { s.calls.push(['docs', q]); return [{ id: 'd1', title: 'Doc' }] },
    searchVault: async (q) => { s.calls.push(['vault', q]); return [{ id: 'v1', path: 'a.md', title: 'A', snippet: '' }] },
  })
  const { src, calls } = s
  const r = await runSearch(plan(' portola '), src, () => {})
  assert.deepEqual(calls.map((c) => c[0]).sort(), ['docs', 'goals', 'notes', 'tasks', 'vault'])
  assert.deepEqual(calls.find((c) => c[0] === 'tasks'), ['tasks', 'portola', { status: 'all', label_ids: [], project_id: null }])
  assert.deepEqual(r.docs.map((d) => d.backend), ['native', 'vault'])
})

test('runSearch isolates a failing source: its group is empty, the rest arrive, the failure is logged', async () => {
  const { src } = sources({
    searchNotes: async () => [{ id: 'c1', content: 'portola' }],
    searchVault: async () => { throw new Error('vault not configured') },
    searchGoals: () => { throw new Error('sync throw') },
  })
  const logged = []
  const r = await runSearch(plan('portola'), src, (s) => logged.push(s))
  assert.deepEqual(r.notes.map((n) => n.id), ['c1'])
  assert.deepEqual(r.docs, [])
  assert.deepEqual(r.goals, [])
  assert.deepEqual(logged.sort(), ['goals', 'vault'])
})

test('label pills AND together (the backend filter is any-of)', async () => {
  const { src } = sources({
    searchTasks: async () => [hit(task('both', 'todo', { labels: ['a', 'b'] })), hit(task('one', 'todo', { labels: ['a'] }))],
  })
  const r = await runSearch(plan('x', [label('a'), label('b')]), src, () => {})
  assert.deepEqual(r.tasks.map((h) => h.task.id), ['both'])
  assert.equal(matchesAllLabels(task('none'), []), true)
})

test('a pill-only query lists matching tasks, open first (the whole query became a pill)', async () => {
  const all = [
    task('done-photo', 'complete', { labels: ['photo'] }),
    task('open-photo', 'todo', { labels: ['photo'] }),
    task('open-other'),
  ]
  const first = sources({ listTasks: async (inc) => { first.calls.push(['list', inc]); return all } })
  const r = await runSearch(plan('', [label('photo')]), first.src, () => {})
  assert.deepEqual(r.tasks.map((h) => h.task.id), ['open-photo', 'done-photo'])
  assert.deepEqual(first.calls, [['list', true]])

  const second = sources({ listTasks: async (inc) => { second.calls.push(['list', inc]); return all } })
  const open = await runSearch(plan('', [label('photo'), { kind: 'status', value: 'open', name: 'open' }]), second.src, () => {})
  assert.deepEqual(open.tasks.map((h) => h.task.id), ['open-photo'])
  assert.deepEqual(second.calls, [['list', false]], 'completed tasks are not even loaded')
  assert.deepEqual(browseTasks(all, { status: 'completed', labelIds: [], projectId: null, type: null }).map((h) => h.task.id), ['done-photo'])
})

test('stale guard: an older, slower search never lands after a newer one', async () => {
  const guard = createLatestGuard()
  let releaseSlow
  const slow = sources({ searchTasks: () => new Promise((resolve) => { releaseSlow = () => resolve([hit(task('old'))]) }) }).src
  const fast = sources({ searchTasks: async () => [hit(task('new'))] }).src
  const shown = []
  const deliver = (id) => (r) => { if (guard.isLatest(id)) shown.push(r.tasks.map((h) => h.task.id)) }
  const a = guard.next()
  const pending = runSearch(plan('por'), slow, () => {}).then(deliver(a))
  const b = guard.next()
  await runSearch(plan('portola'), fast, () => {}).then(deliver(b))
  releaseSlow()
  await pending
  assert.deepEqual(shown, [['new']])
})

test('capGroup: five rows, then "Show all N"; expanded shows everything', () => {
  const items = [1, 2, 3, 4, 5, 6, 7]
  assert.deepEqual(capGroup(items, false), { shown: [1, 2, 3, 4, 5], more: 7 })
  assert.deepEqual(capGroup(items, true), { shown: items, more: 0 })
  assert.deepEqual(capGroup([1, 2, 3, 4, 5], false), { shown: [1, 2, 3, 4, 5], more: 0 })
  assert.equal(GROUP_LIMIT, 5)
})
