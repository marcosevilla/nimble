import test from 'node:test'
import assert from 'node:assert/strict'
import { routeWithDate, convertWithDate, dueFields } from '../src/lib/captureActions.ts'
import { parseCaptureDate } from '../src/lib/captureDate.ts'

const ref = new Date(2026, 8, 23, 10, 0)
const TASK_ROUTE = { id: 'r-t', prefix: '/t', target_type: 'task', doc_id: null, label: 'Task', color: '#0f0', icon: 'CheckSquare', position: 2, created_at: '' }
const DOC_ROUTE = { ...TASK_ROUTE, id: 'r-i', prefix: '/i', target_type: 'doc', label: 'Ideas' }

function fakeDp({ updateThrows = false } = {}) {
  const calls = []
  return {
    calls,
    captureRoutes: {
      route: async (prefix, content) => {
        calls.push(['route', prefix, content])
        const isTask = prefix === '/t'
        return { routed_to: isTask ? 'task-1' : 'doc-1', target_type: isTask ? 'task' : 'doc', created_id: isTask ? 'task-1' : 'note-1', label: isTask ? 'Task' : 'Ideas' }
      },
    },
    captures: {
      convertToTask: async (id) => { calls.push(['convert', id]); return { id: 'task-9', content: 'call mom friday' } },
    },
    tasks: {
      update: async (opts) => { calls.push(['update', opts]); if (updateThrows) throw new Error('boom'); return { id: opts.id } },
    },
  }
}

test('dueFields omits dueTime when there is none', () => {
  assert.deepEqual(dueFields(parseCaptureDate('call mom friday', ref)), { dueDate: '2026-09-25' })
  assert.deepEqual(dueFields(parseCaptureDate('call mom fri at 3pm', ref)), { dueDate: '2026-09-25', dueTime: '15:00' })
})

test('a task route with a date routes the stripped title, then sets the date', async () => {
  const dp = fakeDp()
  const date = parseCaptureDate('call mom fri at 3pm', ref)
  const out = await routeWithDate(dp, TASK_ROUTE, 'call mom fri at 3pm', date)
  assert.deepEqual(dp.calls, [
    ['route', '/t', 'call mom'],
    ['update', { id: 'task-1', dueDate: '2026-09-25', dueTime: '15:00' }],
  ])
  assert.equal(out.dateSet, true)
  assert.equal(out.dateFailed, false)
})

test('a task route without a date routes the content as-is, no update', async () => {
  const dp = fakeDp()
  const out = await routeWithDate(dp, TASK_ROUTE, 'read chapter 2', null)
  assert.deepEqual(dp.calls, [['route', '/t', 'read chapter 2']])
  assert.equal(out.dateSet, false)
})

test('a doc route never dates and keeps every word', async () => {
  const dp = fakeDp()
  const date = parseCaptureDate('idea for friday', ref)
  await routeWithDate(dp, DOC_ROUTE, 'idea for friday', date)
  assert.deepEqual(dp.calls, [['route', '/i', 'idea for friday']])
})

test('a failed date update keeps the task and reports dateFailed', async () => {
  const dp = fakeDp({ updateThrows: true })
  const out = await routeWithDate(dp, TASK_ROUTE, 'call mom friday', parseCaptureDate('call mom friday', ref))
  assert.equal(dp.calls.filter((c) => c[0] === 'route').length, 1)
  assert.equal(out.dateSet, false)
  assert.equal(out.dateFailed, true)
  assert.equal(out.result.created_id, 'task-1')
})

test('convertWithDate dates the task and keepAsText restores the words', async () => {
  const dp = fakeDp()
  const capture = { id: 'cap-1', content: 'call mom friday' }
  const out = await convertWithDate(dp, capture, ref)
  assert.equal(out.date.dueDate, '2026-09-25')
  assert.deepEqual(dp.calls, [
    ['convert', 'cap-1'],
    ['update', { id: 'task-9', content: 'call mom', dueDate: '2026-09-25' }],
  ])
  await out.keepAsText()
  assert.deepEqual(dp.calls[2], ['update', { id: 'task-9', content: 'call mom friday', clearDueDate: true, clearDueTime: true }])
})

test('convertWithDate with no date words makes one call and offers no keep-as-text', async () => {
  const dp = fakeDp()
  const out = await convertWithDate(dp, { id: 'cap-2', content: 'read chapter 2' }, ref)
  assert.deepEqual(dp.calls, [['convert', 'cap-2']])
  assert.equal(out.date, null)
  assert.equal(out.keepAsText, null)
})

test('convertWithDate falls back to the plain conversion when dating fails', async () => {
  const dp = fakeDp({ updateThrows: true })
  const out = await convertWithDate(dp, { id: 'cap-3', content: 'call mom friday' }, ref)
  assert.equal(out.task.id, 'task-9')
  assert.equal(out.date, null)
  assert.equal(out.keepAsText, null)
})
