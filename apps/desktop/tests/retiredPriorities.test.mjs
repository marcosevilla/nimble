import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src')
const files = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [])

test('Today no longer generates Haiku priorities (phase 3 composes them in Rust)', () => {
  const offenders = files(src)
    .filter((f) => !f.includes(`${path.sep}services${path.sep}`)) // the provider keeps the deprecated method
    .filter((f) => /useDailyPriorities|generatePriorities\s*\(|\.generatePriorities\b/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(src, f))
  assert.deepEqual(offenders, [])
  assert.equal(fs.existsSync(path.join(src, 'hooks/useDailyPriorities.ts')), false)
})
