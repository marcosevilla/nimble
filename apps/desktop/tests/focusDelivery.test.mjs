import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DELIVERY_STATE_LABEL,
  availableResolutions,
  canResolve,
  needsAttention,
  purposeLabel,
  sortForReview,
} from '../src/lib/focusDelivery.ts'

const item = (over = {}) => ({
  id: 'd1', origin: 'focus', purpose: 'time_comment', state: 'uncertain', native_task_id: 't1', task_title: 'Write',
  external_id: 'R1', occurrence_id: 'o1', occurrence_title: 'Write', content: '⏱ 1m spent', recorded_ms: 61000,
  budget_ms: null, attempts: 1, last_error: 'timed out', next_attempt_at: null, remote_receipt: null, evidence: {},
  created_at: '2026-09-22T10:00:00.000Z', resolution: null, recurring_task: false, adoptable: true, adopt_blocked_reason: null,
  ...over,
})

test('every lifecycle state has plain copy', () => {
  for (const s of ['pending', 'sending', 'acknowledged', 'uncertain', 'retryable-error', 'needs-review', 'archived']) {
    assert.ok(DELIVERY_STATE_LABEL[s], s)
  }
  assert.equal(purposeLabel(item()), 'Time comment')
  assert.equal(purposeLabel(item({ purpose: 'legacy_close' })), 'Old Focus Queue close')
  assert.equal(purposeLabel(item({ purpose: 'legacy_comment' })), 'Old Focus Queue comment')
})

test('resolved and in-flight sends offer no action; adopt only when the backend allows it', () => {
  assert.deepEqual(availableResolutions(item({ state: 'acknowledged' })), [])
  assert.deepEqual(availableResolutions(item({ state: 'archived' })), [])
  assert.deepEqual(availableResolutions(item({ state: 'sending' })), [])
  assert.deepEqual(availableResolutions(item()), ['acknowledged', 'adopt_verified_undelivered', 'archive_with_reason'])
  assert.deepEqual(availableResolutions(item({ adoptable: false, adopt_blocked_reason: 'repeats' })), ['acknowledged', 'archive_with_reason'])
})

test('a decision needs written evidence, and adopting needs a separate verification', () => {
  assert.equal(canResolve('acknowledged', '   ', false), false)
  assert.equal(canResolve('acknowledged', 'Saw the comment in Todoist', false), true)
  assert.equal(canResolve('archive_with_reason', 'Not needed', false), true)
  assert.equal(canResolve('adopt_verified_undelivered', 'No comment in Todoist', false), false)
  assert.equal(canResolve('adopt_verified_undelivered', 'No comment in Todoist', true), true)
})

test('uncertain and needs-review sort first; resolved ones are not attention', () => {
  const list = sortForReview([
    item({ id: 'a', state: 'acknowledged' }),
    item({ id: 'b', state: 'needs-review' }),
    item({ id: 'c', state: 'pending' }),
    item({ id: 'd', state: 'uncertain' }),
  ])
  assert.deepEqual(list.map((i) => i.id), ['b', 'd', 'c', 'a'])
  assert.equal(needsAttention(item({ state: 'acknowledged' })), false)
  assert.equal(needsAttention(item({ state: 'needs-review' })), true)
})

test('the review shows evidence, the repeating-task warning and resolves through the provider', () => {
  const src = readFileSync(new URL('../src/components/focus/FocusDeliveryReview.tsx', import.meta.url), 'utf8')
  for (const needle of ['dp.focus.deliveries()', 'dp.focus.resolveDelivery(', 'item.evidence', 'item.recurring_task',
    'item.adopt_blocked_reason', 'item.occurrence_title', 'item.last_error', 'item.resolution']) {
    assert.ok(src.includes(needle), `renders ${needle}`)
  }
  assert.doesNotMatch(src, /setInterval|dp\.todoist/, 'the review never sends or polls on its own')
  const view = readFileSync(new URL('../src/components/focus/FocusView.tsx', import.meta.url), 'utf8')
  assert.match(view, /FocusDeliveryReview/)
})
