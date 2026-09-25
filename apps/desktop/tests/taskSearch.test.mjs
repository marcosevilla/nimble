import test from 'node:test'
import assert from 'node:assert/strict'
import { MARK_OPEN as O, MARK_CLOSE as C, searchTokens, splitMarked, markTitle, likeSnippet } from '../src/lib/taskSearch.ts'

test('searchTokens: syntax becomes spaces, punctuation-only and emoji tokens drop', () => {
  assert.deepEqual(searchTokens('  follow-up  c++ "hi" & 🎸 café '), ['follow', 'up', 'c', 'hi', 'café'])
  assert.deepEqual(searchTokens('***'), [])
})

test('splitMarked: runs, and unbalanced markers never throw', () => {
  assert.deepEqual(splitMarked(`a ${O}port${C} b`), [
    { text: 'a ', mark: false }, { text: 'port', mark: true }, { text: ' b', mark: false },
  ])
  assert.deepEqual(splitMarked(`x${O}open`), [{ text: 'x', mark: false }, { text: 'open', mark: true }])
  assert.deepEqual(splitMarked(`stray${C}close`), [{ text: 'stray', mark: false }, { text: 'close', mark: false }])
  assert.deepEqual(splitMarked(''), [])
})

test('markTitle: words starting with a token, case- and diacritic-insensitive', () => {
  assert.deepEqual(markTitle('Update Résumé draft', ['resu', 'DR']), [
    { text: 'Update ', mark: false }, { text: 'Résumé', mark: true }, { text: ' ', mark: false }, { text: 'draft', mark: true },
  ])
  assert.deepEqual(markTitle('Email Jo', ['deck']), [{ text: 'Email Jo', mark: false }])
  assert.deepEqual(markTitle('Email Jo', []), [{ text: 'Email Jo', mark: false }])
})

test('likeSnippet: window around the first hit, every hit marked, ellipses when cut', () => {
  const text = 'A'.repeat(80) + ' ask about the portfolio deck and the Portfolio site ' + 'B'.repeat(200)
  const s = likeSnippet(text, ['portfolio'], 20)
  assert.ok(s.startsWith('…') && s.endsWith('…'), s)
  assert.ok(s.includes(`${O}portfolio${C}`), s)
  assert.equal(likeSnippet('short portfolio', ['portfolio']), `short ${O}portfolio${C}`)
  assert.equal(likeSnippet('nothing here', ['portfolio']), null)
  assert.equal(likeSnippet(null, ['portfolio']), null)
})

import * as taskSearch from '../src/lib/taskSearch.ts'
const { groupHits, createLatestGuard, formatDoneDate } = taskSearch

const hit = (id, status) => ({ task: { id, status, content: id }, snippet: null, matched_in: 'title' })

test('groupHits: open then completed, ranked order kept inside each', () => {
  const { open, completed } = groupHits([hit('a', 'todo'), hit('b', 'complete'), hit('c', 'blocked'), hit('d', 'complete')])
  assert.deepEqual(open.map((h) => h.task.id), ['a', 'c'])
  assert.deepEqual(completed.map((h) => h.task.id), ['b', 'd'])
})

test('latest guard drops stale responses', () => {
  const guard = createLatestGuard()
  const first = guard.next()
  const second = guard.next()
  assert.equal(guard.isLatest(first), false, 'an older query never replaces a newer one')
  assert.equal(guard.isLatest(second), true)
  guard.next() // clearing the input invalidates whatever is in flight
  assert.equal(guard.isLatest(second), false)
})

test('formatDoneDate: short date, year only outside the current year', () => {
  const now = new Date(2026, 8, 25)
  assert.equal(formatDoneDate('2026-09-12 14:03:00', now), 'Sep 12')
  assert.equal(formatDoneDate('2025-12-01T09:00:00', now), 'Dec 1, 2025')
  assert.equal(formatDoneDate(null, now), 'Done')
  assert.equal(formatDoneDate('garbage', now), 'Done')
})

test('the ⌘F chip helpers are gone (filters are Omnibar pills now)', () => {
  for (const name of ['EMPTY_SEARCH_FILTERS', 'STATUS_LABEL', 'hasActiveFilters', 'activeFilterLabels', 'SEARCH_DEBOUNCE_MS']) {
    assert.equal(taskSearch[name], undefined, name)
  }
})
