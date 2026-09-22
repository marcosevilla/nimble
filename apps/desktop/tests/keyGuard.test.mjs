import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldIgnoreKey, INTERACTIVE_SELECTOR, OVERLAY_SELECTOR } from '../src/lib/keyGuard.ts'

// Minimal element stand-in: `inside` lists the selectors this element sits
// inside (closest() hits), `is` the selectors it matches itself.
function el({ tag = 'DIV', editable = false, inside = [], is = [] } = {}) {
  const self = {
    tagName: tag,
    isContentEditable: editable,
    matches: (sel) => is.includes(sel),
    closest: (sel) => (inside.includes(sel) || is.includes(sel) ? self : null),
  }
  return self
}

test('text entry targets are always ignored', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(shouldIgnoreKey(el({ tag })), true, tag)
  assert.equal(shouldIgnoreKey(el({ editable: true })), true, 'contenteditable')
})

test('a target inside an open popover, menu or dialog is ignored', () => {
  assert.equal(shouldIgnoreKey(el({ inside: [OVERLAY_SELECTOR] })), true)
})

test('a nested interactive control is ignored unless it is the row itself', () => {
  const button = el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] })
  assert.equal(shouldIgnoreKey(button), true, 'plain button')
  const row = el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR, '[data-tree-row]'] })
  assert.equal(shouldIgnoreKey(row, { rowSelector: '[data-tree-row]' }), false, 'the row itself')
  assert.equal(shouldIgnoreKey(button, { rowSelector: '[data-tree-row]' }), true, 'a different button')
})

test('body / plain containers pass through', () => {
  assert.equal(shouldIgnoreKey(el({ tag: 'BODY' })), false)
  assert.equal(shouldIgnoreKey(null), false)
})

test('interactive check can be skipped for modal overlays that own every key', () => {
  const button = el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] })
  assert.equal(shouldIgnoreKey(button, { allowInteractive: true }), false)
  assert.equal(shouldIgnoreKey(el({ tag: 'INPUT' }), { allowInteractive: true }), true)
})
