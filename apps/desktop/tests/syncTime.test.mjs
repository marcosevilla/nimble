import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSyncTime } from '../src/lib/syncTime.ts'

// Settings → Sync shows one human, local timestamp whichever key backs it:
// turso_last_completed_at (RFC 3339 with offset and fractional seconds) or,
// before the first completed run, the pull watermark (ISO with Z).
const at = new Date('2026-09-25T18:01:02.123Z')

test('the completed stamp and the watermark for one instant read the same', () => {
  const a = formatSyncTime('2026-09-25T18:01:02.123456+00:00', at)
  const b = formatSyncTime('2026-09-25T18:01:02.123Z', at)
  assert.equal(a, b)
  assert.doesNotMatch(a, /\.\d|Z|\+00|T\d/)
})

test('it is local wall time, hours and minutes', () => {
  const local = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  assert.ok(formatSyncTime('2026-09-25T18:01:02Z', at).includes(local))
})

test('a bare SQLite datetime is UTC', () => {
  assert.equal(formatSyncTime('2026-09-25 18:01:02', at), formatSyncTime('2026-09-25T18:01:02Z', at))
})

test('today reads "Today", another day names the date, junk stays as it is', () => {
  assert.match(formatSyncTime('2026-09-25T18:01:02Z', at), /^Today/)
  assert.doesNotMatch(formatSyncTime('2026-08-01T18:01:02Z', at), /^Today/)
  assert.equal(formatSyncTime('not a time', at), 'not a time')
})
