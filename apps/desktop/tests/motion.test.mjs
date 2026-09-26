import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { motionMs, parseDurationMs, taskCompleteDelayMs } from '../src/lib/motion.ts'

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('parseDurationMs reads the forms a computed custom property takes', () => {
  assert.equal(parseDurationMs('220ms'), 220)
  assert.equal(parseDurationMs(' .15s'), 150)
  assert.equal(parseDurationMs('0.32s'), 320)
  assert.equal(parseDurationMs('0s'), 0)
  assert.equal(parseDurationMs(''), null)
  assert.equal(parseDurationMs('var(--x)'), null)
  assert.equal(parseDurationMs('-5ms'), null)
})

test('motionMs falls back to the CSS values without a DOM', () => {
  assert.equal(motionMs('--transition-fast'), 150)
  assert.equal(motionMs('--transition-base'), 220)
  assert.equal(motionMs('--transition-slow'), 320)
  assert.equal(taskCompleteDelayMs(), 580)
})

test('motionMs is 0 under reduced motion, except the task-complete beat', () => {
  const had = globalThis.matchMedia
  globalThis.matchMedia = (q) => ({ matches: q.includes('reduce') })
  try {
    assert.equal(motionMs('--transition-base'), 0)
    assert.equal(motionMs('--motion-task-complete'), 600)
  } finally {
    globalThis.matchMedia = had
  }
})

test('bare transition utilities take the motion tokens (loop 4 P2-18)', () => {
  const css = read('index.css')
  assert.match(css, /--default-transition-duration:\s*var\(--transition-fast\)/)
  assert.match(css, /--default-transition-timing-function:\s*var\(--ease-entrance\)/)
  // The task-complete keyframe and its JS timer share one token.
  assert.match(css, /task-complete-exit var\(--motion-task-complete\)/)
  assert.match(css, /--motion-task-complete:\s*600ms/)
})

test('JS timers that wait out CSS read the tokens, not literals', () => {
  assert.doesNotMatch(read('components/omnibar/Omnibar.tsx'), /CLOSE_MS/)
  assert.match(read('components/omnibar/Omnibar.tsx'), /motionMs\('--transition-base'\)/)
  assert.match(read('components/shared/HelpPanel.tsx'), /motionMs\('--transition-fast'\)/)
  assert.doesNotMatch(read('components/tasks/StatusDropdown.tsx'), /\b580\b/)
  assert.doesNotMatch(read('components/shared/BulkActionBar.tsx'), /\+ 580\b/)
})

test('enter-only surfaces now leave with .panel-out', () => {
  for (const f of [
    'components/tasks/SelectionActionBar.tsx',
    'components/shared/SyncHealthBanner.tsx',
    'components/shared/CaptureStrip.tsx',
    'components/shared/BulkActionBar.tsx',
  ]) assert.match(read(f), /'panel-out'/, f)
})
