// Companion window geometry: pure math, no native window. Sizes are logical
// pixels. Returned width/height are the INNER (content) size Tauri sets;
// the native titlebar (chrome) must still fit inside the work area.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPANION_WIDTH,
  COMPACT_MAX_WIDTH,
  EXPANDED_DEFAULT_HEIGHT,
  EXPANDED_MAX_HEIGHT,
  EXPANDED_MIN_HEIGHT,
  clampFocusPosition,
  companionMotionMs,
  defaultFocusPosition,
  fitExpandedWindow,
  fitFocusWindow,
  parseStoredSize,
} from '../src/lib/focusWindow.ts'

const fitsIn = (x, chrome, area) => x.width <= area.width && x.height + chrome <= area.height

test('compact geometry includes chrome and fits current display', () => {
  const x = fitFocusWindow(1020, 300, 28, { width: 800, height: 700 })
  assert.ok(x.width <= 800); assert.ok(x.height <= 700)
  assert.ok(x.scale >= 1 && x.scale <= 3)
  assert.ok(fitsIn(x, 28, { width: 800, height: 700 }))
})

test('baseline constants follow the spec', () => {
  assert.equal(COMPANION_WIDTH, 340)
  assert.equal(COMPACT_MAX_WIDTH, 1020)
  assert.equal(EXPANDED_DEFAULT_HEIGHT, 560)
  assert.deepEqual([EXPANDED_MIN_HEIGHT, EXPANDED_MAX_HEIGHT], [420, 640])
})

test('compact card scales proportionally from 340 to min(1020, work area)', () => {
  const big = { width: 2560, height: 1440 }
  const base = fitFocusWindow(340, 200, 28, big)
  assert.deepEqual([base.width, base.height, base.scale, base.overflow], [340, 200, 1, false])
  const double = fitFocusWindow(680, 200, 28, big)
  assert.deepEqual([double.width, double.height, double.scale], [680, 400, 2])
  const max = fitFocusWindow(5000, 200, 28, big)
  assert.equal(max.width, 1020)
  assert.equal(max.scale, 3)
  // Below the baseline width never shrinks the card under 1x.
  const tiny = fitFocusWindow(100, 200, 28, big)
  assert.deepEqual([tiny.width, tiny.scale], [340, 1])
  // Work area narrower than 1020 caps the width.
  const laptop = fitFocusWindow(5000, 100, 28, { width: 900, height: 1000 })
  assert.equal(laptop.width, 900)
  assert.ok(Math.abs(laptop.scale - 900 / 340) < 1e-9)
})

test('long title/subtask card lowers scale to fit height, then scrolls at 1x', () => {
  const area = { width: 1440, height: 900 }
  const tall = fitFocusWindow(1020, 600, 28, area)
  assert.ok(fitsIn(tall, 28, area))
  assert.ok(tall.scale >= 1 && tall.scale < 3)
  assert.equal(tall.width, Math.round(COMPANION_WIDTH * tall.scale))
  assert.equal(tall.overflow, false)
  const huge = fitFocusWindow(1020, 5000, 28, area)
  assert.equal(huge.scale, 1)
  assert.equal(huge.width, 340)
  assert.equal(huge.height, 900 - 28)
  assert.equal(huge.overflow, true)
})

test('monitor narrower than 340 falls back to a scrollable 1x window', () => {
  const area = { width: 300, height: 400 }
  const compact = fitFocusWindow(1020, 250, 28, area)
  assert.deepEqual([compact.width, compact.scale, compact.overflow], [300, 1, true])
  assert.ok(fitsIn(compact, 28, area))
  const expanded = fitExpandedWindow(560, 28, area)
  assert.deepEqual([expanded.width, expanded.scale, expanded.overflow], [300, 1, true])
  assert.ok(fitsIn(expanded, 28, area))
})

test('titlebar 0 versus 28 changes only what must fit the work area', () => {
  const roomy = { width: 1440, height: 900 }
  assert.equal(fitFocusWindow(340, 300, 0, roomy).height, fitFocusWindow(340, 300, 28, roomy).height)
  const short = { width: 1440, height: 500 }
  const bare = fitExpandedWindow(640, 0, short)
  const titled = fitExpandedWindow(640, 28, short)
  assert.equal(bare.height, 500)
  assert.equal(titled.height, 472)
  const compactBare = fitFocusWindow(340, 800, 0, short)
  const compactTitled = fitFocusWindow(340, 800, 28, short)
  assert.equal(compactBare.height, 500)
  assert.equal(compactTitled.height, 472)
})

test('expanded height defaults to 560 and clamps to 420-640', () => {
  const area = { width: 1440, height: 900 }
  assert.deepEqual(fitExpandedWindow(Number.NaN, 28, area), { width: 340, height: 560, scale: 1, overflow: false })
  assert.equal(fitExpandedWindow(100, 28, area).height, 420)
  assert.equal(fitExpandedWindow(2000, 28, area).height, 640)
  assert.equal(fitExpandedWindow(500.6, 28, area).height, 501)
})

test('restore after monitor removal clamps stored size and position into the current work area', () => {
  // Stored on a 2560-wide display; now only a 1280x720 laptop remains.
  const laptop = { x: 0, y: 25, width: 1280, height: 695 }
  const size = fitFocusWindow(1020, 300, 28, laptop)
  assert.ok(fitsIn(size, 28, laptop))
  const pos = clampFocusPosition({ x: 2200, y: 1300 }, size, 28, laptop)
  assert.ok(pos.x >= laptop.x && pos.x + size.width <= laptop.x + laptop.width)
  assert.ok(pos.y >= laptop.y && pos.y + size.height + 28 <= laptop.y + laptop.height)
  // A window already on screen is left where it is.
  assert.deepEqual(clampFocusPosition({ x: 100, y: 100 }, { width: 340, height: 300 }, 28, laptop), { x: 100, y: 100 })
  // Oversized windows pin to the work area's origin instead of going negative.
  assert.deepEqual(clampFocusPosition({ x: -500, y: -500 }, { width: 5000, height: 5000 }, 28, laptop), { x: 0, y: 25 })
})

test('default position is the top-right corner of the work area with a margin', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 }
  assert.deepEqual(defaultFocusPosition({ width: 340, height: 560 }, area), { x: 1440 - 340 - 16, y: 25 + 16 })
})

test('stored sizes reject corrupt values and fall back', () => {
  assert.equal(parseStoredSize(null, 560), 560)
  assert.equal(parseStoredSize('abc', 560), 560)
  assert.equal(parseStoredSize('-40', 560), 560)
  assert.equal(parseStoredSize('Infinity', 340), 340)
  assert.equal(parseStoredSize('612.4', 560), 612)
})

test('expand/collapse motion uses the Nimble base token and is immediate under reduced motion', () => {
  assert.equal(companionMotionMs(false), 220)
  assert.equal(companionMotionMs(true), 0)
})
