import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesLabelFilter } from './labelFilter.ts'

test('label filter: include requires all, exclude forbids any', () => {
  assert.equal(matchesLabelFilter(['nimble', 'admin'], { include: ['nimble'], exclude: [] }), true)
  assert.equal(matchesLabelFilter(['admin'], { include: ['nimble'], exclude: [] }), false)
  assert.equal(matchesLabelFilter(['admin'], { include: [], exclude: ['nimble'] }), true) // "from Todoist"
  assert.equal(matchesLabelFilter(['nimble'], { include: [], exclude: ['nimble'] }), false)
  assert.equal(matchesLabelFilter([], { include: [], exclude: [] }), true)
})
