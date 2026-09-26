import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROJECT_COLOR, FEED_COLORS, GOAL_COLORS, PROJECT_COLORS, ROUTE_COLORS, swatchName } from '../src/lib/swatches.ts'

test('palettes keep their stored values and order (rows hold the hex)', () => {
  assert.deepEqual(PROJECT_COLORS, ['#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#f43f5e', '#8b5cf6', '#14b8a6'])
  assert.deepEqual(GOAL_COLORS, ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'])
  assert.deepEqual(FEED_COLORS, ['#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#f43f5e'])
  assert.deepEqual(ROUTE_COLORS, ['#f59e0b', '#3b82f6', '#22c55e', '#ec4899', '#6366f1', '#ef4444', '#06b6d4'])
  assert.equal(DEFAULT_PROJECT_COLOR, '#6366f1')
})

test('every swatch has a human name; unknown hexes fall back', () => {
  for (const hex of [...PROJECT_COLORS, ...GOAL_COLORS, ...FEED_COLORS, ...ROUTE_COLORS]) {
    assert.match(swatchName(hex), /^[A-Z][a-z]+$/, hex)
  }
  assert.equal(swatchName('#6366F1'), 'Indigo')
  assert.equal(swatchName('#123456'), '#123456')
})
