import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCaptureDate, isKeepAsTextKey } from '../src/lib/captureDate.ts'

const ref = new Date(2026, 8, 23, 10, 0) // Wed Sep 23 2026, 10:00 local

const pick = (r) => r && { dueDate: r.dueDate, dueTime: r.dueTime, title: r.title, label: r.label }

test('a weekday sets the date, leaves no time, and leaves the title', () => {
  assert.deepEqual(pick(parseCaptureDate('call mom friday', ref)), {
    dueDate: '2026-09-25', dueTime: null, title: 'call mom', label: 'Fri, Sep 25',
  })
})

test('day + time with am/pm sets both', () => {
  assert.deepEqual(pick(parseCaptureDate('call mom fri at 3pm', ref)), {
    dueDate: '2026-09-25', dueTime: '15:00', title: 'call mom', label: 'Fri, Sep 25 · 3:00 PM',
  })
  assert.deepEqual(pick(parseCaptureDate('lunch fri at noon', ref)), {
    dueDate: '2026-09-25', dueTime: '12:00', title: 'lunch', label: 'Fri, Sep 25 · 12:00 PM',
  })
})

test('relative days read Today / Tomorrow', () => {
  assert.deepEqual(pick(parseCaptureDate('tomorrow buy film', ref)), {
    dueDate: '2026-09-24', dueTime: null, title: 'buy film', label: 'Tomorrow',
  })
  assert.deepEqual(pick(parseCaptureDate('tonight edit photos', ref)), {
    dueDate: '2026-09-23', dueTime: null, title: 'edit photos', label: 'Today',
  })
  assert.equal(parseCaptureDate('buy film in 3 days', ref).dueDate, '2026-09-26')
})

test('a time alone with am/pm lands today (or the next day once passed)', () => {
  assert.deepEqual(pick(parseCaptureDate('call at 3pm', ref)), {
    dueDate: '2026-09-23', dueTime: '15:00', title: 'call', label: 'Today · 3:00 PM',
  })
  assert.equal(parseCaptureDate('call at 9am', ref).dueDate, '2026-09-24')
})

test('a leading connector word goes with the date', () => {
  const r = parseCaptureDate('by monday send deck', ref)
  assert.equal(r.dueDate, '2026-09-28')
  assert.equal(r.title, 'send deck')
  assert.equal(r.start, 0)
  const on = parseCaptureDate('pay rent on friday', ref)
  assert.equal(on.title, 'pay rent')
  assert.equal('pay rent on friday'.slice(on.start, on.end), 'on friday')
})

test('span offsets point at the matched words', () => {
  const text = 'call mom fri at 3pm'
  const r = parseCaptureDate(text, ref)
  assert.equal(text.slice(r.start, r.end), 'fri at 3pm')
  assert.equal(r.matchText, 'fri at 3pm')
})

test('rejected: bare hour, now, ranges, recurrence, no date, empty title', () => {
  for (const text of [
    'call at 3',
    'fix bug now',
    'mon-fri standup',
    'water plants every friday',
    'stretch each monday',
    'read chapter 2',
    'review 3 kids books',
    'tomorrow',
    'fri at 3pm',
  ]) {
    assert.equal(parseCaptureDate(text, ref), null, text)
  }
})

test('an ignored match is skipped; without it the same text parses', () => {
  assert.equal(parseCaptureDate('sat on the couch', ref).dueDate, '2026-09-26')
  assert.equal(parseCaptureDate('sat on the couch', ref, ['sat']), null)
  assert.equal(parseCaptureDate('Call mom FRIDAY', ref, ['friday']), null)
})

test('isKeepAsTextKey: Backspace with the caret right after the date span', () => {
  const value = '/t call mom friday'
  const spanEnd = value.length
  const base = { key: 'Backspace', selectionStart: spanEnd, selectionEnd: spanEnd, spanEnd, value }
  assert.equal(isKeepAsTextKey(base), true)
  assert.equal(isKeepAsTextKey({ ...base, value: value + '  ', selectionStart: spanEnd + 2, selectionEnd: spanEnd + 2 }), true)
  assert.equal(isKeepAsTextKey({ ...base, value: value + ' x', selectionStart: spanEnd + 2, selectionEnd: spanEnd + 2 }), false)
  assert.equal(isKeepAsTextKey({ ...base, selectionStart: spanEnd - 3, selectionEnd: spanEnd }), false)
  assert.equal(isKeepAsTextKey({ ...base, selectionStart: spanEnd - 1, selectionEnd: spanEnd - 1 }), false)
  assert.equal(isKeepAsTextKey({ ...base, metaKey: true }), false)
  assert.equal(isKeepAsTextKey({ ...base, altKey: true }), false)
  assert.equal(isKeepAsTextKey({ ...base, ctrlKey: true }), false)
  assert.equal(isKeepAsTextKey({ ...base, key: 'Delete' }), false)
  assert.equal(isKeepAsTextKey({ ...base, selectionStart: null, selectionEnd: null }), false)
})

// --- Fix round 1 (Opus review + controller rulings) ---

test('day + bare hour rejects the whole match (ambiguous, no meridiem)', () => {
  assert.equal(parseCaptureDate('dentist fri at 3', ref), null)
  assert.equal(parseCaptureDate('dentist tomorrow at 10:30', ref), null)
  assert.equal(parseCaptureDate('dentist fri at 15:00', ref).dueTime, '15:00')
})

test('recurrence anywhere in the text yields no date at all', () => {
  for (const text of [
    'water plants every friday',
    'stretch each monday',
    'every day at 9am meds',
    'every 2 weeks on friday',
    'call mom every other friday',
    'hike friday every week',
    'gym every mon and fri',
    'standup weekdays at 9am',
  ]) {
    assert.equal(parseCaptureDate(text, ref), null, text)
  }
})

test('a possessive right after the match is not a date reference', () => {
  assert.equal(parseCaptureDate("read today's paper", ref), null)
  assert.equal(parseCaptureDate('review friday’s notes', ref), null)
  assert.equal(parseCaptureDate("look at tomorrow's plan", ref), null)
})

test('past dates are skipped', () => {
  assert.equal(parseCaptureDate('called mom yesterday', ref), null)
  assert.equal(parseCaptureDate('call at 9am', ref).dueDate, '2026-09-24')
})

test('the label carries the year when it differs from ref\'s year', () => {
  const r = parseCaptureDate('renew passport jan 5', ref)
  assert.equal(r.dueDate, '2027-01-05')
  assert.equal(r.label, 'Tue, Jan 5, 2027')
})

test('weekday matching the same day as ref reads Today', () => {
  const fri = new Date(2026, 8, 25, 10, 0) // Fri Sep 25 2026, 10:00 local
  const r = parseCaptureDate('call mom friday', fri)
  assert.equal(r.dueDate, '2026-09-25')
  assert.equal(r.label, 'Today')
})
