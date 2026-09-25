import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pickerSections, filterSections, managerSections, orderTaskLabels, systemTaskLabels,
  toggleLabel, pickerCreateAction, isFlat, defaultHighlight, applyRestored,
} from '../src/lib/labelTaxonomy.ts'

const g = (id, name, position, extra = {}) => ({
  id, name, position, exclusive: false, system: false,
  created_at: '2026-09-25 09:00:00', updated_at: '2026-09-25 09:00:00', ...extra,
})
const l = (id, position, group = null, archived_at = null) => ({
  id, name: id, color: 'gray', position, group, archived_at, created_at: '2026-09-25 09:00:00',
})

const groups = [g('type', 'TYPE', 1), g('effort', 'EFFORT', 0, { exclusive: true }), g('sys', 'SYSTEM', 2, { system: true })]
const labels = [
  l('comms', 0, 'type'), l('quick', 1, 'effort'), l('deep', 0, 'effort'),
  l('loose', 5), l('old', 6, null, '2026-09-01 10:00:00'), l('nimble', 7, 'sys'), l('orphan', 8, 'deleted-group'),
]
const shape = (sections) => sections.map((s) => [s.group?.name ?? null, s.labels.map((x) => x.id)])

test('picker: groups by position, then Ungrouped; no system, archived or empty sections', () => {
  assert.deepEqual(shape(pickerSections(labels, groups)), [
    ['EFFORT', ['deep', 'quick']], ['TYPE', ['comms']], [null, ['loose', 'orphan']],
  ])
})

test('dangling group id reads as ungrouped', () => {
  assert.ok(pickerSections(labels, groups).at(-1).labels.some((x) => x.id === 'orphan'))
  assert.ok(managerSections(labels, groups).ungrouped.some((x) => x.id === 'orphan'))
})

test('filter: system group listed last; archived never listed', () => {
  assert.deepEqual(shape(filterSections(labels, groups)).map(([name]) => name), ['EFFORT', 'TYPE', null, 'SYSTEM'])
  assert.ok(!filterSections(labels, groups).flatMap((s) => s.labels).some((x) => x.id === 'old'))
})

test('no groups at all renders flat (a new profile)', () => {
  assert.equal(isFlat(pickerSections([l('a', 0), l('b', 1)], [])), true)
  assert.equal(isFlat(pickerSections(labels, groups)), false)
})

test('manager: empty groups kept; system and archived buckets; a pending-delete group reads as ungrouped', () => {
  const m = managerSections(labels, [...groups, g('empty', 'EMPTY', 3)], new Set(['type']))
  assert.deepEqual(m.groups.map((s) => s.group.name), ['EFFORT', 'EMPTY'])
  assert.deepEqual(m.ungrouped.map((x) => x.id), ['comms', 'loose', 'orphan'])
  assert.deepEqual(m.system.map((s) => s.labels.map((x) => x.id)), [['nimble']])
  assert.deepEqual(m.archived.map((x) => x.id), ['old'])
})

test('row chips: taxonomy order, system hidden, archived kept; detail lists system separately', () => {
  assert.deepEqual(orderTaskLabels(['loose', 'nimble', 'comms', 'old', 'deep'], labels, groups).map((x) => x.id), ['deep', 'comms', 'loose', 'old'])
  assert.deepEqual(systemTaskLabels(['loose', 'nimble'], labels, groups).map((x) => x.id), ['nimble'])
})

test('Pick one: applying swaps the group sibling; multi groups add; hidden labels are kept', () => {
  assert.deepEqual(toggleLabel(['deep', 'nimble', 'comms'], 'quick', labels, groups), ['nimble', 'comms', 'quick'])
  assert.deepEqual(toggleLabel(['deep'], 'comms', labels, groups), ['deep', 'comms'])
  assert.deepEqual(toggleLabel(['deep', 'quick'], 'deep', labels, groups), ['quick'], 'toggling off leaves a sync-delivered sibling alone')
})

test('create action: apply a visible match, restore an archived one, create new, hint for a system name', () => {
  assert.equal(pickerCreateAction('  ', labels, groups).kind, 'none')
  assert.deepEqual(pickerCreateAction('DEEP', labels, groups), { kind: 'apply', label: labels[2] })
  assert.deepEqual(pickerCreateAction('Old', labels, groups), { kind: 'restore', label: labels[4] })
  assert.deepEqual(pickerCreateAction('brand new', labels, groups), { kind: 'create', name: 'brand new' })
  assert.deepEqual(pickerCreateAction('nimble', labels, groups), { kind: 'system', label: labels[5] })
})

test('Enter target: exact match, then Restore, then first match, then Create', () => {
  const deep = labels[2], quick = labels[1]
  assert.equal(defaultHighlight([quick, deep], { kind: 'apply', label: deep }), 'deep', 'exact beats first')
  assert.equal(defaultHighlight([], { kind: 'restore', label: labels[4] }), 'action')
  assert.equal(defaultHighlight([quick], { kind: 'create', name: 'qu' }), 'quick', 'a partial match beats Create')
  assert.equal(defaultHighlight([], { kind: 'create', name: 'brand new' }), 'action')
  assert.equal(defaultHighlight([], { kind: 'system', label: labels[5] }), null)
  assert.equal(defaultHighlight([], { kind: 'none' }), null)
})

test('restore from the picker never removes a label the task already carries', () => {
  assert.deepEqual(applyRestored(['old', 'deep'], 'old', labels, groups), ['old', 'deep'])
  assert.deepEqual(applyRestored(['deep'], 'old', labels, groups), ['deep', 'old'])
})

test('filter keeps a selected archived label listed so it can be removed', () => {
  const ids = filterSections(labels, groups, new Set(['old'])).flatMap((s) => s.labels).map((x) => x.id)
  assert.ok(ids.includes('old'))
  assert.ok(!filterSections(labels, groups).flatMap((s) => s.labels).some((x) => x.id === 'old'))
})
