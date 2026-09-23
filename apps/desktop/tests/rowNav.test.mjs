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

import { resolveRowFocus, decideRowKey, NO_ROW_FOCUS } from '../src/lib/rowNav.ts'

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

// ── Review C2 + fix round 2 (N1): key target guard ──
// Minimal element stand-in: `is` lists the simple selectors it matches
// itself; `parent` chains up for closest().

function el(is, parent = null, extra = {}) {
  const self = {
    ...extra,
    parent,
    getAttribute: (name) => (extra.attrs ?? {})[name] ?? null,
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
const row = el(['[data-nav-row]'], body, { attrs: { 'data-nav-row': 'task-1' } })
const statusButton = el(['button'], row)
const rowText = el(['span'], row)
const headerButton = el(['button'], body)
const input = el(['input'], body)
const menu = el(['[role="menu"]'], body)
const menuItem = el(['[role="menuitem"]'], menu)
const popover = el(['[data-slot="popover-content"]'], body)
const popoverButton = el(['button'], popover)
const editable = el(['div'], body, { isContentEditable: true })

const handled = (target, key) => decideRowKey(target, key).handle

test('the row itself and the page take every list key', () => {
  for (const key of ['j', 'k', 'Enter', 'x', 'Escape']) {
    assert.deepEqual(decideRowKey(row, key), { handle: true, rowId: 'task-1' })
    assert.equal(handled(body, key), true)
  }
  assert.equal(handled(null, 'j'), true)
  assert.equal(handled({}, 'j'), true) // window / document
  assert.deepEqual(decideRowKey(rowText, 'j'), { handle: true, rowId: 'task-1' })
})

test('a nested control keeps Enter and Space (C2)', () => {
  assert.equal(handled(statusButton, 'Enter'), false)
  assert.equal(handled(statusButton, ' '), false)
  assert.equal(handled(headerButton, 'Enter'), false)
})

test('other list keys on a nested control act on its row (N1)', () => {
  for (const key of ['j', 'k', 'ArrowDown', 'x', 's', 'f', 't', 'm', 'd', 'Escape']) {
    assert.deepEqual(decideRowKey(statusButton, key), { handle: true, rowId: 'task-1' })
  }
})

test('fields and open overlays keep every key', () => {
  for (const key of ['j', 'x', 'Enter', ' ', 'Escape']) {
    assert.equal(handled(input, key), false)
    assert.equal(handled(editable, key), false)
    assert.equal(handled(menuItem, key), false)
    assert.equal(handled(popoverButton, key), false)
  }
})

test('keys typed inside a nav tree never reach the row list (docs N-P1-1)', () => {
  const tree = el(['[role="tree"]'], body)
  const treeRow = el(['button', '[role="treeitem"]'], tree)
  for (const key of ['ArrowDown', 'ArrowUp', 'j', 'k', 'Enter', 'd', 't', 'x', 'Escape']) {
    assert.deepEqual(decideRowKey(treeRow, key), { handle: false, rowId: null }, key)
  }
})
