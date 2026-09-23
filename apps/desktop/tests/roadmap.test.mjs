import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseRoadmap } from '../src/lib/roadmap.ts'

// The Help panel's Roadmap tab is built from NEXT.md at build time. Only
// checkbox items count; prose bullets and sections without any are skipped.

const SAMPLE = `# Title

Intro prose.

## First — 2026-09-22

Plan \`docs/plan.md\` · prose line.

- [x] Done **bold** thing with [a link](docs/x.md) and \`code\`.
- [ ] **Next: open item**
- plain bullet, not a roadmap item
  - [ ] nested open item

## Prose only

- no checkboxes here

## Second

- [X] Upper-case done
- [ ] Another open
`

test('groups checkbox items under their ## section, in file order', () => {
  const sections = parseRoadmap(SAMPLE)
  assert.deepEqual(sections.map((s) => s.title), ['First — 2026-09-22', 'Second'])
  assert.deepEqual(
    sections[0].items.map((i) => [i.done, i.text]),
    [
      [true, 'Done bold thing with a link and code.'],
      [false, 'Next: open item'],
      [false, 'nested open item'],
    ],
  )
  assert.deepEqual(sections[1].items.map((i) => i.done), [true, false])
})

test('empty or checkbox-free input yields no sections', () => {
  assert.deepEqual(parseRoadmap(''), [])
  assert.deepEqual(parseRoadmap('# T\n\n## S\n\n- nothing'), [])
})

test('the real NEXT.md parses into a non-empty roadmap with open items', () => {
  const md = fs.readFileSync(new URL('../../../NEXT.md', import.meta.url), 'utf8')
  const sections = parseRoadmap(md)
  const items = sections.flatMap((s) => s.items)
  assert.ok(sections.length >= 3)
  assert.ok(items.some((i) => !i.done))
  assert.ok(items.every((i) => i.text.length > 0 && !i.text.includes('**')))
})
