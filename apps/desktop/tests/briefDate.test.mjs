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

// C2 carried fix: "Today" is the local calendar date, not the UTC one, and
// it advances at local midnight. Pinned to Pacific time, where UTC rolls to
// tomorrow at 5pm (4pm in winter).
process.env.TZ = 'America/Los_Angeles'
const { localIsoDate, msUntilNextLocalDay } = await import('../src/lib/briefDate.ts')

test('localIsoDate stays on the local day after UTC has rolled over', () => {
  const evening = new Date('2026-09-23T03:30:00Z') // 8:30pm PDT, Sep 22
  assert.equal(evening.toISOString().slice(0, 10), '2026-09-23')
  assert.equal(localIsoDate(evening), '2026-09-22')
})

test('localIsoDate advances at local midnight', () => {
  assert.equal(localIsoDate(new Date(2026, 8, 22, 23, 59, 59)), '2026-09-22')
  assert.equal(localIsoDate(new Date(2026, 8, 23, 0, 0, 0)), '2026-09-23')
})

test('msUntilNextLocalDay counts to local midnight, including DST days', () => {
  assert.equal(msUntilNextLocalDay(new Date(2026, 8, 22, 23, 59, 0)), 60_000)
  // Spring forward (Mar 8 2026): the local day is 23 hours long.
  assert.equal(msUntilNextLocalDay(new Date(2026, 2, 8, 0, 0, 0)), 23 * 3_600_000)
  // Fall back (Nov 1 2026): 25 hours.
  assert.equal(msUntilNextLocalDay(new Date(2026, 10, 1, 0, 0, 0)), 25 * 3_600_000)
})

// C2 fix round 1: the brief card follows "today" across midnight without an
// effect (no stale render), and a brief loaded for one day is never shown
// as another day's.
const { pickBriefDate, resolveBriefDate, briefFor } = await import('../src/lib/briefDate.ts')

test('picking today stores "follow today"; any other date is pinned', () => {
  assert.equal(pickBriefDate('2026-09-22', '2026-09-22'), null)
  assert.equal(pickBriefDate('2026-09-20', '2026-09-22'), '2026-09-20')
})

test('a card following today moves to the new date at midnight; a pinned one stays', () => {
  assert.equal(resolveBriefDate(null, '2026-09-22'), '2026-09-22')
  assert.equal(resolveBriefDate(null, '2026-09-23'), '2026-09-23')
  assert.equal(resolveBriefDate('2026-09-20', '2026-09-23'), '2026-09-20')
})

test('briefFor returns loaded content only for the date it was loaded for', () => {
  const loaded = { date: '2026-09-22', content: 'yesterday' }
  assert.equal(briefFor(loaded, '2026-09-22'), 'yesterday')
  assert.equal(briefFor(loaded, '2026-09-23'), undefined) // still loading the new day
  assert.equal(briefFor({ date: '2026-09-23', content: null }, '2026-09-23'), null)
  assert.equal(briefFor(null, '2026-09-23'), undefined)
})
