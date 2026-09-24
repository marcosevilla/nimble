// T1 — accessible names for the clickable row marks (loop 2 chunk 3).
//
// Module contract (to be created by the T1 builder):
//   path:   apps/desktop/src/lib/rowMarks.ts  (plain TS, no JSX, no `@/` imports)
//   export type RowMark =
//     | { kind: 'priority'; priority: number }   // 1 Normal · 2 Medium · 3 High · 4 Urgent
//     | { kind: 'due'; label: string }           // the badge's own text: "Today", "Tomorrow", "Aug 3"
//     | { kind: 'label'; name: string }
//     | { kind: 'project'; name: string }
//   export function priorityWord(priority: number): 'normal' | 'medium' | 'high' | 'urgent'
//     — values below 1 read as normal, above 4 as urgent (same scale as PriorityBars
//       and MetadataChips' PRIORITY_OPTIONS).
//   export function rowMarkName(mark: RowMark): string
//     — "Priority: high" · "Due Aug 3" · "Label quick-win" · "Project Nimble".
//       The kind word comes first so e2e/t1-row-marks.spec.ts can match
//       /\bpriority\b\W*high/i and friends.
import test from 'node:test'
import assert from 'node:assert/strict'
import { priorityWord, rowMarkName } from '../src/lib/rowMarks.ts'

test('priority words follow the 1–4 scale and clamp outside it', () => {
  assert.equal(priorityWord(1), 'normal')
  assert.equal(priorityWord(2), 'medium')
  assert.equal(priorityWord(3), 'high')
  assert.equal(priorityWord(4), 'urgent')
  assert.equal(priorityWord(0), 'normal')
  assert.equal(priorityWord(9), 'urgent')
})

test('priority mark name carries the current level', () => {
  assert.equal(rowMarkName({ kind: 'priority', priority: 4 }), 'Priority: urgent')
  assert.equal(rowMarkName({ kind: 'priority', priority: 3 }), 'Priority: high')
})

test('due mark name reuses the badge text', () => {
  assert.equal(rowMarkName({ kind: 'due', label: 'Aug 3' }), 'Due Aug 3')
  assert.equal(rowMarkName({ kind: 'due', label: 'Today' }), 'Due Today')
})

test('label and project mark names carry the name', () => {
  assert.equal(rowMarkName({ kind: 'label', name: 'quick-win' }), 'Label quick-win')
  assert.equal(rowMarkName({ kind: 'project', name: 'Nimble' }), 'Project Nimble')
})
