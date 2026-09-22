import test from 'node:test'
import assert from 'node:assert/strict'
import { SHORTCUTS, isModifierOnlyKey } from '../src/lib/shortcuts.ts'

// Shell B4: a pending `g` chord must survive a modifier-only keydown
// (e.g. the user reaching for Shift), and the sidebar reorder chord that
// keeps nav buttons keyboard-activatable is listed in the registry.

test('modifier-only keys never consume a pending g chord', () => {
  for (const k of ['Shift', 'Alt', 'Meta', 'Control', 'CapsLock']) {
    assert.equal(isModifierOnlyKey(k), true, k)
  }
  for (const k of ['t', 'k', 'g', ',', 'Escape', 'Enter', ' ']) {
    assert.equal(isModifierOnlyKey(k), false, JSON.stringify(k))
  }
})

test('registry lists the sidebar reorder chord under Navigation', () => {
  assert.ok(
    SHORTCUTS.some((s) => s.section === 'Navigation' && s.keys === '⌥Enter'),
    'missing ⌥Enter row',
  )
})
