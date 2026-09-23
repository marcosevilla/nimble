import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProjectTree } from './projectTree.ts'

const p = (id, parent_id = null, archived_at = null) =>
  ({ id, name: id, color: '', position: 0, parent_id, archived_at })

test('hides archived and nests children', () => {
  const t = buildProjectTree([p('inbox'), p('personal'), p('finance', 'personal'), p('dead', null, '2026-09-23')])
  assert.deepEqual(t.roots.map((r) => r.id), ['inbox', 'personal'])
  assert.deepEqual(t.childrenByParent.personal.map((c) => c.id), ['finance'])
})

test('orphan child of archived parent becomes a root', () => {
  assert.deepEqual(
    buildProjectTree([p('old', null, '2026-09-23'), p('kid', 'old')]).roots.map((r) => r.id),
    ['kid'],
  )
})
