import test from 'node:test'
import assert from 'node:assert/strict'
import { planTaskDelete, deleteConfirmTitle } from '../src/lib/deletePlan.ts'

// Review I1: deletes that cascade to subtasks confirm instead of offering a
// lossy Undo; leaf deletes keep the Undo.

const t = (id, parent_id = null) => ({ id, parent_id })
const all = [t('a'), t('a1', 'a'), t('a2', 'a'), t('a1x', 'a1'), t('b'), t('c')]

test('a leaf delete needs no confirm', () => {
  const plan = planTaskDelete([t('b')], all)
  assert.deepEqual(plan.roots.map((r) => r.id), ['b'])
  assert.equal(plan.subtaskCount, 0)
  assert.equal(plan.needsConfirm, false)
})

test('a subtask with no children of its own is a leaf', () => {
  assert.equal(planTaskDelete([t('a2', 'a')], all).needsConfirm, false)
})

test('a parent counts its subtasks at every depth and needs a confirm', () => {
  const plan = planTaskDelete([t('a')], all)
  assert.equal(plan.subtaskCount, 3)
  assert.equal(plan.needsConfirm, true)
})

test('a selected child of a selected parent is left to the cascade', () => {
  const plan = planTaskDelete([t('a'), t('a1', 'a'), t('b')], all)
  assert.deepEqual(plan.roots.map((r) => r.id), ['a', 'b'])
  assert.equal(plan.subtaskCount, 3)
})

test('confirm copy is sentence case and pluralised', () => {
  assert.equal(deleteConfirmTitle(1, 1), 'Delete this task and its 1 subtask?')
  assert.equal(deleteConfirmTitle(1, 3), 'Delete this task and its 3 subtasks?')
  assert.equal(deleteConfirmTitle(2, 4), 'Delete 2 tasks and their 4 subtasks?')
})
