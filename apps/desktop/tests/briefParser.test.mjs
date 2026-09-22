import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBrief, isOpenByDefault } from '../src/lib/briefParser.ts'

const brief = `---
date: 2026-09-15
---
# Brief 2026-09-15

## ⏰ Admin Deadlines
- EDD certification

## Overdue Check-in
- Portfolio case study

## 🎯 Work
- Ship it
`

test('"Overdue Check-in" is displayed as "Still open"', () => {
  const { sections } = parseBrief(brief)
  assert.equal(sections[1].title, 'Still open')
})

test('a leading emoji and its space are stripped from section titles', () => {
  const { sections } = parseBrief(brief)
  assert.equal(sections[0].title, 'Admin Deadlines')
  assert.equal(sections[2].title, 'Work')
})

test('default-open is keyed on the normalised title, so "🎯 Work" opens by default', () => {
  const { sections } = parseBrief(brief)
  assert.equal(isOpenByDefault(sections[2].title), true)
  assert.equal(isOpenByDefault(sections[0].title), false)
  assert.equal(sections[2].content, '- Ship it')
})
