import test from 'node:test'
import assert from 'node:assert/strict'
import { createKinds, taskCreateArgs, runCreate, createdMessage, CREATE_ORDER } from '../src/lib/omnibarCreate.ts'

const desktop = { docs: true, goals: true, createProject: true, createLabel: true, taskLabelsOnCreate: true }
const web = { docs: false, goals: false, createProject: false, createLabel: false, taskLabelsOnCreate: false }
const base = { text: 'go on a 4K run', mode: 'search', pills: [], capability: desktop, labelNames: ['design', 'Archived-Thing'] }
const type = (value) => [{ kind: 'type', value, name: value }]

test('every kind, Task first, whenever there is text', () => {
  assert.deepEqual(createKinds(base), ['task', 'note', 'doc', 'goal', 'project', 'label'])
  assert.deepEqual(createKinds({ ...base, text: '   ' }), [])
})

test('a type pill promotes its kind; action and status pills do not', () => {
  assert.deepEqual(createKinds({ ...base, pills: type('goal') }), ['goal', 'task', 'note', 'doc', 'project', 'label'])
  assert.equal(createKinds({ ...base, pills: type('action') })[0], 'task')
  assert.equal(createKinds({ ...base, pills: [{ kind: 'status', value: 'open', name: 'open' }] })[0], 'task')
})

test('prefix modes: /task and /note create one kind, /doc promotes Doc, routes create nothing here', () => {
  assert.deepEqual(createKinds({ ...base, mode: 'task' }), ['task'])
  assert.deepEqual(createKinds({ ...base, mode: 'capture' }), ['note'])
  assert.equal(createKinds({ ...base, mode: 'doc' })[0], 'doc')
  assert.deepEqual(createKinds({ ...base, mode: 'route' }), [])
})

test('web offers Task and Note only', () => {
  assert.deepEqual(createKinds({ ...base, capability: web }), ['task', 'note'])
  assert.deepEqual(createKinds({ ...base, capability: web, pills: type('doc') }), ['task', 'note'])
})

test('no Create label when that name exists, any case, archived included', () => {
  assert.ok(!createKinds({ ...base, text: 'Design' }).includes('label'))
  assert.ok(!createKinds({ ...base, text: 'archived-thing' }).includes('label'))
  assert.ok(createKinds({ ...base, text: 'designs' }).includes('label'))
})

test('task carry-over: label pills → labels, project pill → project, status ignored, date split out', () => {
  const pills = [
    { kind: 'label', value: 'l1', name: 'a' },
    { kind: 'label', value: 'l2', name: 'b' },
    { kind: 'project', value: 'p1', name: 'P' },
    { kind: 'status', value: 'open', name: 'open' },
  ]
  assert.deepEqual(taskCreateArgs(' go on a 4K run ', pills, null, desktop), { content: 'go on a 4K run', projectId: 'p1', labelIds: ['l1', 'l2'] })
  assert.deepEqual(
    taskCreateArgs('run tomorrow 9am', [], { title: 'run', dueDate: '2026-09-26', dueTime: '09:00' }, desktop),
    { content: 'run', dueDate: '2026-09-26', dueTime: '09:00' },
  )
  assert.deepEqual(taskCreateArgs('x', pills, null, web), { content: 'x', projectId: 'p1' })
})

function fakeDp(calls) {
  return {
    tasks: { create: async (o) => { calls.push(['task', o]); return { id: 't1', content: o.content } } },
    captures: { create: async (c, s) => { calls.push(['note', c, s]); return { id: 'c1', content: c } } },
    docs: { createDocument: async (t) => { calls.push(['doc', t]); return { id: 'd1', title: t } } },
    goals: { create: async (o) => { calls.push(['goal', o]); return { id: 'g1', name: o.name } } },
    projects: { create: async (n, c) => { calls.push(['project', n, c]); return { id: 'p9', name: n } } },
    labels: { create: async (n, c) => { calls.push(['label', n, c]); return { id: 'l9', name: n } } },
  }
}

test('runCreate calls the one matching creator; only a task takes the pills', async () => {
  const calls = []
  const dp = fakeDp(calls)
  const pills = [{ kind: 'label', value: 'l1', name: 'a' }, { kind: 'project', value: 'p1', name: 'P' }]
  const created = []
  for (const kind of CREATE_ORDER) created.push(await runCreate(dp, kind, ' Portola ', pills, null, desktop))
  assert.deepEqual(calls, [
    ['task', { content: 'Portola', projectId: 'p1', labelIds: ['l1'] }],
    ['note', 'Portola', 'command_bar'],
    ['doc', 'Portola'],
    ['goal', { name: 'Portola' }],
    ['project', 'Portola', '#6366f1'],
    ['label', 'Portola', 'gray'],
  ])
  assert.deepEqual(created.map((c) => `${c.kind}:${c.id}`), ['task:t1', 'note:c1', 'doc:d1', 'goal:g1', 'project:p9', 'label:l9'])
})

test('createdMessage: tasks keep the due label; notes are "saved"', () => {
  assert.equal(createdMessage({ kind: 'task', id: 't', name: 'run' }, 'Tomorrow'), 'Task created: "run" · due Tomorrow')
  assert.equal(createdMessage({ kind: 'task', id: 't', name: 'run' }, null), 'Task created: "run"')
  assert.equal(createdMessage({ kind: 'note', id: 'c', name: 'idea' }, null), 'Note saved: "idea"')
  assert.equal(createdMessage({ kind: 'goal', id: 'g', name: 'Run' }, null), 'Goal created: "Run"')
})
