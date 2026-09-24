import test from 'node:test'
import assert from 'node:assert/strict'
import { cascadeReopenCandidates, stampMs, CASCADE_WINDOW_MS } from '../src/lib/cascadeReopen.ts'

// Agentation pass 3, C3: after a parent reopen, offer to reopen exactly the
// subtasks its completion cascade closed — still complete, stamped in
// [parent, parent + 2 s] (Rust stamps parent then children in two statements).

const PARENT_AT = '2026-07-31 18:00:00'
const sub = (id, completed_at, completed = true) => ({
  id,
  completed,
  status: completed ? 'complete' : 'todo',
  completed_at,
})

test('same-second subtasks are the cascade', () => {
  assert.deepEqual(
    cascadeReopenCandidates(PARENT_AT, [sub('a', PARENT_AT), sub('b', PARENT_AT)]),
    ['a', 'b'],
  )
})

test('a second boundary between the two statements still counts (+1 s, +2 s)', () => {
  assert.deepEqual(
    cascadeReopenCandidates(PARENT_AT, [sub('a', '2026-07-31 18:00:01'), sub('b', '2026-07-31 18:00:02')]),
    ['a', 'b'],
  )
})

test('the window edge: +2 s is in, +3 s is out', () => {
  assert.equal(CASCADE_WINDOW_MS, 2000)
  assert.deepEqual(cascadeReopenCandidates(PARENT_AT, [sub('in', '2026-07-31 18:00:02')]), ['in'])
  assert.deepEqual(cascadeReopenCandidates(PARENT_AT, [sub('out', '2026-07-31 18:00:03')]), [])
})

test('a subtask completed earlier is excluded, even one second earlier', () => {
  assert.deepEqual(
    cascadeReopenCandidates(PARENT_AT, [
      sub('earlier', '2026-07-30 12:00:00'),
      sub('justBefore', '2026-07-31 17:59:59'),
      sub('cascade', PARENT_AT),
    ]),
    ['cascade'],
  )
})

test('open subtasks are never offered', () => {
  assert.deepEqual(cascadeReopenCandidates(PARENT_AT, [sub('open', null, false)]), [])
  // A stale stamp on an open row (defensive) doesn't count either.
  assert.deepEqual(cascadeReopenCandidates(PARENT_AT, [sub('open', PARENT_AT, false)]), [])
})

test('N = 0 → empty: no subtasks, no match, or no parent stamp', () => {
  assert.deepEqual(cascadeReopenCandidates(PARENT_AT, []), [])
  assert.deepEqual(cascadeReopenCandidates(PARENT_AT, [sub('x', '2026-07-01 09:00:00')]), [])
  assert.deepEqual(cascadeReopenCandidates(null, [sub('a', PARENT_AT)]), [])
  assert.deepEqual(cascadeReopenCandidates('garbage', [sub('a', PARENT_AT)]), [])
})

test('status alone marks a subtask complete (completed flag lagging)', () => {
  assert.deepEqual(
    cascadeReopenCandidates(PARENT_AT, [{ id: 's', completed: false, status: 'complete', completed_at: PARENT_AT }]),
    ['s'],
  )
})

test('Rust local stamps and ISO stamps parse to the same instant', () => {
  assert.equal(stampMs('2026-07-31 18:00:00'), stampMs('2026-07-31T18:00:00'))
  assert.ok(Number.isNaN(stampMs(null)))
  const z = '2026-07-31T18:00:00.000Z'
  assert.deepEqual(cascadeReopenCandidates(z, [sub('a', '2026-07-31T18:00:01.500Z')]), ['a'])
})
