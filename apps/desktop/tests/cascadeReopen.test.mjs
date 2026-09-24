import test from 'node:test'
import assert from 'node:assert/strict'
import { cascadeReopenCandidates, aggregateCascadeReopen, stampMs, CASCADE_WINDOW_MS } from '../src/lib/cascadeReopen.ts'

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

// Bulk reopen (review finding 1): one combined offer across every reopened
// parent, each judged against its own pre-reopen stamp.
const kid = (id, parent_id, completed_at, completed = true) => ({ ...sub(id, completed_at, completed), parent_id })
const A_AT = '2026-08-01 10:00:00'
const B_AT = '2026-08-01 11:30:00'
const after = [
  kid('a1', 'A', A_AT),
  kid('a2', 'A', '2026-08-01 10:00:01'),
  kid('aEarly', 'A', '2026-08-01 09:00:00'),
  kid('aOpen', 'A', null, false),
  kid('b1', 'B', B_AT),
  kid('bOnA', 'B', A_AT), // stamped at A's time, but B's window rules for B's kids
  kid('x1', 'X', A_AT), // X not reopened
]

test('two parents → one combined list, each against its own stamp', () => {
  assert.deepEqual(aggregateCascadeReopen([['A', A_AT], ['B', B_AT]], after), ['a1', 'a2', 'b1'])
})

test('a parent + an unrelated (never completed) task counts only the parent', () => {
  assert.deepEqual(aggregateCascadeReopen([['A', A_AT], ['T', null]], after), ['a1', 'a2'])
})

test('subtasks that are themselves in the reopen are excluded', () => {
  assert.deepEqual(aggregateCascadeReopen([['A', A_AT], ['a1', A_AT]], after), ['a2'])
})

test('N = 0 → empty: nothing complete, or no candidates', () => {
  assert.deepEqual(aggregateCascadeReopen([['T', null]], after), [])
  assert.deepEqual(aggregateCascadeReopen([], after), [])
  assert.deepEqual(aggregateCascadeReopen([['X', '2026-07-01 08:00:00']], after), [])
})

test('duplicates collapse (the same parent listed twice)', () => {
  assert.deepEqual(aggregateCascadeReopen([['B', B_AT], ['B', B_AT]], after), ['b1'])
})
