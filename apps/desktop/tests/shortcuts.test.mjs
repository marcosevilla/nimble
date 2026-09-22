import test from 'node:test'
import assert from 'node:assert/strict'
import { SHORTCUTS, G_PREFIX_PAGES, G_PREFIX_TIMEOUT_MS } from '../src/lib/shortcuts.ts'

test('every shortcut has a section, non-empty keys and a non-empty label', () => {
  assert.ok(SHORTCUTS.length > 0)
  for (const s of SHORTCUTS) {
    assert.equal(typeof s.section, 'string'); assert.ok(s.section.trim().length > 0, JSON.stringify(s))
    assert.equal(typeof s.keys, 'string'); assert.ok(s.keys.trim().length > 0, JSON.stringify(s))
    assert.equal(typeof s.label, 'string'); assert.ok(s.label.trim().length > 0, JSON.stringify(s))
  }
})

test('no duplicate keys within a section', () => {
  const seen = new Map()
  for (const s of SHORTCUTS) {
    const id = `${s.section}::${s.keys}`
    assert.ok(!seen.has(id), `duplicate ${id}`)
    seen.set(id, true)
  }
})

test('registry contains ?, g t, q and ⌘K', () => {
  const keys = SHORTCUTS.map((s) => s.keys)
  for (const k of ['?', 'g t', 'q', '⌘K']) assert.ok(keys.includes(k), `missing ${k}`)
})

test('g-prefix map covers the seven pages with a 600ms window', () => {
  assert.deepEqual(G_PREFIX_PAGES, { t: 'today', k: 'tasks', i: 'inbox', d: 'docs', g: 'goals', s: 'session', ',': 'settings' })
  assert.equal(G_PREFIX_TIMEOUT_MS, 600)
  for (const [k, page] of Object.entries(G_PREFIX_PAGES)) {
    assert.ok(SHORTCUTS.some((s) => s.keys === `g ${k}`), `registry lists g ${k} → ${page}`)
  }
})

test('section titles are sentence case', () => {
  for (const s of new Set(SHORTCUTS.map((s) => s.section))) {
    assert.equal(s, s[0].toUpperCase() + s.slice(1).toLowerCase(), s)
  }
})

// ── B3a: Tasks + Inbox rows ──

import { SHORTCUT_SECTIONS } from '../src/lib/shortcuts.ts'

const keysIn = (section) => SHORTCUTS.filter((s) => s.section === section).map((s) => s.keys)

test('Tasks section lists the row keys, including f and Escape', () => {
  const keys = keysIn('Tasks')
  for (const k of ['j / ↓', 'k / ↑', 'x / Space', 's', 'Enter', 'f', 'Escape']) {
    assert.ok(keys.includes(k), `Tasks missing ${k}`)
  }
})

test('Inbox section lists capture and row keys', () => {
  const keys = keysIn('Inbox')
  for (const k of ['c', 'j / ↓', 'k / ↑', 'Enter', 't', 'm', 'd', 'Escape']) {
    assert.ok(keys.includes(k), `Inbox missing ${k}`)
  }
})

test('Inbox is appended as the last section, existing order untouched', () => {
  assert.deepEqual(SHORTCUT_SECTIONS, ['Navigation', 'Tasks', 'Focus', 'Command bar', 'Calendar', 'Selection', 'General', 'Inbox'])
})
