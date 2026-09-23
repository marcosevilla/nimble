import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SETUP_REQUIRED_KEYS, isSetupReady } from '../src/lib/setupGate.ts'

// The launch check (nimble-core check_setup_complete) decides whether setup
// reappears. The dialog must demand exactly the keys it reads, or first run loops.
test('setup requires exactly the keys the Rust launch check reads', () => {
  const rs = readFileSync(new URL('../../../nimble-core/src/db/settings.rs', import.meta.url), 'utf8')
  const block = rs.match(/REQUIRED_SETTINGS[^=]*=\s*&\[([\s\S]*?)\]/)
  assert.ok(block, 'REQUIRED_SETTINGS not found in settings.rs')
  const rustKeys = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
  assert.deepEqual([...SETUP_REQUIRED_KEYS].sort(), rustKeys)
  assert.ok(!SETUP_REQUIRED_KEYS.includes('ical_feed_url'))
})

test('get started stays disabled until every required field is filled', () => {
  const full = {
    todoist_api_token: 't',
    ical_feed_url: 'https://calendar.google.com/calendar/ical/x/basic.ics',
    obsidian_vault_path: '~/Obsidian/marcowits',
    anthropic_api_key: 'k',
  }
  assert.equal(isSetupReady(full), true)
  assert.equal(isSetupReady({}), false)
  assert.equal(isSetupReady({ obsidian_vault_path: '~/Obsidian/marcowits' }), false)
  const { ical_feed_url: _omit, ...noIcal } = full
  assert.equal(isSetupReady(noIcal), true, 'the calendar is optional')
  assert.equal(isSetupReady({ ...full, anthropic_api_key: '   ' }), false)
})
