import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTINGS_SECTIONS,
  SETTINGS_PAGES,
  DEFAULT_SETTINGS_PAGE,
  visibleSections,
  visiblePages,
  sectionsOnPage,
  resolveSettingsPage,
  settingsTarget,
  activeSectionId,
} from '../src/lib/settingsSections.ts'
import { settingsFailure, settingsMessage } from '../src/lib/settingsMessage.ts'

const ALL = { backup: true, reminders: true, googleCalendar: true, briefSettings: true, momentum: true }
const NONE = { backup: false, reminders: false, googleCalendar: false, briefSettings: false, momentum: false }

const ACRONYMS = ['API']
function assertSentenceCase(label) {
  assert.equal(label[0], label[0].toUpperCase(), label)
  // "API keys" → "Api keys" before checking that nothing after the first letter is capitalised
  const rest = ACRONYMS.reduce((s, a) => s.replaceAll(a, a[0] + a.slice(1).toLowerCase()), label).slice(1)
  assert.equal(rest, rest.toLowerCase(), label)
}

test('section and page ids are unique; labels are sentence case', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
  const pageIds = SETTINGS_PAGES.map((p) => p.id)
  assert.equal(new Set(pageIds).size, pageIds.length)
  for (const s of SETTINGS_SECTIONS) assertSentenceCase(s.label)
  for (const p of SETTINGS_PAGES) assertSentenceCase(p.label)
})

test('six pages in the decided order (Activity last), each section on the decided page', () => {
  assert.deepEqual(
    SETTINGS_PAGES.map((p) => [p.id, p.label]),
    [
      ['general', 'General'],
      ['brief', 'Today & brief'],
      ['tasks', 'Tasks & capture'],
      ['connections', 'Connections'],
      ['data', 'Data'],
      ['activity', 'Activity'],
    ],
  )
  const byPage = Object.fromEntries(SETTINGS_PAGES.map((p) => [p.id, sectionsOnPage(SETTINGS_SECTIONS, p.id).map((s) => s.id)]))
  assert.deepEqual(byPage, {
    general: ['appearance', 'demo', 'about'],
    brief: ['today-brief', 'today-location', 'today-boxes', 'momentum'],
    tasks: ['capture-routes', 'labels', 'reminders'],
    connections: ['integrations', 'obsidian', 'todoist-sync', 'calendars', 'google-calendar'],
    data: ['sync', 'backups', 'maintenance'],
    activity: ['activity'],
  })
  assert.equal(DEFAULT_SETTINGS_PAGE, 'general')
  assert.equal(SETTINGS_SECTIONS.find((s) => s.id === 'integrations').label, 'API keys')
})

test('sections are grouped in page order, so render order matches the rail', () => {
  const order = SETTINGS_PAGES.map((p) => p.id)
  const pageIndex = SETTINGS_SECTIONS.map((s) => order.indexOf(s.page))
  assert.ok(pageIndex.every((i) => i >= 0), 'every section names a known page')
  assert.deepEqual(pageIndex, [...pageIndex].sort((a, b) => a - b))
})

test('no page opens on a standalone section (it would draw a stray top rule)', () => {
  for (const p of SETTINGS_PAGES) {
    const first = sectionsOnPage(SETTINGS_SECTIONS, p.id)[0]
    assert.ok(first && !first.standalone, p.id)
  }
})

test('retired sections stay gone', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id)
  for (const gone of ['vault', 'status-colors', 'import-todoist', 'docs-format', 'tasks-format', 'focus']) {
    assert.ok(!ids.includes(gone), `${gone} should not be a top-level section`)
  }
})

test('visibleSections drops capability-gated sections and keeps order', () => {
  const all = visibleSections(ALL).map((s) => s.id)
  assert.deepEqual(all, SETTINGS_SECTIONS.map((s) => s.id))
  const none = visibleSections(NONE).map((s) => s.id)
  const gated = SETTINGS_SECTIONS.filter((s) => s.requires).map((s) => s.id)
  for (const id of gated) assert.ok(!none.includes(id), id)
  assert.ok(gated.includes('momentum'), 'Goals & momentum is desktop-only')
  assert.equal(none.length, all.length - gated.length)
})

test('visiblePages hides a page with no renderable section (web build, empty brief slot)', () => {
  const web = visibleSections(NONE)
  assert.deepEqual(visiblePages(web).map((p) => p.id), ['general', 'tasks', 'connections', 'data', 'activity'])
  assert.deepEqual(visiblePages(visibleSections(ALL)).map((p) => p.id), SETTINGS_PAGES.map((p) => p.id))
  assert.deepEqual(visiblePages([]), [])
})

test('resolveSettingsPage keeps a visible page and falls back to the first visible one', () => {
  const pages = visiblePages(visibleSections(ALL).filter((s) => s.page !== 'brief'))
  assert.equal(resolveSettingsPage('data', pages), 'data')
  assert.equal(resolveSettingsPage('brief', pages), 'general')
  assert.equal(resolveSettingsPage('general', []), null)
})

test('settingsTarget maps a section to its page; unknown ids open the default page', () => {
  assert.deepEqual(settingsTarget('todoist-sync'), { page: 'connections', section: 'todoist-sync' })
  assert.deepEqual(settingsTarget('demo'), { page: 'general', section: 'demo' })
  assert.deepEqual(settingsTarget('today-brief'), { page: 'brief', section: 'today-brief' })
  assert.deepEqual(settingsTarget('momentum'), { page: 'brief', section: 'momentum' })
  assert.deepEqual(settingsTarget('activity'), { page: 'activity', section: 'activity' })
  assert.deepEqual(settingsTarget('no-such-section'), { page: 'general', section: null })
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

test('Today & brief sections are desktop-only and named for the addendum', () => {
  const brief = SETTINGS_SECTIONS.filter((s) => s.page === 'brief')
  assert.deepEqual(brief.map((s) => [s.id, s.label]), [
    ['today-brief', 'Brief'], ['today-location', 'Location & weather'], ['today-boxes', 'Boxes'], ['momentum', 'Goals & momentum'],
  ])
  // Lane A's sections need brief settings; Lane C's needs the Mac's momentum ledger.
  for (const s of brief) assert.equal(s.requires, s.id === 'momentum' ? 'momentum' : 'briefSettings', s.id)
  assert.ok(!visiblePages(visibleSections(NONE)).some((p) => p.id === 'brief'), 'the web never shows the page')
  assert.deepEqual(settingsTarget('today-location'), { page: 'brief', section: 'today-location' })
})
