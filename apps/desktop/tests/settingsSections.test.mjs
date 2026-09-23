import test from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_SECTIONS, visibleSections, activeSectionId } from '../src/lib/settingsSections.ts'
import { settingsFailure, settingsMessage } from '../src/lib/settingsMessage.ts'

const ALL = { backup: true, reminders: true, googleCalendar: true }
const NONE = { backup: false, reminders: false, googleCalendar: false }

test('section ids are unique and labels are sentence case', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const s of SETTINGS_SECTIONS) {
    assert.equal(s.label[0], s.label[0].toUpperCase(), s.label)
    assert.equal(s.label.slice(1), s.label.slice(1).toLowerCase(), s.label)
  }
})

test('obsidian is the third section, maintenance is last, retired sections are gone', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id)
  assert.equal(ids[2], 'obsidian')
  assert.equal(ids[ids.length - 1], 'maintenance')
  for (const gone of ['vault', 'status-colors', 'import-todoist', 'docs-format', 'tasks-format', 'focus']) {
    assert.ok(!ids.includes(gone), `${gone} should not be a top-level section`)
  }
  assert.ok(ids.includes('backups'), 'backups is in the nav')
})

test('visibleSections drops capability-gated sections and keeps order', () => {
  const all = visibleSections(ALL).map((s) => s.id)
  assert.deepEqual(all, SETTINGS_SECTIONS.map((s) => s.id))
  const none = visibleSections(NONE).map((s) => s.id)
  for (const gated of ['backups', 'reminders', 'google-calendar']) assert.ok(!none.includes(gated), gated)
  assert.equal(none.length, all.length - 3)
})

test('activeSectionId picks the last section whose top is at or above the active line', () => {
  const boxes = [
    { id: 'a', top: 0 },
    { id: 'b', top: 500 },
    { id: 'c', top: 1000 },
  ]
  assert.equal(activeSectionId(boxes, 600), 'b')
  assert.equal(activeSectionId(boxes, 1000), 'c')
  assert.equal(activeSectionId(boxes, -10), 'a')
  assert.equal(activeSectionId(boxes, 5000), 'c')
  assert.equal(activeSectionId([], 100), null)
})

test('settingsFailure maps known Turso errors and keeps the raw string as detail', () => {
  const f = settingsFailure('Turso test failed: dns error')
  assert.notEqual(f.message, "That didn't save. Try again.")
  assert.equal(f.detail, 'Turso test failed: dns error')
})

test('settingsFailure falls back to a neutral default for unknown errors', () => {
  const f = settingsFailure(new Error('invoke boom'))
  assert.equal(f.message, "That didn't save. Try again.")
  assert.equal(f.detail, 'invoke boom')
  assert.deepEqual(settingsFailure(null), { message: "That didn't save. Try again.", detail: null })
  assert.equal(settingsMessage('whatever'), "That didn't save. Try again.")
})

test('settingsFailure never echoes "Failed:" prefixes or stack traces in the message', () => {
  const f = settingsFailure('Error: invoke update_capture_route failed\n    at x.js:1')
  assert.ok(!/invoke|Error:/.test(f.message), f.message)
})

test('activeSectionId resolves to the last section once the scroller is at its end', () => {
  const boxes = [
    { id: 'a', top: -900 },
    { id: 'b', top: 200 },
    { id: 'c', top: 600 },
  ]
  assert.equal(activeSectionId(boxes, 89), 'a')
  assert.equal(activeSectionId(boxes, 89, true), 'c')
})
