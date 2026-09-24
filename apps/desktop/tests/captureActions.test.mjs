import test from 'node:test'
import assert from 'node:assert/strict'
import { routeWithDate, convertWithDate, dueFields, routedToastMessage } from '../src/lib/captureActions.ts'
import { parseCaptureDate } from '../src/lib/captureDate.ts'

const ref = new Date(2026, 8, 23, 10, 0)
const TASK_ROUTE = { id: 'r-t', prefix: '/t', target_type: 'task', doc_id: null, label: 'Task', color: '#0f0', icon: 'CheckSquare', position: 2, created_at: '' }
const DOC_ROUTE = { ...TASK_ROUTE, id: 'r-i', prefix: '/i', target_type: 'doc', label: 'Ideas' }

function fakeDp({ updateThrows = false, routeTargetType = null } = {}) {
  const calls = []
  return {
    calls,
    captureRoutes: {
      route: async (prefix, content) => {
        calls.push(['route', prefix, content])
        const isTask = prefix === '/t'
        const target_type = routeTargetType ?? (isTask ? 'task' : 'doc')
        return { routed_to: isTask ? 'task-1' : 'doc-1', target_type, created_id: isTask ? 'task-1' : 'note-1', label: isTask ? 'Task' : 'Ideas' }
      },
    },
    captures: {
      convertToTask: async (id) => { calls.push(['convert', id]); return { id: 'task-9', content: 'call mom friday' } },
    },
    tasks: {
      update: async (opts) => { calls.push(['update', opts]); if (updateThrows) throw new Error('boom'); return { ...opts } },
    },
  }
}

test('dueFields omits dueTime when there is none', () => {
  assert.deepEqual(dueFields(parseCaptureDate('call mom friday', ref)), { dueDate: '2026-09-25' })
  assert.deepEqual(dueFields(parseCaptureDate('call mom fri at 3pm', ref)), { dueDate: '2026-09-25', dueTime: '15:00' })
})

test('a task route with a date routes the full text, then rewords and dates in one update', async () => {
  const dp = fakeDp()
  const date = parseCaptureDate('call mom fri at 3pm', ref)
  const out = await routeWithDate(dp, TASK_ROUTE, 'call mom fri at 3pm', date)
  assert.deepEqual(dp.calls, [
    ['route', '/t', 'call mom fri at 3pm'],
    ['update', { id: 'task-1', content: 'call mom', dueDate: '2026-09-25', dueTime: '15:00' }],
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

test('a task route whose live result disagrees (doc) never dates', async () => {
  const dp = fakeDp({ routeTargetType: 'doc' })
  const date = parseCaptureDate('call mom friday', ref)
  const out = await routeWithDate(dp, TASK_ROUTE, 'call mom friday', date)
  assert.deepEqual(dp.calls, [['route', '/t', 'call mom friday']])
  assert.equal(out.dateSet, false)
  assert.equal(out.dateFailed, false)
})

test('a failed date update keeps the task and its original words, and reports dateFailed', async () => {
  const dp = fakeDp({ updateThrows: true })
  const out = await routeWithDate(dp, TASK_ROUTE, 'call mom friday', parseCaptureDate('call mom friday', ref))
  assert.deepEqual(dp.calls[0], ['route', '/t', 'call mom friday'])
  assert.equal(dp.calls.filter((c) => c[0] === 'route').length, 1)
  assert.equal(out.dateSet, false)
  assert.equal(out.dateFailed, true)
  assert.equal(out.result.created_id, 'task-1')
})

test('convertWithDate dates the task, returns the dated task, and keepAsText restores the words', async () => {
  const dp = fakeDp()
  const capture = { id: 'cap-1', content: 'call mom friday' }
  const out = await convertWithDate(dp, capture, ref)
  assert.equal(out.date.dueDate, '2026-09-25')
  assert.equal(out.task.content, 'call mom')
  assert.deepEqual(dp.calls, [
    ['convert', 'cap-1'],
    ['update', { id: 'task-9', content: 'call mom', dueDate: '2026-09-25' }],
  ])
  await out.keepAsText()
  assert.deepEqual(dp.calls[2], ['update', { id: 'task-9', content: 'call mom friday', clearDueDate: true }])
})

test('convertWithDate keepAsText also clears the time when one was set', async () => {
  const dp = fakeDp()
  const capture = { id: 'cap-4', content: 'call mom fri at 3pm' }
  const out = await convertWithDate(dp, capture, ref)
  await out.keepAsText()
  assert.deepEqual(dp.calls[2], ['update', { id: 'task-9', content: 'call mom fri at 3pm', clearDueDate: true, clearDueTime: true }])
})

test('convertWithDate with no date words makes one call and offers no keep-as-text', async () => {
  const dp = fakeDp()
  const out = await convertWithDate(dp, { id: 'cap-2', content: 'read chapter 2' }, ref)
  assert.deepEqual(dp.calls, [['convert', 'cap-2']])
  assert.equal(out.date, null)
  assert.equal(out.keepAsText, null)
})

test('routedToastMessage: dated success', () => {
  const date = parseCaptureDate('call mom friday', ref)
  assert.deepEqual(routedToastMessage('Task', { dateSet: true, dateFailed: false }, date), {
    kind: 'success', text: 'Saved to Task · due Fri, Sep 25',
  })
})

test('routedToastMessage: dating failed', () => {
  assert.deepEqual(routedToastMessage('Task', { dateSet: false, dateFailed: true }, null), {
    kind: 'neutral', text: "Saved to Task. The date didn't stick. Set it on the task.",
  })
})

test('routedToastMessage: plain save, no date', () => {
  assert.deepEqual(routedToastMessage('Ideas', { dateSet: false, dateFailed: false }, null), {
    kind: 'success', text: 'Saved to Ideas',
  })
})

test('convertWithDate falls back to the plain conversion when dating fails', async () => {
  const dp = fakeDp({ updateThrows: true })
  const out = await convertWithDate(dp, { id: 'cap-3', content: 'call mom friday' }, ref)
  assert.equal(out.task.id, 'task-9')
  assert.equal(out.date, null)
  assert.equal(out.keepAsText, null)
})
