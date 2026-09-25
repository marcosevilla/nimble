import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const COMMANDS = ['brief_settings_get', 'brief_settings_save', 'brief_set_notes', 'weather_get', 'weather_geocode']

// A command missing from any of these fails only in the real app (lib.rs),
// only on desktop (tauri.ts) or only in the browser harness (mock).
test('every phase-2 brief command is registered, wrapped and mocked', () => {
  const lib = read('../src-tauri/src/lib.rs')
  const wrappers = read('../src/services/tauri.ts')
  const mock = read('../../../tools/mock-tauri.js')
  for (const cmd of COMMANDS) {
    assert.match(lib, new RegExp(`::${cmd},`), `lib.rs invoke_handler lists ${cmd}`)
    assert.ok(wrappers.includes(`'${cmd}'`), `services/tauri.ts wraps ${cmd}`)
    assert.match(mock, new RegExp(`\\b${cmd}: function`), `mock-tauri.js mocks ${cmd}`)
  }
})
