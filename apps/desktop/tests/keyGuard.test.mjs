import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldIgnoreKey, calendarKey, reviewEnterAction, INTERACTIVE_SELECTOR, OVERLAY_SELECTOR } from '../src/lib/keyGuard.ts'

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

import { focusViewKey, QUEUE_ROW_SELECTOR } from '../src/lib/keyGuard.ts'

test('focus view: Enter and s act on the card from the page, never from an Up next row', () => {
  const body = el({ tag: 'BODY' })
  assert.equal(focusViewKey({ key: 'Enter', target: body }), 'complete')
  assert.equal(focusViewKey({ key: 's', target: body }), 'stop')
  assert.equal(focusViewKey({ key: 'Escape', target: body }), 'close')
  const row = el({ tag: 'LI', is: [QUEUE_ROW_SELECTOR] })
  assert.equal(focusViewKey({ key: 'Enter', target: row }), null, 'Enter on a row promotes that row instead')
  assert.equal(focusViewKey({ key: 's', target: row }), null)
  assert.equal(focusViewKey({ key: 'Escape', target: row }), 'close', 'Escape still closes the view')
})

test('focus view: claimed, chorded, repeated and field keys are left alone', () => {
  const body = el({ tag: 'BODY' })
  assert.equal(focusViewKey({ key: 'Enter', target: body, defaultPrevented: true }), null)
  assert.equal(focusViewKey({ key: 'Enter', target: body, metaKey: true }), null)
  assert.equal(focusViewKey({ key: 'Enter', target: body, repeat: true }), null)
  assert.equal(focusViewKey({ key: 'Enter', target: el({ tag: 'INPUT' }) }), null)
  assert.equal(focusViewKey({ key: 'Enter', target: el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] }) }), null)
})

test('calendarKey maps ← → t on calendar content', () => {
  const cell = el({ tag: 'DIV' })
  assert.equal(calendarKey({ key: 'ArrowLeft', target: cell }), 'prev')
  assert.equal(calendarKey({ key: 'ArrowRight', target: cell }), 'next')
  assert.equal(calendarKey({ key: 't', target: cell }), 'today')
  assert.equal(calendarKey({ key: 'T', target: cell }), 'today')
  assert.equal(calendarKey({ key: 'x', target: cell }), null)
})

test('calendarKey also works from the calendar’s own buttons', () => {
  const prevButton = el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] })
  assert.equal(calendarKey({ key: 'ArrowRight', target: prevButton }), 'next')
})

test('calendarKey leaves text entry, overlays, handled keys and chords alone (inbox N-P1-1)', () => {
  assert.equal(calendarKey({ key: 't', target: el({ tag: 'INPUT' }) }), null)
  assert.equal(calendarKey({ key: 'ArrowLeft', target: el({ tag: 'TEXTAREA' }) }), null)
  assert.equal(calendarKey({ key: 't', target: el({ editable: true }) }), null)
  assert.equal(calendarKey({ key: 't', target: el({ inside: [OVERLAY_SELECTOR] }) }), null)
  assert.equal(calendarKey({ key: 't', target: el(), defaultPrevented: true }), null)
  for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
    assert.equal(calendarKey({ key: 'ArrowLeft', target: el(), [mod]: true }), null, mod)
  }
})

test('review Enter on the page advances step 1 and finishes step 2 once priorities exist', () => {
  const page = el({ tag: 'BODY' })
  assert.equal(reviewEnterAction({ key: 'Enter', target: page }, 1, false), 'advance')
  assert.equal(reviewEnterAction({ key: 'Enter', target: page }, 2, true), 'finish')
  assert.equal(reviewEnterAction({ key: 'Enter', target: page }, 2, false), null)
})

test('review Enter leaves focused controls, fields and overlays alone (today N-P1-1)', () => {
  const button = el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] })
  assert.equal(reviewEnterAction({ key: 'Enter', target: button }, 1, false), null)
  assert.equal(reviewEnterAction({ key: 'Enter', target: button }, 2, true), null)
  assert.equal(reviewEnterAction({ key: 'Enter', target: el({ tag: 'INPUT' }) }, 1, false), null)
  assert.equal(reviewEnterAction({ key: 'Enter', target: el({ inside: [OVERLAY_SELECTOR] }) }, 1, false), null)
})

test('review Enter ignores other keys, chords and handled events', () => {
  const page = el({ tag: 'BODY' })
  assert.equal(reviewEnterAction({ key: ' ', target: page }, 1, false), null)
  assert.equal(reviewEnterAction({ key: 'Enter', target: page, defaultPrevented: true }, 1, false), null)
  for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
    assert.equal(reviewEnterAction({ key: 'Enter', target: page, [mod]: true }, 1, false), null, mod)
  }
})
