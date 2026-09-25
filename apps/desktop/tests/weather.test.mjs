import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveUnits, toUnit, dayFor, chipLabel, chipIcon, hoursOn, hourlyPoints, rainWindow, formatRainWindow,
  rainNotes, clock12, hourLabel, asOfLabel, placeLabel,
} from '../src/lib/weather.ts'

const day = (precip_max) => ({ date: '2026-08-01', high_c: 21.1, low_c: 13.9, precip_max })
const hours = (date, wet = []) =>
  Array.from({ length: 24 }, (_, h) => ({ time: `${date}T${String(h).padStart(2, '0')}:00`, temp_c: 15, precip: wet.includes(h) ? 60 : 10 }))

test('auto units: °F for en-US only; an explicit choice wins', () => {
  assert.equal(resolveUnits('auto', 'en-US'), 'F')
  assert.equal(resolveUnits('auto', 'en-GB'), 'C')
  assert.equal(resolveUnits(undefined, undefined), 'C')
  assert.equal(resolveUnits('C', 'en-US'), 'C')
  assert.equal(resolveUnits('F', 'pt-PT'), 'F')
})

test('conversion rounds; the chip shows rain only from 20%', () => {
  assert.equal(toUnit(21.1, 'F'), 70)
  assert.equal(toUnit(13.9, 'F'), 57)
  assert.equal(toUnit(13.9, 'C'), 14)
  assert.equal(chipLabel(day(60), 'F'), '70°/57° · 60%')
  assert.equal(chipLabel(day(19), 'F'), '70°/57°')
  assert.equal(chipLabel(day(null), 'C'), '21°/14°')
  assert.deepEqual([chipIcon(day(10)), chipIcon(day(20)), chipIcon(day(50))], ['sun', 'cloud-sun', 'rain'])
})

test('dayFor and hoursOn pick the brief date only', () => {
  const forecast = { timezone: 'UTC', current_time: null, current_c: null, days: [day(1), { ...day(2), date: '2026-08-02' }], hourly: [...hours('2026-08-01'), ...hours('2026-08-02')] }
  assert.equal(dayFor(forecast, '2026-08-02').precip_max, 2)
  assert.equal(dayFor(forecast, '2026-08-03'), null)
  assert.equal(dayFor(null, '2026-08-01'), null)
  assert.equal(hoursOn(forecast, '2026-08-01').length, 24)
})

test('four hourly points from now to the evening', () => {
  const h = hours('2026-08-01')
  assert.deepEqual(hourlyPoints(h, 7).map((x) => x.time.slice(11, 13)), ['07', '12', '16', '21'])
  assert.deepEqual(hourlyPoints(h, 18).map((x) => x.time.slice(11, 13)), ['18', '19', '20', '21'])
  assert.deepEqual(hourlyPoints(h, 22).map((x) => x.time.slice(11, 13)), ['22', '23'])
  assert.deepEqual(hourlyPoints([], 7), [])
})

test('rain window: the first run of likely-rain hours from now', () => {
  const h = hours('2026-08-01', [9, 19, 20, 21])
  assert.deepEqual(rainWindow(h, 7), { start: 9, end: 10 })
  assert.deepEqual(rainWindow(h, 12), { start: 19, end: 22 })
  assert.equal(rainWindow(h, 22), null)
  assert.equal(formatRainWindow({ start: 19, end: 22 }), 'Rain likely 7 pm to 10 pm')
})

test('rain notes: timed events whose hour is likely wet, real and mock time shapes', () => {
  const h = hours('2026-08-01', [19])
  const events = [
    { summary: 'Turnstile', start_time: '2026-08-01T19:00:00', all_day: false },
    { summary: 'Dinner', start_time: '19:30', all_day: false },
    { summary: 'Coffee', start_time: '14:00', all_day: false },
    { summary: 'Holiday', start_time: '', all_day: true },
  ]
  assert.deepEqual(rainNotes(events, h), [{ summary: 'Turnstile', time: '7:00' }, { summary: 'Dinner', time: '7:30' }])
})

test('clock and hour labels are 12-hour', () => {
  assert.equal(clock12('19:00'), '7:00')
  assert.equal(clock12('00:05'), '12:05')
  assert.equal(clock12('2026-08-01T12:30:00'), '12:30')
  assert.deepEqual([hourLabel(0), hourLabel(9), hourLabel(12), hourLabel(16)], ['12 am', '9 am', '12 pm', '4 pm'])
  assert.equal(asOfLabel('2026-09-25T06:31:00'), '6:31')
  assert.equal(asOfLabel('nope'), '')
})

test('as of: the clock for a fetch made on the brief date, the date too otherwise', () => {
  assert.equal(asOfLabel('2026-09-25T06:31:00', '2026-09-25'), '6:31')
  assert.equal(asOfLabel('2026-09-25T14:05:00', '2026-09-26'), 'Sep 25, 2:05')
  assert.equal(asOfLabel('nope', '2026-09-26'), '')
})

test('place labels add the region, or the country without one', () => {
  assert.equal(placeLabel({ name: 'San Francisco', admin1: 'California', country: 'United States' }), 'San Francisco, California')
  assert.equal(placeLabel({ name: 'Lisbon', admin1: 'Lisbon', country: 'Portugal' }), 'Lisbon, Portugal')
  assert.equal(placeLabel({ name: 'Monaco', admin1: null, country: null }), 'Monaco')
})
