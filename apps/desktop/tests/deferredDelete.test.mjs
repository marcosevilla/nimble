/*
 * T4 — deferred-commit delete with Undo (loop 2, chunk 3). RED until built.
 *
 * Contract for the builder — src/lib/deferredDelete.ts
 * (plain TS, no JSX, no `@/` imports; siblings imported with `.ts`, e.g.
 *  `import { createUndoable, type Undoable } from './undoable.ts'`)
 *
 *   export const DEFERRED_DELETE_MS = 5_000
 *
 *   export interface DeferredDeletes {
 *     schedule(key: string, h: { onCommit: () => void; onUndo: () => void }): Undoable
 *     undo(key: string): boolean      // true if this call settled `key` (ran onUndo)
 *     commit(key: string): boolean    // true if this call settled `key` (ran onCommit)
 *     isPending(key: string): boolean // scheduled and not yet settled
 *     pendingKeys(): string[]         // in schedule order
 *     flushAll(): number              // commit every pending item; returns how many
 *   }
 *   export function createDeferredDeletes(): DeferredDeletes
 *
 * Behaviour:
 *   - schedule() never runs a handler by itself. Each key settles exactly
 *     once (built on createUndoable): undo → onUndo once, commit → onCommit
 *     once; whichever comes first wins, the other becomes a no-op (false).
 *   - The returned handle is an Undoable for that key; handle.commit()/undo()
 *     and the queue's commit(key)/undo(key) are the same settle-once action.
 *   - Settled keys leave the queue (isPending false, gone from pendingKeys).
 *   - Items are independent: settling one never settles, reorders or
 *     re-times another (two pending deletes → each commits once).
 *   - schedule() on a key that is already pending does NOT register a second
 *     delete: it returns the existing handle and ignores the new handlers.
 *     After a key has settled it may be scheduled again (fresh handle).
 *   - commit/undo on an unknown or settled key return false and run nothing.
 *   - flushAll() commits every pending item exactly once (used on unmount /
 *     navigation); a toast closing afterwards (commit(key)) is a no-op.
 *
 * UI wiring expected (see ReminderCatchUp.tsx): toast(`<Thing> deleted`,
 * { duration: DEFERRED_DELETE_MS, onAutoClose/onDismiss → commit(key),
 *   action: { label: 'Undo', onClick → undo(key) } }).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredDeletes, DEFERRED_DELETE_MS } from '../src/lib/deferredDelete.ts'

function spy() {
  const log = []
  const handlers = (key) => ({
    onCommit: () => { log.push(`commit:${key}`) },
    onUndo: () => { log.push(`undo:${key}`) },
  })
  return { log, handlers }
}

test('the undo window is 5 seconds', () => {
  assert.equal(DEFERRED_DELETE_MS, 5_000)
})

test('schedule runs nothing and marks the key pending', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  const h = q.schedule('label:bug', handlers('label:bug'))
  assert.deepEqual(log, [])
  assert.equal(q.isPending('label:bug'), true)
  assert.deepEqual(q.pendingKeys(), ['label:bug'])
  assert.equal(h.settled, false)
})

test('commit runs onCommit exactly once and blocks a later undo', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  q.schedule('a', handlers('a'))
  assert.equal(q.commit('a'), true)
  assert.equal(q.commit('a'), false) // onAutoClose + onDismiss both firing
  assert.equal(q.undo('a'), false)
  assert.deepEqual(log, ['commit:a'])
  assert.equal(q.isPending('a'), false)
  assert.deepEqual(q.pendingKeys(), [])
})

test('undo runs onUndo exactly once and the delete never commits', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  q.schedule('a', handlers('a'))
  assert.equal(q.undo('a'), true)
  assert.equal(q.commit('a'), false) // toast closing after Undo
  assert.equal(q.undo('a'), false)
  assert.equal(q.flushAll(), 0)
  assert.deepEqual(log, ['undo:a'])
  assert.equal(q.isPending('a'), false)
})

test('the handle and the queue settle the same action once', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  const h = q.schedule('a', handlers('a'))
  assert.equal(h.commit(), true)
  assert.equal(q.commit('a'), false)
  assert.equal(h.undo(), false)
  assert.equal(h.settled, true)
  assert.deepEqual(log, ['commit:a'])
})

test('two pending deletes are independent: each commits once, neither early', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  q.schedule('a', handlers('a'))
  q.schedule('b', handlers('b'))
  assert.deepEqual(q.pendingKeys(), ['a', 'b'])
  assert.deepEqual(log, [])
  assert.equal(q.commit('a'), true)
  assert.deepEqual(log, ['commit:a'])
  assert.equal(q.isPending('b'), true)
  assert.equal(q.commit('b'), true)
  assert.equal(q.commit('a'), false)
  assert.equal(q.commit('b'), false)
  assert.deepEqual(log, ['commit:a', 'commit:b'])
})

test('undoing one pending delete leaves the other pending', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  q.schedule('a', handlers('a'))
  q.schedule('b', handlers('b'))
  assert.equal(q.undo('b'), true)
  assert.deepEqual(q.pendingKeys(), ['a'])
  assert.equal(q.commit('a'), true)
  assert.deepEqual(log, ['undo:b', 'commit:a'])
})

test('re-scheduling a pending key does not register a second delete', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  const first = q.schedule('a', handlers('a'))
  const second = q.schedule('a', { onCommit: () => log.push('commit:dup'), onUndo: () => log.push('undo:dup') })
  assert.equal(second, first)
  assert.deepEqual(q.pendingKeys(), ['a'])
  assert.equal(q.flushAll(), 1)
  assert.deepEqual(log, ['commit:a'])
})

test('a settled key can be scheduled again with a fresh handle', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  q.schedule('a', handlers('a'))
  q.undo('a')
  const again = q.schedule('a', handlers('a'))
  assert.equal(again.settled, false)
  assert.equal(q.commit('a'), true)
  assert.deepEqual(log, ['undo:a', 'commit:a'])
})

test('commit/undo on an unknown key are no-ops', () => {
  const q = createDeferredDeletes()
  assert.equal(q.commit('nope'), false)
  assert.equal(q.undo('nope'), false)
  assert.equal(q.isPending('nope'), false)
})

test('flushAll commits every pending delete exactly once (navigation / unmount)', () => {
  const q = createDeferredDeletes()
  const { log, handlers } = spy()
  q.schedule('a', handlers('a'))
  q.schedule('b', handlers('b'))
  q.schedule('c', handlers('c'))
  q.undo('b')
  assert.equal(q.flushAll(), 2)
  assert.deepEqual(log, ['undo:b', 'commit:a', 'commit:c'])
  assert.deepEqual(q.pendingKeys(), [])
  // The toasts closing afterwards must not delete again.
  assert.equal(q.commit('a'), false)
  assert.equal(q.commit('c'), false)
  assert.equal(q.flushAll(), 0)
  assert.deepEqual(log, ['undo:b', 'commit:a', 'commit:c'])
})

test('separate queues do not share state', () => {
  const q1 = createDeferredDeletes()
  const q2 = createDeferredDeletes()
  const { log, handlers } = spy()
  q1.schedule('a', handlers('a'))
  assert.equal(q2.isPending('a'), false)
  assert.equal(q2.commit('a'), false)
  assert.equal(q2.flushAll(), 0)
  assert.deepEqual(log, [])
})
