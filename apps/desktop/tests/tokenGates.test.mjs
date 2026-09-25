import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Source gates for the re-score token leftovers (1b item v). Each names the
// finding it closes; a regression reintroduces the literal.
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('the activity heatmap reads its ramp from theme tokens (session N-P1-1)', () => {
  assert.doesNotMatch(read('components/activity/ActivityHeatmap.tsx'), /oklch\(/)
  const css = read('themes.css')
  for (const token of ['--heat-1', '--heat-2', '--heat-3', '--heat-4', '--heat-empty']) {
    assert.match(css, new RegExp(`${token}:`), token)
  }
})

test('the command bar quoted query uses the strong body token (shell P1-7)', () => {
  const src = read('components/omnibar/OmnibarResults.tsx')
  assert.doesNotMatch(src, /truncate font-medium/)
  assert.match(src, /truncate text-body-strong/)
})

test('the habit ✓ badge has no font-bold stack (goals P1-6)', () => {
  assert.doesNotMatch(read('components/goals/HabitsSection.tsx'), /font-bold/)
})

test('SettingsPage has no template-literal classNames (settings N-P1-1)', () => {
  assert.doesNotMatch(read('components/pages/SettingsPage.tsx'), /className=\{`/)
})

test('the completion flash reads the --success-tint token (Stage C deferred minor)', () => {
  const css = read('index.css')
  assert.doesNotMatch(css, /oklch\(0\.85 0\.1 145/)
  const frames = css.match(/@keyframes task-complete-(exit|fade) \{[^}]*\{[^}]*\}[^}]*\{[^}]*\}/g) ?? []
  assert.equal(frames.length, 2)
  for (const f of frames) assert.match(f, /var\(--success-tint\)/)
  assert.match(read('themes.css'), /--success-tint:/)
  assert.match(css, /--color-success-tint: var\(--success-tint\)/)
})
