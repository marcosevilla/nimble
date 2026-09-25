import test from 'node:test'
import assert from 'node:assert/strict'
import { breakDownItem, undoBreakDown, copyItemForClaude, breakDownMessage, subtasksAddedLabel, COPIED_MESSAGE } from '../src/lib/quickWinActions.ts'

const item = (o = {}) => ({
  id: '2026-09-25:quick_help:t1', date: '2026-09-25', module_id: 'quick_wins', kind: 'quick_help', title: 'Outline the reply',
  body: 'Claude can draft it.', task_id: 't1', origin: 'ai', dedupe_key: 'quick_help:t1', action_kind: null, action_state: 'none',
  produced_ref: null, position: 0, created_at: 'n', updated_at: 'n',
  task: { status: 'todo', completed: false, due_date: null, content: 'Outline the reply', description: 'For the Oct 1 post', project_id: 'p1' },
  ...o,
})

function recorder() {
  const calls = []
  let n = 0
  return {
    calls,
    deps: {
      breakDown: async (content, description) => { calls.push(['breakDown', content, description]); return ['Draft intro', ' ', 'List three examples', 'Trim to 150 words'] },
      createSubtask: async (opts) => { calls.push(['create', opts]); n += 1; if (opts.content === 'List three examples' && n === 2) throw new Error('db busy'); return { id: `s${n}` } },
      deleteTask: async (id) => { calls.push(['delete', id]); if (id === 'bad') throw new Error('gone') },
      setItemState: async (...args) => { calls.push(['state', ...args]); return {} },
    },
  }
}

test('Break it down creates subtasks under the task and marks the item produced', async () => {
  const r = recorder()
  const created = await breakDownItem(r.deps, item())
  assert.deepEqual(created, ['s1', 's3'], 'blank titles are skipped, a failed create is skipped')
  assert.deepEqual(r.calls[0], ['breakDown', 'Outline the reply', 'For the Oct 1 post'])
  assert.deepEqual(r.calls.filter((c) => c[0] === 'create').map((c) => c[1]), [
    { content: 'Draft intro', parentId: 't1', projectId: 'p1' },
    { content: 'List three examples', parentId: 't1', projectId: 'p1' },
    { content: 'Trim to 150 words', parentId: 't1', projectId: 'p1' },
  ])
  assert.deepEqual(r.calls.at(-1), ['state', item().id, 'produced', 'break_down', '["s1","s3"]'])
  assert.equal(breakDownMessage(2), 'Added 2 subtasks')
  assert.equal(breakDownMessage(1), 'Added 1 subtask')
  assert.equal(subtasksAddedLabel(4), '4 subtasks added')
  assert.equal(subtasksAddedLabel(1), '1 subtask added')
})

test('Break it down on a deleted task, or with nothing created, changes nothing', async () => {
  const r = recorder()
  await assert.rejects(breakDownItem(r.deps, item({ task: null })), /no longer available/)
  const none = { ...r.deps, breakDown: async () => [] }
  assert.deepEqual(await breakDownItem(none, item()), [])
  assert.equal(r.calls.filter((c) => c[0] === 'state').length, 0)
})

test('Undo deletes exactly the created subtasks and resets the item', async () => {
  const r = recorder()
  const failed = await undoBreakDown(r.deps, item().id, ['s1', 'bad', 's3'])
  assert.equal(failed, 1)
  assert.deepEqual(r.calls.filter((c) => c[0] === 'delete').map((c) => c[1]), ['s1', 'bad', 's3'])
  assert.deepEqual(r.calls.at(-1), ['state', item().id, 'none', null, null])
})

test('Copy for Claude builds the focus prompt for that task and copies it', async () => {
  const copied = []
  const task = (id, o = {}) => ({ id, content: `Task ${id}`, parent_id: null, project_id: 'p1', priority: 3, due_date: null, due_time: null,
    description: null, completed: false, status: 'todo', position: 0, external_id: null, external_source: null, sync_policy: 'default', ...o })
  const deps = {
    listTasks: async () => [task('t1', { content: 'Outline the reply' }), task('c1', { parent_id: 't1', content: 'Draft intro' }), task('x')],
    listProjects: async () => [{ id: 'p1', name: 'Job hunt' }],
    focusSnapshot: async () => ({ queue: [], session: null, totals: {}, as_of: '2026-09-25T09:00:00Z' }),
    focusCapabilities: async () => null,
    write: async (text) => { copied.push(text) },
  }
  const result = await copyItemForClaude(deps, 't1')
  assert.deepEqual(result, { ok: true })
  assert.match(copied[0], /^Help me with this task from Nimble Focus\./)
  assert.match(copied[0], /\*\*Task:\*\* Outline the reply/)
  assert.match(copied[0], /\*\*Project:\*\* Job hunt \(p1\)/)
  assert.match(copied[0], /- \[ \] Draft intro \(c1\)/)
  assert.equal(COPIED_MESSAGE, 'Copied. Paste into Claude Code.')
  assert.deepEqual(await copyItemForClaude(deps, 'gone'), { ok: false, text: '', message: 'This task is no longer available.' })
  const noClipboard = await copyItemForClaude({ ...deps, write: undefined }, 't1')
  assert.equal(noClipboard.ok, false)
})
