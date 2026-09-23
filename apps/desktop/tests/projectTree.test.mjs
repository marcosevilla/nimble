import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleProjectKeys } from '../src/lib/projectTree.ts'
import { pickRovingKey } from '../src/lib/docsTree.ts'

const roots = [{ id: 'inbox' }, { id: 'personal' }, { id: 'work' }]
const childrenByParent = { personal: [{ id: 'home' }, { id: 'health' }] }

test('keys list All tasks, then roots with their open children, in render order', () => {
  assert.deepEqual(
    visibleProjectKeys({ roots, childrenByParent, collapsed: new Set() }),
    ['all', 'project:inbox', 'project:personal', 'project:home', 'project:health', 'project:work'],
  )
})

test('a collapsed parent hides its children', () => {
  assert.deepEqual(
    visibleProjectKeys({ roots, childrenByParent, collapsed: new Set(['personal']) }),
    ['all', 'project:inbox', 'project:personal', 'project:work'],
  )
})

test('the tab stop falls back to the selection, then All tasks, when the focused row is gone', () => {
  const keys = visibleProjectKeys({ roots, childrenByParent, collapsed: new Set(['personal']) })
  // focused child hidden by a collapse → the selection takes the tab stop
  assert.equal(pickRovingKey(keys, 'project:home', 'project:work'), 'project:work')
  // focused project deleted and nothing selected → All tasks
  assert.equal(pickRovingKey(keys, 'project:deleted', null), 'all')
})
