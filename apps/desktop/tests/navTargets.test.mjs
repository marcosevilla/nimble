import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_IDS, DEFAULT_NAV_ORDER, resolveNavTarget, normalizeNavOrder } from '../src/lib/navTargets.ts'
import { G_PREFIX_PAGES } from '../src/lib/shortcuts.ts'
import { SETTINGS_PAGES } from '../src/lib/settingsSections.ts'

test('session is no longer a page or a nav item', () => {
  assert.ok(!PAGE_IDS.includes('session'))
  assert.ok(!DEFAULT_NAV_ORDER.includes('session'))
  assert.deepEqual([...DEFAULT_NAV_ORDER], ['today', 'tasks', 'inbox', 'docs', 'goals'])
})

test('every page id resolves to itself', () => {
  for (const id of PAGE_IDS) assert.deepEqual(resolveNavTarget(id), { page: id })
})

test('the retired session page and `activity` open Settings → Activity', () => {
  const target = { page: 'settings', settingsPage: 'activity' }
  assert.deepEqual(resolveNavTarget('session'), target)
  assert.deepEqual(resolveNavTarget('activity'), target)
  assert.ok(SETTINGS_PAGES.some((p) => p.id === 'activity'), 'the Settings sub-page exists')
})

test('unknown or empty ids go nowhere (inherited keys included)', () => {
  for (const id of ['nope', '', null, undefined, 'toString', '__proto__']) {
    assert.equal(resolveNavTarget(id), null, String(id))
  }
})

test('every g-prefix target resolves', () => {
  for (const [key, id] of Object.entries(G_PREFIX_PAGES)) {
    assert.ok(resolveNavTarget(id), `g ${key} → ${id}`)
  }
  assert.deepEqual(resolveNavTarget(G_PREFIX_PAGES.s), { page: 'settings', settingsPage: 'activity' })
})

test('a persisted order holding `session` loses it and keeps the rest in place', () => {
  assert.deepEqual(
    normalizeNavOrder(['goals', 'session', 'today', 'tasks', 'inbox', 'docs']),
    ['goals', 'today', 'tasks', 'inbox', 'docs'],
  )
  // The old default order, as saved before the move
  assert.deepEqual(normalizeNavOrder(['today', 'tasks', 'inbox', 'docs', 'goals', 'session']), [...DEFAULT_NAV_ORDER])
})

test('normalizeNavOrder drops unknowns and duplicates, appends missing pages', () => {
  assert.deepEqual(normalizeNavOrder(['docs', 'docs', 'focus', 42, 'today']), ['docs', 'today', 'tasks', 'inbox', 'goals'])
  assert.deepEqual(normalizeNavOrder([]), [...DEFAULT_NAV_ORDER])
})

test('normalizeNavOrder falls back to the default for non-array input', () => {
  for (const bad of [null, undefined, 'today', { 0: 'today' }, 7]) {
    assert.deepEqual(normalizeNavOrder(bad), [...DEFAULT_NAV_ORDER], JSON.stringify(bad))
  }
})
