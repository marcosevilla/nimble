import test from 'node:test'
import assert from 'node:assert/strict'
import { flipHabit, toggleHabitOptimistically, habitProgress } from '../src/lib/habitToggle.ts'

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

test('rollback restores only the failed habit, keeping a concurrent flip of another', async () => {
  let state = habits()
  const read = () => state
  const write = (h) => { state = h }
  let failFirst
  const first = toggleHabitOptimistically({
    habits: read(), id: 'a', read, write,
    log: () => new Promise((_, reject) => { failFirst = reject }), unlog: async () => {},
  })
  await toggleHabitOptimistically({ habits: read(), id: 'b', read, write, log: async () => {}, unlog: async () => {} })
  failFirst(new Error('db down'))
  await assert.rejects(first, /db down/)
  assert.deepEqual(state.map((h) => h.today_completed), [false, false], 'a rolled back, b stays flipped')
})

// ── Reload ordering (review minor 1) ──
import { createHabitLoadGate } from '../src/lib/habitToggle.ts'

test('a reload that started before a newer toggle is dropped', () => {
  const gate = createHabitLoadGate()
  const load = gate.beginLoad()
  const done = gate.beginToggle()
  done()
  assert.equal(gate.canApply(load), false)
})

test('no reload applies while any toggle is still in flight', () => {
  const gate = createHabitLoadGate()
  const doneA = gate.beginToggle()
  const doneB = gate.beginToggle()
  doneB()
  const reloadAfterB = gate.beginLoad()
  assert.equal(gate.canApply(reloadAfterB), false, 'A still pending — B\'s reload would erase A\'s optimistic flip')
  doneA()
  const reloadAfterA = gate.beginLoad()
  assert.equal(gate.canApply(reloadAfterA), true)
})

test('only the latest reload applies', () => {
  const gate = createHabitLoadGate()
  const first = gate.beginLoad()
  const second = gate.beginLoad()
  assert.equal(gate.canApply(first), false)
  assert.equal(gate.canApply(second), true)
})

test('habitProgress counts only active habits', () => {
  assert.deepEqual(
    habitProgress([
      { active: true, today_completed: true },
      { active: true, today_completed: false },
      { active: false, today_completed: true },
    ]),
    { done: 1, total: 2 },
  )
  assert.deepEqual(habitProgress([]), { done: 0, total: 0 })
})
