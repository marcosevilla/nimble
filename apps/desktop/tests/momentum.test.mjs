import test from 'node:test'
import assert from 'node:assert/strict'
import {
  momentumView, trendBars, karmaLine, formatPeakHour, formatFocused, statTiles,
  goalTargetsFrom, parseRange, isMomentumSummary, WEEKDAY_OPTIONS, KARMA_DESCRIPTION,
} from '../src/lib/momentum.ts'

const settings = (o = {}) => ({ daily_goal: 5, weekly_goal: 25, days_off: ['sat', 'sun'], paused: false, paused_at: null, karma_enabled: false, karma_enabled_at: null, ...o })
const trend = (counts, start = '2026-09-17') => counts.map((done, i) => {
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + i)
  return { date: d.toISOString().slice(0, 10), done, day_off: [0, 6].includes(d.getUTCDay()), paused: false }
})
const summary = (o = {}) => ({
  today: '2026-09-23', range: '7d', settings: settings(), is_day_off: false,
  today_done: 3, week_done: 9, week_start: '2026-09-21', trend: trend([2, 4, 0, 1, 3, 3, 3]),
  wins: [
    { task_id: 'a', content: 'Send Dana the draft', priority: 4, date: '2026-09-23' },
    { task_id: 'b', content: 'Call pharmacy', priority: 1, date: '2026-09-22' },
  ],
  stats: { from: '2026-09-17', completed: 16, active_days: 6, peak_hour: 10, focused_ms: 12_000_000 },
  karma: null,
  ...o,
})
const copyOf = (v) => [v.headline, ...v.wins, v.todayNote, v.todayMeter?.text, v.weekMeter?.text, v.karmaLine].filter(Boolean).join(' | ')

test('wins first, then today and week meters against the goals', () => {
  const v = momentumView(summary())
  assert.equal(v.headline, 'This week: 9 done')
  assert.deepEqual(v.wins, ['Send Dana the draft', 'Call pharmacy'])
  assert.deepEqual([v.todayMeter.label, v.todayMeter.text, v.todayMeter.percent], ['Today', '3 of 5', 60])
  assert.deepEqual([v.weekMeter.label, v.weekMeter.text, v.weekMeter.percent], ['This week', '9 of 25', 36])
  assert.equal(v.todayNote, null)
  assert.equal(v.karmaLine, null)
})

test('a met goal fills the meter to 100 and never past it', () => {
  const v = momentumView(summary({ today_done: 8 }))
  assert.deepEqual([v.todayMeter.text, v.todayMeter.percent], ['8 of 5', 100])
})

test('an empty week has one calm line', () => {
  assert.equal(momentumView(summary({ week_done: 0, today_done: 0, wins: [] })).headline, 'Your week starts here.')
})

test('AI wins replace the rule-based ones, three at most', () => {
  assert.deepEqual(momentumView(summary(), ['A', 'B', 'C', 'D']).wins, ['A', 'B', 'C'])
})

test('paused: no meters, one neutral word, nothing about the gap', () => {
  const v = momentumView(summary({ settings: settings({ paused: true, paused_at: '2026-09-20 09:00:00' }) }))
  assert.equal(v.todayMeter, null)
  assert.equal(v.weekMeter, null)
  assert.equal(v.todayNote, 'Paused')
  assert.doesNotMatch(copyOf(v), /since|ago|welcome|missed|away|gap|\d+ days?/i)
})

test('a day off replaces the today meter with a neutral note', () => {
  assert.equal(momentumView(summary({ is_day_off: true, today_done: 0 })).todayNote, 'Day off')
  const v = momentumView(summary({ is_day_off: true, today_done: 2 }))
  assert.equal(v.todayNote, 'Day off · 2 done')
  assert.equal(v.todayMeter, null)
  assert.ok(v.weekMeter)
})

test('karma off: no streaks, penalties, points or blame anywhere in the copy', () => {
  for (const s of [summary(), summary({ today_done: 0 }), summary({ is_day_off: true }), summary({ week_done: 0, wins: [] })]) {
    assert.doesNotMatch(copyOf(momentumView(s)), /streak|penalt|overdue|missed|behind|late|yesterday|again|points|level/i)
  }
})

test("missing yesterday's goal changes no copy today", () => {
  // Today is Monday 09-21, so yesterday (Sun) belongs to last week: same week numbers.
  const base = { today: '2026-09-21', week_start: '2026-09-21', today_done: 1, week_done: 1 }
  const missed = momentumView(summary({ ...base, trend: trend([4, 4, 4, 4, 4, 1, 1], '2026-09-15') }))
  const met = momentumView(summary({ ...base, trend: trend([4, 4, 4, 4, 4, 9, 1], '2026-09-15') }))
  assert.equal(copyOf(missed), copyOf(met))
})

test('parity mode adds one quiet line: total, level, non-zero streaks', () => {
  const k = { total: 1240, level: 'Novice', next_level_at: 2500, daily_streak: 4, weekly_streak: 0 }
  assert.equal(karmaLine(k), '1,240 points · Novice · 4-day streak')
  assert.equal(momentumView(summary({ karma: { ...k, weekly_streak: 2 } })).karmaLine, '1,240 points · Novice · 4-day streak · 2-week streak')
})

test('trend: amber bars scaled to the week, days off grey, empty working days flat', () => {
  const bars = trendBars(trend([2, 4, 0, 1, 0, 3, 3])) // Thu 17 .. Wed 23; Sat 19, Sun 20 off
  assert.deepEqual(bars.map((b) => b.initial), ['T', 'F', 'S', 'S', 'M', 'T', 'W'])
  assert.deepEqual(bars.map((b) => b.tone), ['amber', 'amber', 'grey', 'grey', 'empty', 'amber', 'amber'])
  assert.deepEqual([bars[1].height, bars[0].height, bars[2].height, bars[4].height], [100, 50, 15, 0])
  assert.equal(bars[3].title, 'Sun, Sep 20 · 1 done · day off')
})

test('stat tiles: order, labels and formatting', () => {
  assert.deepEqual(statTiles({ from: null, completed: 1240, active_days: 210, peak_hour: 13, focused_ms: 12_000_000 }), [
    { label: 'Completed', value: '1,240' },
    { label: 'Active days', value: '210' },
    { label: 'Peak hour', value: '1 PM' },
    { label: 'Focused time', value: '3h 20m' },
  ])
  assert.deepEqual([null, 0, 12, 23].map((h) => formatPeakHour(h)), ['—', '12 AM', '12 PM', '11 PM'])
  assert.deepEqual([0, 59 * 60_000, 3_600_000, 50_400_000].map((ms) => formatFocused(ms)), ['0m', '59m', '1h', '14h'])
})

test('goal form input is validated before anything is sent', () => {
  assert.deepEqual(goalTargetsFrom({ daily: ' 4 ', weekly: '20', daysOff: ['sun', 'mon'], karmaEnabled: false }),
    { value: { daily: 4, weekly: 20, days_off: ['mon', 'sun'], karma_enabled: false } })
  const daily = { error: 'Daily goal must be a whole number from 1 to 100.' }
  assert.deepEqual(goalTargetsFrom({ daily: '0', weekly: '20', daysOff: [], karmaEnabled: false }), daily)
  assert.deepEqual(goalTargetsFrom({ daily: '2.5', weekly: '20', daysOff: [], karmaEnabled: false }), daily)
  assert.deepEqual(goalTargetsFrom({ daily: '5', weekly: '', daysOff: [], karmaEnabled: false }), { error: 'Weekly goal must be a whole number from 1 to 700.' })
  assert.deepEqual(goalTargetsFrom({ daily: '5', weekly: '25', daysOff: WEEKDAY_OPTIONS.map((d) => d.value), karmaEnabled: false }),
    { error: "Leave at least one day that isn't a day off." })
})

test('ranges and snapshot payloads are parsed defensively', () => {
  assert.deepEqual(['7d', '30d', 'all', 'year', null].map((v) => parseRange(v)), ['7d', '30d', 'all', '7d', '7d'])
  assert.equal(isMomentumSummary(summary()), true)
  assert.equal(isMomentumSummary({ events: [] }), false)
  assert.equal(isMomentumSummary(null), false)
})

test('the karma switch says exactly what it turns on', () => {
  assert.match(KARMA_DESCRIPTION, /points, levels, daily and weekly streaks/)
  assert.match(KARMA_DESCRIPTION, /−1 point/)
  assert.match(KARMA_DESCRIPTION, /Off by default\.$/)
})

test('the Focused setup preset keeps the Momentum box on (A5); Minimal leaves it off', async () => {
  const { applyPreset } = await import('../src/lib/briefLayout.ts')
  const list = ['weather', 'schedule', 'priorities', 'due_today', 'still_open', 'habits', 'vault', 'notes', 'momentum']
    .map((id) => ({ id, enabled: true, config: {} }))
  const on = (p) => applyPreset(list, p).filter((x) => x.enabled).map((x) => x.id)
  assert.ok(on('focused').includes('momentum'))
  assert.ok(!on('minimal').includes('momentum'))
})
