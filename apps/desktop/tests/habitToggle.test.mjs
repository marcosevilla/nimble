import test from 'node:test'
import assert from 'node:assert/strict'
import { flipHabit, toggleHabitOptimistically } from '../src/lib/habitToggle.ts'

const habits = () => [
  { id: 'a', name: 'Gym', today_completed: false, current_momentum: 40 },
  { id: 'b', name: 'Read', today_completed: true, current_momentum: 80 },
]

test('flipHabit inverts today_completed for one id and leaves the rest alone', () => {
  const next = flipHabit(habits(), 'a')
  assert.equal(next[0].today_completed, true)
  assert.equal(next[1].today_completed, true)
  assert.notEqual(next, habits())
})

test('optimistic toggle writes the flip before the call resolves and keeps it on success', async () => {
  const writes = []
  let resolveCall
  const call = () => new Promise((r) => { resolveCall = r })
  const p = toggleHabitOptimistically({
    habits: habits(), id: 'a',
    write: (h) => writes.push(h.map((x) => x.today_completed)),
    log: call, unlog: call,
  })
  assert.deepEqual(writes, [[true, true]], 'flip applied synchronously')
  resolveCall()
  await p
  assert.deepEqual(writes, [[true, true]], 'no rollback on success')
})

test('optimistic toggle rolls back and rethrows when the call fails', async () => {
  const writes = []
  const fail = () => Promise.reject(new Error('db down'))
  await assert.rejects(
    toggleHabitOptimistically({
      habits: habits(), id: 'b',
      write: (h) => writes.push(h.map((x) => x.today_completed)),
      log: fail, unlog: fail,
    }),
    /db down/,
  )
  assert.deepEqual(writes, [[false, false], [false, true]], 'flip then rollback to the original')
})

test('a completed habit calls unlog, an open one calls log', async () => {
  const calls = []
  const opts = { write: () => {}, log: async (id) => calls.push(['log', id]), unlog: async (id) => calls.push(['unlog', id]) }
  await toggleHabitOptimistically({ habits: habits(), id: 'a', ...opts })
  await toggleHabitOptimistically({ habits: habits(), id: 'b', ...opts })
  assert.deepEqual(calls, [['log', 'a'], ['unlog', 'b']])
})
