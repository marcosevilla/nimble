import assert from 'node:assert/strict'
import test from 'node:test'
import { cycleLabelInFilter, matchesLabelFilter } from './labelFilter.ts'

test('label filter: include requires all, exclude forbids any', () => {
  assert.equal(matchesLabelFilter(['nimble', 'admin'], { include: ['nimble'], exclude: [] }), true)
  assert.equal(matchesLabelFilter(['admin'], { include: ['nimble'], exclude: [] }), false)
  assert.equal(matchesLabelFilter(['admin'], { include: [], exclude: ['nimble'] }), true) // "from Todoist"
  assert.equal(matchesLabelFilter(['nimble'], { include: [], exclude: ['nimble'] }), false)
  assert.equal(matchesLabelFilter([], { include: [], exclude: [] }), true)
})

test('cycleLabelInFilter: off -> include -> exclude -> off, other labels untouched', () => {
  let f = { include: ['other'], exclude: [] }
  f = cycleLabelInFilter(f, 'nimble')
  assert.deepEqual(f, { include: ['other', 'nimble'], exclude: [] })
  f = cycleLabelInFilter(f, 'nimble')
  assert.deepEqual(f, { include: ['other'], exclude: ['nimble'] })
  f = cycleLabelInFilter(f, 'nimble')
  assert.deepEqual(f, { include: ['other'], exclude: [] })
})

test('cycleLabelInFilter does not mutate its input', () => {
  const f = { include: [], exclude: [] }
  const next = cycleLabelInFilter(f, 'nimble')
  assert.deepEqual(f, { include: [], exclude: [] })
  assert.deepEqual(next, { include: ['nimble'], exclude: [] })
})
