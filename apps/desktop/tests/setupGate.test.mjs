import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SETUP_REQUIRED_KEYS } from '../src/lib/setupGate.ts'

// Brief phase 2 (addendum §3): nothing is required before the app runs.
// The two lists stay pinned together so neither can grow back alone.
test('nothing is required before the app runs, in Rust or here', () => {
  const rs = readFileSync(new URL('../../../nimble-core/src/db/settings.rs', import.meta.url), 'utf8')
  const block = rs.match(/REQUIRED_SETTINGS[^=]*=\s*&\[([\s\S]*?)\]/)
  assert.ok(block, 'REQUIRED_SETTINGS not found in settings.rs')
  const rustKeys = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(rustKeys, [])
  assert.deepEqual([...SETUP_REQUIRED_KEYS], [])
})
