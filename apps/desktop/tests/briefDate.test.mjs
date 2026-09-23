import test from 'node:test'
import assert from 'node:assert/strict'
import { shiftIsoDate, formatBriefDate } from '../src/lib/briefDate.ts'

// Today P2-5: the date strip became a "‹ Sat, Aug 1 ›" control that steps one
// day at a time. Date strings are calendar dates, never shifted by timezone.

test('shiftIsoDate steps one day either way', () => {
  assert.equal(shiftIsoDate('2026-08-01', 1), '2026-08-02')
  assert.equal(shiftIsoDate('2026-08-01', -1), '2026-07-31')
})

test('shiftIsoDate crosses month, year and leap-day boundaries', () => {
  assert.equal(shiftIsoDate('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftIsoDate('2028-03-01', -1), '2028-02-29')
  assert.equal(shiftIsoDate('2026-03-01', -1), '2026-02-28')
})

test('formatBriefDate says Today for today and a short weekday date otherwise', () => {
  assert.equal(formatBriefDate('2026-08-01', '2026-08-01'), 'Today')
  assert.equal(formatBriefDate('2026-07-31', '2026-08-01'), 'Fri, Jul 31')
  assert.equal(formatBriefDate('2026-08-02', '2026-08-01'), 'Sun, Aug 2')
})

test('formatBriefDate adds the year only when it differs from today', () => {
  assert.equal(formatBriefDate('2025-12-31', '2026-01-01'), 'Wed, Dec 31, 2025')
})
