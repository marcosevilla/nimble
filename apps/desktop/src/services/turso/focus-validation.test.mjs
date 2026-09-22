import assert from 'node:assert/strict'
import test from 'node:test'
import { validRecords } from './focus-validation.ts'

const max = Number.MAX_SAFE_INTEGER
const snapshot = () => ({
  queue: [], occurrences: [{ generation: 1 }],
  sessions: [{ status: 'paused', occurrence_id: 'occurrence', work_ms: 0,
    break_ms: 0, round_work_ms: 0, round_break_ms: 0, session_revision: 0,
    round: 1, timezone_offset_minutes: 0,
    config_json: JSON.stringify({ mode: 'count_up', work_ms: 0, break_ms: 0, budget_ms: null, rounds: 1 }) }],
  import_totals: [], totals: { occurrence: 0 },
})

test('settled records reject unsafe durations and revisions', () => {
  for (const bad of [-1, 1.5, max + 1]) {
    for (const field of ['work_ms', 'break_ms', 'round_work_ms', 'round_break_ms', 'session_revision']) {
      const value = snapshot()
      value.sessions[0][field] = bad
      assert.equal(validRecords(value), false, `${field}: ${bad}`)
    }
    const imported = snapshot()
    imported.import_totals.push({ occurrence_id: 'occurrence', duration_ms: bad })
    assert.equal(validRecords(imported), false, `import: ${bad}`)
  }
})

test('safe boundary and exact aggregate are accepted', () => {
  const value = snapshot()
  value.sessions[0].work_ms = max
  value.sessions[0].break_ms = max
  value.totals.occurrence = max
  assert.equal(validRecords(value), true)
  value.import_totals.push({ occurrence_id: 'occurrence', duration_ms: 1 })
  assert.equal(validRecords(value), false)
})
