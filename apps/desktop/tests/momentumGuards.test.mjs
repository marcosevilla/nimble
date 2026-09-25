import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SURFACES = [
  'src/components/today/MomentumBox.tsx',
  'src/components/activity/StatTiles.tsx',
  'src/components/settings/MomentumSettings.tsx',
]
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('momentum surfaces use no red or destructive tokens (no-guilt rule)', () => {
  for (const file of SURFACES) {
    assert.doesNotMatch(read(file), /destructive|text-red|bg-red|border-red|--error|toast\.error/, file)
  }
})

test('meters fill with --success on a neutral track; the trend is amber', () => {
  const src = read('src/components/today/MomentumBox.tsx')
  assert.match(src, /bg-success/)
  assert.match(src, /bg-muted/)
  assert.match(src, /bg-\(--heat-3\)/)
})

test('stats use tabular figures', () => {
  assert.match(read('src/components/activity/StatTiles.tsx'), /tabular-nums/)
})
