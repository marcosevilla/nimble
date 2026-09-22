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

// ── Review C1 / I3: focus by id ──

import { resolveRowFocus, classifyRowKeyTarget, NO_ROW_FOCUS } from '../src/lib/rowNav.ts'

test('a row inserted above keeps focus on the same row (C1)', () => {
  const prev = { id: 'b', index: 0 }
  assert.deepEqual(resolveRowFocus(prev, ['temp', 'b', 'c']), { id: 'b', index: 1 })
})

test('a remembered row id is restored where it now sits (I3)', () => {
  assert.deepEqual(resolveRowFocus({ id: 'c', index: 5 }, ['a', 'b', 'c']), { id: 'c', index: 2 })
})

test('when the focused row is gone, focus falls to the nearest row (I3)', () => {
  assert.deepEqual(resolveRowFocus({ id: 'x', index: 1 }, ['a', 'c']), { id: 'c', index: 1 })
  assert.deepEqual(resolveRowFocus({ id: 'x', index: 4 }, ['a', 'c']), { id: 'c', index: 1 })
})

test('no rows (still loading) or no focus resolves to nothing', () => {
  assert.deepEqual(resolveRowFocus({ id: 'a', index: 0 }, []), NO_ROW_FOCUS)
  assert.deepEqual(resolveRowFocus(NO_ROW_FOCUS, ['a']), NO_ROW_FOCUS)
})

// ── Review C2: key target guard ──
// Minimal element stand-in: `is` lists the simple selectors it matches
// itself; `parent` chains up for closest().

function el(is, parent = null, extra = {}) {
  const self = {
    ...extra,
    parent,
    matches(sel) {
      return sel.split(',').map((s) => s.trim()).some((s) => is.some((x) => s === x || s.startsWith(`${x}:`)))
    },
    closest(sel) {
      for (let n = self; n; n = n.parent) if (n.matches(sel)) return n
      return null
    },
  }
  return self
}

const body = el(['body'])
const row = el(['[data-nav-row]'], body)
const statusButton = el(['button'], row)
const convertButton = el(['button'], row)
const rowText = el(['span'], row)
const input = el(['input'], body)
const menu = el(['[role="menu"]'], body)
const menuItem = el(['[role="menuitem"]'], menu)
const popover = el(['[data-slot="popover-content"]'], body)
const popoverButton = el(['button'], popover)

test('keys from the row itself or the page are row keys', () => {
  assert.equal(classifyRowKeyTarget(row), 'row')
  assert.equal(classifyRowKeyTarget(body), 'free')
  assert.equal(classifyRowKeyTarget(rowText), 'free')
  assert.equal(classifyRowKeyTarget(null), 'free')
  assert.equal(classifyRowKeyTarget({}), 'free') // window / document
})

test('nested controls, fields and open overlays keep their keys (C2)', () => {
  assert.equal(classifyRowKeyTarget(statusButton), 'yield')
  assert.equal(classifyRowKeyTarget(convertButton), 'yield')
  assert.equal(classifyRowKeyTarget(input), 'yield')
  assert.equal(classifyRowKeyTarget(menuItem), 'yield')
  assert.equal(classifyRowKeyTarget(popoverButton), 'yield')
  assert.equal(classifyRowKeyTarget(el(['div'], body, { isContentEditable: true })), 'yield')
})
