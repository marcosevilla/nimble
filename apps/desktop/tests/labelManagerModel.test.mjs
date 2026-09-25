import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDrop, applyToTaxonomy, flattenManager, fullLabelOrder, moveByKey, nextGroupName, UNGROUPED_KEY } from '../src/lib/labelManagerModel.ts'
import { managerSections } from '../src/lib/labelTaxonomy.ts'

const g = (id, position, extra = {}) => ({ id, name: id.toUpperCase(), position, exclusive: false, system: false, created_at: 'x', updated_at: 'x', ...extra })
const l = (id, position, group = null, archived_at = null) => ({ id, name: id, color: 'gray', position, group, archived_at, created_at: 'x' })
const groups = [g('effort', 0), g('type', 1), g('sys', 2, { system: true })]
const labels = [l('deep', 0, 'effort'), l('quick', 1, 'effort'), l('comms', 2, 'type'), l('loose', 3), l('bot', 4, 'sys'), l('old', 5, null, 'then')]
const model = managerSections(labels, groups)
const items = flattenManager(model)
const keys = (xs) => xs.map((i) => i.key)

test('flatten: headers then their labels, Ungrouped last; system and archived stay out', () => {
  assert.deepEqual(keys(items), ['group:effort', 'label:deep', 'label:quick', 'group:type', 'label:comms', UNGROUPED_KEY, 'label:loose'])
})

test('drop a label into another group: it moves and the order is reported', () => {
  const r = applyDrop(items, 'label:loose', 'label:comms')
  assert.deepEqual(r.moved, { labelId: 'loose', groupId: 'type' })
  assert.deepEqual(r.labelOrder, ['deep', 'quick', 'loose', 'comms'])
})

test('drop a label on the Ungrouped header ungroups it', () => {
  assert.deepEqual(applyDrop(items, 'label:deep', UNGROUPED_KEY).moved, { labelId: 'deep', groupId: null })
})

test('reorder inside a group keeps membership', () => {
  const r = applyDrop(items, 'label:quick', 'label:deep')
  assert.equal(r.moved, undefined)
  assert.deepEqual(r.labelOrder.slice(0, 2), ['quick', 'deep'])
})

test('a label never lands above the first header', () => {
  const r = applyDrop(items, 'label:comms', 'group:effort')
  assert.equal(keys(r.items)[0], 'group:effort')
  assert.deepEqual(r.moved, { labelId: 'comms', groupId: 'effort' })
})

test('drag a group: the whole block moves, Ungrouped stays last, no-op is null', () => {
  const r = applyDrop(items, 'group:type', 'group:effort')
  assert.deepEqual(r.groupOrder, ['type', 'effort'])
  assert.deepEqual(keys(r.items), ['group:type', 'label:comms', 'group:effort', 'label:deep', 'label:quick', UNGROUPED_KEY, 'label:loose'])
  assert.equal(applyDrop(items, 'group:effort', 'group:effort'), null)
  assert.deepEqual(applyDrop(items, 'group:effort', 'label:loose').groupOrder, ['type', 'effort'])
})

test('⌥↑/⌥↓: labels step across headers, groups swap, edges are no-ops', () => {
  assert.deepEqual(moveByKey(items, 'label:comms', 'up').moved, { labelId: 'comms', groupId: 'effort' })
  assert.deepEqual(moveByKey(items, 'label:quick', 'down').moved, { labelId: 'quick', groupId: 'type' })
  assert.equal(moveByKey(items, 'label:deep', 'up'), null)
  assert.equal(moveByKey(items, 'label:loose', 'down'), null)
  assert.deepEqual(moveByKey(items, 'group:effort', 'down').groupOrder, ['type', 'effort'])
  assert.equal(moveByKey(items, 'group:type', 'down'), null)
})

test('full order keeps system and archived after the visible list; the optimistic view applies it', () => {
  const r = applyDrop(items, 'label:loose', 'label:comms')
  const order = fullLabelOrder(r.items, model)
  assert.deepEqual(order, ['deep', 'quick', 'loose', 'comms', 'bot', 'old'])
  const loose = applyToTaxonomy(labels, groups, r, order).labels.find((x) => x.id === 'loose')
  assert.deepEqual([loose.group, loose.position], ['type', 2])
})

test('nextGroupName avoids taken names, ignoring case', () => {
  assert.equal(nextGroupName([]), 'New group')
  assert.equal(nextGroupName([g('a', 0, { name: 'New group' }), g('b', 1, { name: 'new group 2' })]), 'New group 3')
})

import { describeMove } from '../src/lib/labelManagerModel.ts'

test('describeMove: announces the group and position after a move', () => {
  const name = (i) => (i.kind === 'group' ? i.groupId.toUpperCase() : i.kind === 'ungrouped' ? 'Ungrouped' : i.labelId)
  const up = moveByKey(items, 'label:comms', 'up')
  assert.equal(describeMove(up.items, 'label:comms', name), 'Moved comms to EFFORT, position 3 of 3')
  const out = applyDrop(items, 'label:deep', UNGROUPED_KEY)
  assert.equal(describeMove(out.items, 'label:deep', name), 'Moved deep to Ungrouped, position 1 of 2')
  const g = moveByKey(items, 'group:effort', 'down')
  assert.equal(describeMove(g.items, 'group:effort', name), 'Moved group EFFORT to position 2 of 2')
})
