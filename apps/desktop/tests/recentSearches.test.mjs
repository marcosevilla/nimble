import test from 'node:test'
import assert from 'node:assert/strict'
import { loadRecent, pushRecent, RECENT_KEY, RECENT_MAX } from '../src/lib/recentSearches.ts'

function memory(initial = {}) {
  const data = { ...initial }
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) } }
}

test('newest first, case-insensitive dedupe, capped at 8, blanks ignored', () => {
  const s = memory()
  for (let i = 0; i < 10; i++) pushRecent(s, `q${i}`)
  assert.equal(loadRecent(s).length, RECENT_MAX)
  assert.equal(loadRecent(s)[0], 'q9')
  pushRecent(s, 'Q5')
  assert.deepEqual(loadRecent(s).slice(0, 2), ['Q5', 'q9'])
  assert.equal(loadRecent(s).filter((q) => q.toLowerCase() === 'q5').length, 1)
  assert.deepEqual(pushRecent(s, '   '), loadRecent(s))
})

test('storage that throws or holds junk never breaks search', () => {
  const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.deepEqual(loadRecent(throwing), [])
  assert.deepEqual(pushRecent(throwing, 'portfolio'), ['portfolio'])
  assert.deepEqual(loadRecent(null), [])
  assert.deepEqual(loadRecent(memory({ [RECENT_KEY]: '{not json' })), [])
  assert.deepEqual(loadRecent(memory({ [RECENT_KEY]: JSON.stringify(['ok', 3, null]) })), ['ok'])
})
