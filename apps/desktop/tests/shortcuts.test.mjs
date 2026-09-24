import test from 'node:test'
import assert from 'node:assert/strict'
import { SHORTCUTS, G_PREFIX_PAGES, G_PREFIX_TIMEOUT_MS, isHabitsShortcut } from '../src/lib/shortcuts.ts'

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
  for (const k of ['j / ↓', 'k / ↑', 'x', 's', 'Enter', 'f', 'Escape']) {
    assert.ok(keys.includes(k), `Tasks missing ${k}`)
  }
})

test('Inbox section lists capture and row keys', () => {
  const keys = keysIn('Inbox')
  for (const k of ['c', 'j / ↓', 'k / ↑', 'Enter', 't', 'm', 'd', 'Escape']) {
    assert.ok(keys.includes(k), `Inbox missing ${k}`)
  }
})

test('Inbox is appended after General (then B3b sections), existing order untouched', () => {
  assert.deepEqual(SHORTCUT_SECTIONS, ['Navigation', 'Tasks', 'Focus', 'Command bar', 'Calendar', 'Selection', 'General', 'Inbox', 'Docs', 'Goals', 'Session', 'Today'])
})

test('Space is not a Tasks row key — it stays Focus pause/resume (review I2)', () => {
  assert.ok(!keysIn('Tasks').some((k) => k.includes('Space')))
  assert.ok(keysIn('Focus').includes('Space'))
})

// ── Stage B3b: Docs / Goals / Session sections ──

test('registry lists the Docs, Goals and Session sections after the Stage A ones', () => {
  const order = [...new Set(SHORTCUTS.map((s) => s.section))]
  const idx = (name) => order.indexOf(name)
  assert.ok(idx('Docs') > idx('General'), 'Docs appended after General')
  assert.ok(idx('Goals') > idx('Docs'), 'Goals after Docs')
  assert.ok(idx('Session') > idx('Goals'), 'Session after Goals')
})

test('Docs section carries the tree keys, N and /', () => {
  const keys = SHORTCUTS.filter((s) => s.section === 'Docs').map((s) => s.keys)
  for (const k of ['↑ / ↓', '← / →', 'Enter', 'N', '/']) assert.ok(keys.includes(k), `missing Docs ${k}`)
})

test('Goals section carries the habit toggle and timeline today', () => {
  const keys = SHORTCUTS.filter((s) => s.section === 'Goals').map((s) => s.keys)
  for (const k of ['Enter / Space', 'T']) assert.ok(keys.includes(k), `missing Goals ${k}`)
})

test('Session section carries complete, minimize, stop and the completion-note keys', () => {
  const keys = SHORTCUTS.filter((s) => s.section === 'Session').map((s) => s.keys)
  for (const k of ['Enter', 'Escape', 's']) assert.ok(keys.includes(k), `missing Session ${k}`)
  const note = SHORTCUTS.filter((s) => s.section === 'Session' && s.keys.includes('completion note'))
  assert.equal(note.length, 2, 'Enter and Escape on the completion note')
  for (const s of note) assert.match(s.label, /^Dismiss/, 'dismissing never starts the next task')
  assert.ok(note.some((s) => s.label.includes('stays paused')))
  for (const s of SHORTCUTS) assert.doesNotMatch(s.label, /start the next task/i)
})

test('⇧H is the habits shortcut, bare and unrepeated (goals N-P1-1)', () => {
  assert.equal(isHabitsShortcut({ key: 'H' }), true)
  assert.equal(isHabitsShortcut({ key: 'h' }), false)
  assert.equal(isHabitsShortcut({ key: 'H', metaKey: true }), false)
  assert.equal(isHabitsShortcut({ key: 'H', ctrlKey: true }), false)
  assert.equal(isHabitsShortcut({ key: 'H', altKey: true }), false)
  assert.equal(isHabitsShortcut({ key: 'H', repeat: true }), false)
  assert.ok(SHORTCUTS.some((s) => s.keys === '⇧H'), 'registry lists ⇧H')
})
