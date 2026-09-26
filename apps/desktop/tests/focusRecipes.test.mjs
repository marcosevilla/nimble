import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Source gates for loop 4 P2-13 (focus). Each names the site it closes.
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('stray ring recipes are gone: .focus-ring / .focus-ring-inset / .focus-ring-roving only', () => {
  assert.doesNotMatch(read('components/today/BoxesList.tsx'), /focus:ring-/)
  assert.match(read('components/today/BoxesList.tsx'), /focus-ring-roving/)
  assert.doesNotMatch(read('components/focus/FocusQueueList.tsx'), /focus:outline-/)
  assert.doesNotMatch(read('components/omnibar/OmnibarRows.tsx'), /focus:ring-/)
  assert.doesNotMatch(read('components/settings/LabelManager.tsx'), /focus-visible:ring-/)
  for (const f of ['components/tasks/TaskItem.tsx', 'components/pages/InboxPage.tsx', 'components/detail/TaskDetailPage.tsx']) {
    assert.doesNotMatch(read(f), /focus-visible:-outline-offset-2/, f)
  }
})

test('the global :focus-visible ring follows the parent radius', () => {
  assert.match(read('index.css'), /:focus-visible \{[^}]*border-radius: inherit;/)
})

test('hover-only reveals also reveal on keyboard focus', () => {
  assert.match(read('components/shared/CollapsibleSection.tsx'), /group-hover\/section:opacity-100 group-focus-within\/section:opacity-100/)
  assert.match(read('components/goals/HabitsSection.tsx'), /group-hover:opacity-100 group-focus-within:opacity-100/)
  assert.match(read('components/detail/GoalDetailPage.tsx'), /group-hover:opacity-100 group-focus-within:opacity-100/)
  const labels = read('components/settings/LabelManager.tsx')
  assert.match(labels, /group-hover\/row:opacity-100 group-focus-within\/row:opacity-100/)
  assert.match(labels, /group-hover:opacity-100 group-focus-within:opacity-100/)
})

test('click-to-edit text is keyboard-operable', () => {
  for (const f of ['components/detail/InlineDescription.tsx', 'components/detail/GoalDetailPage.tsx']) {
    const src = read(f)
    assert.match(src, /tabIndex=\{0\}/, f)
    assert.match(src, /e\.key === 'Enter' \|\| e\.key === ' '/, f)
  }
  const detail = read('components/detail/TaskDetailPage.tsx')
  assert.equal(detail.match(/onKeyDown=\{editDescriptionKey\}/g)?.length, 2)
})

test('a written description is never inside a button (its text stays readable, links not nested)', () => {
  const detail = read('components/detail/TaskDetailPage.tsx')
  assert.doesNotMatch(detail, /aria-label="Edit description"/)
  assert.match(detail, /role="group"\s+tabIndex=\{0\}\s+aria-label="Description"\s+aria-describedby=\{descHintId\}/)
  const inline = read('components/detail/InlineDescription.tsx')
  assert.doesNotMatch(inline, /Edit description/)
  assert.match(inline, /role=\{value \? 'group' : 'button'\}/)
})
