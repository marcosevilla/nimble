import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldIgnoreKey, calendarKey, todayKey, INTERACTIVE_SELECTOR, OVERLAY_SELECTOR } from '../src/lib/keyGuard.ts'

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

test('todayKey: b toggles, [ and ] step days, never from fields, overlays or chords', () => {
  const ev = (key, extra = {}) => ({ key, target: el(), ...extra })
  assert.equal(todayKey(ev('b')), 'toggle')
  assert.equal(todayKey(ev('[')), 'prev')
  assert.equal(todayKey(ev(']')), 'next')
  assert.equal(todayKey(ev('b', { metaKey: true })), null)
  assert.equal(todayKey(ev('b', { defaultPrevented: true })), null)
  assert.equal(todayKey(ev('B', { shiftKey: true })), null)
  assert.equal(todayKey({ key: 'b', target: el({ tag: 'INPUT' }) }), null)
})

import { shellKeyBlocked, spaceKeyBlocked, ROW_SELECTOR } from '../src/lib/keyGuard.ts'

test('shell keys (? ⇧F ⇧H q digits g-chord) skip every text entry, a SELECT included', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(shellKeyBlocked(el({ tag }), false), true, tag)
  assert.equal(shellKeyBlocked(el({ editable: true }), false), true, 'contenteditable')
})

test('shell keys skip while any overlay is open, focused or not', () => {
  assert.equal(shellKeyBlocked(el({ inside: [OVERLAY_SELECTOR] }), false), true, 'focus inside a menu/dialog')
  assert.equal(shellKeyBlocked(el({ tag: 'BODY' }), true), true, 'an overlay open elsewhere')
})

test('shell keys still act from the page and from a focused button', () => {
  assert.equal(shellKeyBlocked(el({ tag: 'BODY' }), false), false)
  assert.equal(shellKeyBlocked(el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] }), false), false, 'a nav button keeps digits')
  assert.equal(shellKeyBlocked(null, false), false)
})

test('Space leaves buttons, fields and overlays alone but not a list row', () => {
  assert.equal(spaceKeyBlocked(el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] }), false), true, 'a button activates')
  assert.equal(spaceKeyBlocked(el({ tag: 'SELECT' }), false), true)
  assert.equal(spaceKeyBlocked(el({ inside: [OVERLAY_SELECTOR] }), false), true, 'inside a dialog')
  assert.equal(spaceKeyBlocked(el({ tag: 'BODY' }), true), true, 'an overlay open elsewhere')
  const row = el({ tag: 'DIV', is: [INTERACTIVE_SELECTOR, ROW_SELECTOR] })
  assert.equal(spaceKeyBlocked(row, false), false, 'a task row (role=button) hands Space to the session')
  assert.equal(spaceKeyBlocked(el({ tag: 'BODY' }), false), false)
})

test('one overlay selector: real popups only — no tooltip triggers, no inline listboxes', async () => {
  const rowNav = await import('../src/lib/rowNav.ts')
  assert.equal(rowNav.OVERLAY_SELECTOR, OVERLAY_SELECTOR, 'rowNav uses the same selector')
  assert.doesNotMatch(OVERLAY_SELECTOR, /data-popup-open|data-open/, 'a tooltip trigger/popup is not an overlay')
  for (const part of ['[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[data-slot="popover-content"]', '[data-slot="select-content"]'])
    assert.ok(OVERLAY_SELECTOR.includes(part), part)
  assert.match(OVERLAY_SELECTOR, /\[role="listbox"\]:not\(\[data-inline-listbox\]\)/, 'inline listboxes (Docs search) excluded')
})

test('a focused nav icon whose tooltip is showing keeps the shell keys', () => {
  const icon = el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR, '[data-popup-open]'] })
  assert.equal(shellKeyBlocked(icon, false), false)
})
