import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCalendarDay } from '../src/lib/calendarLoad.ts'

function source({ cached = [], fresh = [], fail = false } = {}) {
  const calls = []
  return {
    calls,
    getCachedEvents: async (date) => { calls.push(['cached', date]); return cached },
    fetchEvents: async (date) => {
      calls.push(['fetch', date])
      if (fail) throw new Error('offline')
      return fresh
    },
  }
}

test('shows cached events at once, then revalidates from the feed', async () => {
  const src = source({ cached: ['old'], fresh: ['new'] })
  const shown = []
  await loadCalendarDay(src, '2026-09-23', false, (e) => shown.push(e))
  assert.deepEqual(shown, [['old'], ['new']])
  assert.deepEqual(src.calls, [['cached', '2026-09-23'], ['fetch', '2026-09-23']])
})

test('an empty cache goes straight to the feed', async () => {
  const src = source({ cached: [], fresh: ['new'] })
  const shown = []
  await loadCalendarDay(src, '2026-09-23', false, (e) => shown.push(e))
  assert.deepEqual(shown, [['new']])
})

test('force refresh skips the cache', async () => {
  const src = source({ cached: ['old'], fresh: ['new'] })
  const shown = []
  await loadCalendarDay(src, '2026-09-23', true, (e) => shown.push(e))
  assert.deepEqual(shown, [['new']])
  assert.deepEqual(src.calls, [['fetch', '2026-09-23']])
})

test('a failed revalidation keeps the cached events instead of erroring', async () => {
  const src = source({ cached: ['old'], fail: true })
  const shown = []
  await loadCalendarDay(src, '2026-09-23', false, (e) => shown.push(e))
  assert.deepEqual(shown, [['old']])
})

test('a failed fetch with nothing cached surfaces the error', async () => {
  const src = source({ cached: [], fail: true })
  await assert.rejects(loadCalendarDay(src, '2026-09-23', false, () => {}), /offline/)
})
