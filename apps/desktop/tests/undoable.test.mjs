import test from 'node:test'
import assert from 'node:assert/strict'
import { createUndoable } from '../src/lib/undoable.ts'

function spies() {
  const calls = { commit: 0, undo: 0 }
  const u = createUndoable({ onCommit: () => { calls.commit++ }, onUndo: () => { calls.undo++ } })
  return { u, calls }
}

test('undo before commit runs onUndo once and blocks a later commit', () => {
  const { u, calls } = spies()
  assert.equal(u.undo(), true)
  assert.equal(u.commit(), false)
  assert.equal(u.undo(), false)
  assert.deepEqual(calls, { commit: 0, undo: 1 })
  assert.equal(u.settled, true)
})

test('commit before undo runs onCommit once and makes undo a no-op', () => {
  const { u, calls } = spies()
  assert.equal(u.commit(), true)
  assert.equal(u.undo(), false)
  assert.equal(u.commit(), false)
  assert.deepEqual(calls, { commit: 1, undo: 0 })
})

test('auto-close and dismiss both firing still commits exactly once', () => {
  const { u, calls } = spies()
  u.commit() // onAutoClose
  u.commit() // onDismiss
  assert.deepEqual(calls, { commit: 1, undo: 0 })
})

test('starts unsettled', () => {
  const { u } = spies()
  assert.equal(u.settled, false)
})
