// Shared list cache behind the task row's project picker (T1 review).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createListCache } from '../src/lib/listCache.ts'

function counter(lists) {
  let calls = 0
  const fetch = () => Promise.resolve(lists[Math.min(calls++, lists.length - 1)])
  return { fetch, calls: () => calls }
}

test('loads once and serves every later load from the cache', async () => {
  const f = counter([['a', 'b']])
  const cache = createListCache(f.fetch)
  assert.equal(cache.peek(), null)
  assert.deepEqual(await cache.load(), ['a', 'b'])
  assert.deepEqual(await cache.load(), ['a', 'b'])
  assert.equal(f.calls(), 1)
  assert.deepEqual(cache.peek(), ['a', 'b'])
})

test('concurrent loads share one request', async () => {
  const f = counter([['a']])
  const cache = createListCache(f.fetch)
  const [x, y] = await Promise.all([cache.load(), cache.load()])
  assert.deepEqual(x, ['a'])
  assert.deepEqual(y, ['a'])
  assert.equal(f.calls(), 1)
})

test('invalidate keeps the stale list visible and refetches on the next load', async () => {
  const f = counter([['a'], ['a', 'c']])
  const cache = createListCache(f.fetch)
  await cache.load()
  cache.invalidate()
  assert.deepEqual(cache.peek(), ['a'])
  assert.deepEqual(await cache.load(), ['a', 'c'])
  assert.equal(f.calls(), 2)
})

test('subscribers hear each new list until they unsubscribe', async () => {
  const f = counter([['a'], ['b']])
  const cache = createListCache(f.fetch)
  const heard = []
  const off = cache.subscribe((l) => heard.push(l))
  await cache.load()
  off()
  cache.invalidate()
  await cache.load()
  assert.deepEqual(heard, [['a']])
})

test('a failed load is not cached; the next load retries', async () => {
  let calls = 0
  const cache = createListCache(() => (calls++ === 0 ? Promise.reject(new Error('down')) : Promise.resolve(['a'])))
  await assert.rejects(cache.load())
  assert.deepEqual(await cache.load(), ['a'])
  assert.equal(calls, 2)
})

test('a load that started before an invalidate does not overwrite the fresh list', async () => {
  let resolveFirst
  let calls = 0
  const cache = createListCache(() => {
    calls++
    return calls === 1 ? new Promise((r) => { resolveFirst = r }) : Promise.resolve(['new'])
  })
  const first = cache.load()
  cache.invalidate()
  assert.deepEqual(await cache.load(), ['new'])
  resolveFirst(['old'])
  await first
  assert.deepEqual(cache.peek(), ['new'])
})
