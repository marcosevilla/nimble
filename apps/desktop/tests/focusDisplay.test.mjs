// Display-only interpolation of a running focus timer. Pure functions only:
// nothing here is persisted or sent; snapshots stay the authority.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DISPLAY_EXTRA_MS,
  displayBaseMs,
  displayExtraFrom,
  displayExtraMs,
  displayKey,
  nextDisplayTotal,
} from '../src/lib/focusDisplay.ts'
import { cardTiming } from '../src/lib/focusQueueIntents.ts'

const MIN = 60_000
const CHECKPOINT = '2026-09-22T10:00:00.000Z'
const T0 = Date.parse(CHECKPOINT)
const countUp = { mode: 'count_up', budget_ms: null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 }
const entry = (config = countUp) => ({
  id: 'e1', task_id: 't1', occurrence_id: 'o1', added_at: CHECKPOINT, source: { kind: 'today' }, explicit_still_open: false, config,
})
function snap({ status = 'running', config = countUp, total = 10 * MIN, phase = 'work', round_work_ms = 0, break_ms = 0, checkpoint = CHECKPOINT } = {}) {
  return {
    queue_revision: 1, engine_revision: 5, owner_epoch: 'ep', process_generation: 2, writer_device_id: 'mac',
    queue: [entry(config)], selected_occurrence_id: 'o1',
    session: { id: 's1', occurrence_id: 'o1', status, phase, work_ms: total, break_ms, round_work_ms, round: 1, config },
    totals: { o1: total }, as_of: '2026-09-22T10:00:05.000Z', checkpoint_at: checkpoint, recovery_reason: null, replica: false,
  }
}

test('only a running session with live timing ticks', () => {
  assert.ok(displayKey(snap(), entry(), true))
  assert.equal(displayKey(snap(), entry(), false), null, 'live timing off')
  assert.equal(displayKey(snap({ status: 'paused' }), entry(), true), null, 'paused')
  assert.equal(displayKey(snap({ status: 'ended' }), entry(), true), null, 'ended')
  assert.equal(displayKey(null, entry(), true), null)
  const s = snap()
  const key = displayKey(s, entry(), true)
  assert.equal(displayExtraMs(s, key, T0 + 7_500), 7_500)
  assert.equal(displayExtraMs(snap({ status: 'paused' }), null, T0 + 7_500), 0)
})

test('interpolation references checkpoint_at and clamps to [0, 40 s]', () => {
  const s = snap()
  const key = displayKey(s, entry(), true)
  assert.equal(displayExtraMs(s, key, T0 - 5_000), 0, 'clock behind the checkpoint never subtracts')
  assert.equal(displayExtraMs(s, key, T0 + 10 * MIN), MAX_DISPLAY_EXTRA_MS, 'never more than the gap rule could credit')
  assert.equal(displayExtraMs(snap({ checkpoint: null }), key, T0 + 1_000), 0)
  assert.equal(displayExtraMs(snap({ checkpoint: 'garbage' }), key, T0 + 1_000), 0)
})

test('displayed total never steps backwards for the same running quantity', () => {
  const s = snap()
  const key = displayKey(s, entry(), true)
  let memo = nextDisplayTotal(null, key, 10 * MIN, 19_900)
  assert.equal(memo.total, 10 * MIN + 19_900)
  // A heartbeat settles 19.8 s and moves the checkpoint: base + small extra
  // is slightly lower than what was shown, so the shown value holds.
  memo = nextDisplayTotal(memo, key, 10 * MIN + 19_800, 50)
  assert.equal(memo.total, 10 * MIN + 19_900)
  assert.equal(displayExtraFrom(memo, key, 10 * MIN + 19_800), 100)
  memo = nextDisplayTotal(memo, key, 10 * MIN + 19_800, 1_200)
  assert.equal(memo.total, 10 * MIN + 21_000)
  // A new snapshot base beyond the memo never shows less than the base.
  assert.equal(displayExtraFrom(memo, key, 11 * MIN), 0)
  // Pause (no key) or a new phase/round/session starts fresh.
  assert.equal(displayExtraFrom(memo, null, 10 * MIN), 0)
  assert.equal(nextDisplayTotal(memo, 'other', 0, 500).total, 500)
})

test('phase colors and overtime derive from the interpolated value', () => {
  const timebox = { ...countUp, mode: 'timebox', budget_ms: 25 * MIN }
  const s = snap({ config: timebox, total: 25 * MIN - 5_000 })
  assert.equal(cardTiming(s, entry(timebox)).presentation.text, '0:05')
  assert.equal(cardTiming(s, entry(timebox), 12_000).presentation.phase, 'overtime')
  assert.equal(cardTiming(s, entry(timebox), 12_000).presentation.text, '+0:07')
  const amber = snap({ total: 25 * MIN - 1_000 })
  assert.equal(cardTiming(amber, entry()).presentation.phase, 'normal')
  assert.equal(cardTiming(amber, entry(), 2_000).presentation.phase, 'amber')
  // Paused sessions ignore any display extra.
  const paused = snap({ status: 'paused', total: 25 * MIN - 1_000 })
  assert.equal(cardTiming(paused, entry(), 2_000).presentation.phase, 'normal')
})

test('a Pomodoro round ticks its round work and never displays past its target', () => {
  const pomodoro = { ...countUp, mode: 'pomodoro', work_ms: 25 * MIN }
  const s = snap({ config: pomodoro, round_work_ms: 25 * MIN - 3_000 })
  assert.equal(displayBaseMs(s, entry(pomodoro)), 25 * MIN - 3_000)
  const t = cardTiming(s, entry(pomodoro), 30_000)
  assert.equal(t.presentation.text, '0:00')
  assert.notEqual(t.presentation.phase, 'overtime')
  const onBreak = snap({ config: pomodoro, phase: 'break', break_ms: 60_000 })
  assert.equal(displayBaseMs(onBreak, entry(pomodoro)), 60_000)
})
