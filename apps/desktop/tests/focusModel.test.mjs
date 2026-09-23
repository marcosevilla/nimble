import test from 'node:test'
import assert from 'node:assert/strict'
import { timerPresentation, formatDurationMs } from '../src/lib/focusModel.ts'

const MIN = 60000

test('count up never becomes red and timebox continues overtime', () => {
  assert.equal(timerPresentation(25 * MIN, null).phase, 'amber')
  assert.equal(timerPresentation(45 * MIN, null).phase, 'deepAmber')
  assert.equal(timerPresentation(60 * MIN, null).phase, 'deepAmber')
  assert.equal(timerPresentation(16 * MIN, 15 * MIN).phase, 'overtime')
})

test('count-up thresholds sit exactly at 25 and 45 minutes', () => {
  assert.equal(timerPresentation(25 * MIN - 1, null).phase, 'normal')
  assert.equal(timerPresentation(45 * MIN - 1, null).phase, 'amber')
  assert.equal(timerPresentation(10 * 60 * MIN, null).phase, 'deepAmber')
})

test('count-up shows accumulated time; hours appear only when needed', () => {
  assert.deepEqual(timerPresentation(0, null), { text: '0:00', phase: 'normal' })
  assert.equal(timerPresentation(59_999, null).text, '0:59')
  assert.equal(timerPresentation(25 * MIN, null).text, '25:00')
  assert.equal(timerPresentation(65 * MIN + 5000, null).text, '1:05:05')
})

test('timebox counts down, reaches zero without overtime, then counts overtime in red', () => {
  assert.deepEqual(timerPresentation(0, 15 * MIN), { text: '15:00', phase: 'normal' })
  // Amber/deep-amber are count-up cues; an unexpired timebox stays neutral.
  assert.deepEqual(timerPresentation(14 * MIN + 30_000, 15 * MIN), { text: '0:30', phase: 'normal' })
  assert.deepEqual(timerPresentation(15 * MIN, 15 * MIN), { text: '0:00', phase: 'normal' })
  assert.deepEqual(timerPresentation(15 * MIN + 1, 15 * MIN), { text: '+0:00', phase: 'overtime' })
  assert.deepEqual(timerPresentation(16 * MIN, 15 * MIN), { text: '+1:00', phase: 'overtime' })
  // Budget lowered below existing elapsed: overtime immediately.
  assert.deepEqual(timerPresentation(50 * MIN, 25 * MIN), { text: '+25:00', phase: 'overtime' })
})

test('display rounding floors whole seconds and never shows negative or NaN time', () => {
  assert.equal(timerPresentation(1999, null).text, '0:01')
  assert.deepEqual(timerPresentation(-5000, null), { text: '0:00', phase: 'normal' })
  assert.deepEqual(timerPresentation(Number.NaN, null), { text: '0:00', phase: 'normal' })
  assert.equal(formatDurationMs(90 * MIN), '1:30:00')
  assert.equal(formatDurationMs(-1), '0:00')
})
