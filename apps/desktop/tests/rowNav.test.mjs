import test from 'node:test'
import assert from 'node:assert/strict'
import { stepIndex, clampIndex } from '../src/lib/rowNav.ts'

// j/k row navigation math shared by useTaskNavigation (Tasks) and the
// Inbox row list — tasks audit P1-1, inbox P1-2.

test('j from no focus lands on the first row', () => {
  assert.equal(stepIndex(-1, 1, 5), 0)
})

test('j on the last row stays on the last row', () => {
  assert.equal(stepIndex(4, 1, 5), 4)
})

test('k on the first row stays on the first row', () => {
  assert.equal(stepIndex(0, -1, 5), 0)
})

test('k from no focus lands on the last row', () => {
  assert.equal(stepIndex(-1, -1, 5), 4)
})

test('stepping an empty list yields no focus', () => {
  assert.equal(stepIndex(-1, 1, 0), -1)
  assert.equal(stepIndex(2, -1, 0), -1)
})

test('clampIndex keeps an in-range index when the list shrinks', () => {
  assert.equal(clampIndex(2, 5), 2)
})

test('clampIndex moves focus to the new last row when the focused row was last and removed', () => {
  assert.equal(clampIndex(4, 4), 3)
})

test('clampIndex returns -1 for no focus or an empty list', () => {
  assert.equal(clampIndex(-1, 5), -1)
  assert.equal(clampIndex(3, 0), -1)
})
