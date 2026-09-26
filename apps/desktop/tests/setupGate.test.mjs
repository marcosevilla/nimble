import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Brief phase 2 (addendum §3) emptied the first-run gate: nothing is
// required before the app runs, the Today setup is the onboarding. The gate
// itself (checkSetupComplete, App's setupComplete loading screen, Rust's
// check_setup_complete / REQUIRED_SETTINGS) is gone, so it can't grow back
// into a blocking screen.
const dir = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const roots = [dir('../src'), dir('../../../packages/types/src'), dir('../src-tauri/src'), dir('../../../nimble-core/src')]

function files(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name)
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|rs)$/.test(name) ? [p] : []
  })
}

test('the first-run setup gate is gone from the app, the contract and Rust', () => {
  const hits = roots.flatMap(files).filter((f) =>
    /checkSetupComplete|setupComplete|SetupComplete|check_setup_complete|REQUIRED_SETTINGS/.test(readFileSync(f, 'utf8')),
  )
  assert.deepEqual(hits, [])
  assert.equal(existsSync(dir('../src/lib/setupGate.ts')), false)
})
