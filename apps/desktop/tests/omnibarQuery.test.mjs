import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fold, suggestFilters, acceptSuggestion, addPill, removePill, removeLastPill,
  pillFilters, hasTaskFilters, pillText, suggestionText, MAX_SUGGESTIONS,
} from '../src/lib/omnibarQuery.ts'

const catalog = {
  labels: [
    { id: 'l-photo', name: '📷 Photography', archived_at: null },
    { id: 'l-design', name: 'design', archived_at: null },
    { id: 'l-deep', name: 'deep-work', archived_at: null },
    { id: 'l-old', name: 'ops', archived_at: '2026-09-01 10:00:00' },
    { id: 'l-resume', name: 'Résumé', archived_at: null },
  ],
  projects: [
    { id: 'p-portola', name: 'Portola 2026', archived_at: null },
    { id: 'p-design', name: 'Design', archived_at: null },
    { id: 'p-gone', name: 'Opsbox', archived_at: '2026-09-02 10:00:00' },
  ],
}
const kinds = (list) => list.map((s) => `${s.pill.kind}:${s.pill.value}`)

test('fold strips case, diacritics and emoji', () => {
  assert.equal(fold('  📷 Photográphy  '), 'photography')
  assert.equal(fold('RÉSUMÉ'), 'resume')
  assert.equal(fold('🎸'), '')
})

test('statuses and their aliases', () => {
  assert.deepEqual(kinds(suggestFilters('completed', [], catalog)), ['status:completed'])
  assert.deepEqual(kinds(suggestFilters('done', [], catalog)), ['status:completed'])
  assert.deepEqual(kinds(suggestFilters('comp', [], catalog)), ['status:completed'])
  assert.deepEqual(kinds(suggestFilters('open', [], catalog)), ['status:open'])
})

test('types, labels and projects by case-, diacritic- and emoji-insensitive prefix', () => {
  assert.deepEqual(kinds(suggestFilters('docs', [], catalog)), ['type:doc'])
  assert.deepEqual(kinds(suggestFilters('photo', [], catalog)), ['label:l-photo'])
  assert.deepEqual(kinds(suggestFilters('resume', [], catalog)), ['label:l-resume'])
  assert.deepEqual(kinds(suggestFilters('portola', [], catalog)), ['project:p-portola'])
})

test('the whole text matches a multi-word name and consumes all of it', () => {
  const [s] = suggestFilters('portola 2026', [], catalog)
  assert.equal(`${s.pill.kind}:${s.pill.value}`, 'project:p-portola')
  assert.equal(s.exact, true)
  assert.deepEqual(acceptSuggestion({ pills: [], text: 'portola 2026' }, s), {
    pills: [{ kind: 'project', value: 'p-portola', name: 'Portola 2026' }],
    text: '',
  })
})

test('ranking: exact before prefix; ties status, type, label, project; at most three', () => {
  // "design" is an exact label AND project; "do" prefixes doc/done; "open" is exact.
  assert.deepEqual(kinds(suggestFilters('design do open', [], catalog)), ['status:open', 'label:l-design', 'project:p-design'])
  assert.equal(MAX_SUGGESTIONS, 3)
})

test('one-letter words only match exactly; blank and emoji-only text suggest nothing', () => {
  assert.deepEqual(suggestFilters('a d', [], catalog), [])
  assert.deepEqual(suggestFilters('   ', [], catalog), [])
  assert.deepEqual(suggestFilters('🎸', [], catalog), [])
})

test('archived labels/projects and already-pilled values are never offered', () => {
  assert.deepEqual(suggestFilters('ops', [], catalog), [])
  const pilled = [{ kind: 'label', value: 'l-design', name: 'design' }]
  assert.deepEqual(kinds(suggestFilters('design', pilled, catalog)), ['project:p-design'])
})

test('accepting removes the matched word and leaves one trailing space to keep typing', () => {
  const [s] = suggestFilters('zeph completed', [], catalog)
  assert.deepEqual(acceptSuggestion({ pills: [], text: 'zeph completed' }, s), {
    pills: [{ kind: 'status', value: 'completed', name: 'completed' }],
    text: 'zeph ',
  })
})

test('pill rules: one status, one type, one project (replaced); labels stack, no duplicates', () => {
  let p = []
  p = addPill(p, { kind: 'status', value: 'open', name: 'open' })
  p = addPill(p, { kind: 'status', value: 'completed', name: 'completed' })
  p = addPill(p, { kind: 'label', value: 'a', name: 'a' })
  p = addPill(p, { kind: 'label', value: 'b', name: 'b' })
  p = addPill(p, { kind: 'label', value: 'a', name: 'a' })
  p = addPill(p, { kind: 'project', value: 'p1', name: 'P1' })
  p = addPill(p, { kind: 'project', value: 'p2', name: 'P2' })
  p = addPill(p, { kind: 'type', value: 'doc', name: 'doc' })
  p = addPill(p, { kind: 'type', value: 'goal', name: 'goal' })
  assert.deepEqual(p.map((x) => `${x.kind}:${x.value}`), ['status:completed', 'label:a', 'label:b', 'project:p2', 'type:goal'])
})

test('removePill and removeLastPill (Backspace in an empty field)', () => {
  const pills = [{ kind: 'label', value: 'a', name: 'a' }, { kind: 'status', value: 'open', name: 'open' }]
  assert.deepEqual(removeLastPill({ pills, text: '' }).pills.map((p) => p.value), ['a'])
  assert.deepEqual(removePill({ pills, text: 'x' }, 0), { pills: [pills[1]], text: 'x' })
  const none = { pills: [], text: '' }
  assert.equal(removeLastPill(none), none)
})

test('pillFilters and hasTaskFilters', () => {
  const f = pillFilters([
    { kind: 'type', value: 'doc', name: 'doc' },
    { kind: 'label', value: 'a', name: 'a' },
    { kind: 'label', value: 'b', name: 'b' },
    { kind: 'project', value: 'p', name: 'P' },
    { kind: 'status', value: 'open', name: 'open' },
  ])
  assert.deepEqual(f, { status: 'open', labelIds: ['a', 'b'], projectId: 'p', type: 'doc' })
  assert.equal(hasTaskFilters(f), true)
  assert.equal(hasTaskFilters(pillFilters([{ kind: 'type', value: 'goal', name: 'goal' }])), false)
  assert.deepEqual(pillFilters([]), { status: 'all', labelIds: [], projectId: null, type: null })
})

test('copy: pill and suggestion text', () => {
  assert.equal(pillText({ kind: 'label', value: 'x', name: 'photography' }), 'label: photography')
  assert.equal(suggestionText(suggestFilters('completed', [], catalog)[0]), 'Filter by status: completed')
})

// ── Checkpoint-1 review follow-ups ──

const review = {
  labels: [
    { id: 'l-notes', name: 'Notes', archived_at: null },
    { id: 'l-parch', name: 'portola-archive', archived_at: null },
    { id: 'l-travel', name: '🇺🇸 Travel', archived_at: null },
  ],
  projects: [
    { id: 'p-notes-app', name: 'Notes app', archived_at: null },
    { id: 'p-portola', name: 'Portola 2026', archived_at: null },
  ],
}

test('among exact matches, the longer matched span beats kind order', () => {
  assert.deepEqual(kinds(suggestFilters('notes app', [], review)).slice(0, 2), ['project:p-notes-app', 'type:note'])
})

test('among prefix matches, the longer span wins', () => {
  const list = suggestFilters('portola 20', [], review)
  assert.deepEqual(kinds(list), ['project:p-portola', 'label:l-parch'])
  assert.deepEqual(acceptSuggestion({ pills: [], text: 'portola 20' }, list[0]).text, '')
})

test('a multi-word name matches any run of consecutive words, not only the whole text', () => {
  const [s] = suggestFilters('recap portola 2026', [], review)
  assert.equal(`${s.pill.kind}:${s.pill.value}`, 'project:p-portola')
  assert.equal(s.exact, true)
  assert.deepEqual(acceptSuggestion({ pills: [], text: 'recap portola 2026' }, s), {
    pills: [{ kind: 'project', value: 'p-portola', name: 'Portola 2026' }],
    text: 'recap ',
  })
  const [mid] = suggestFilters('send portola 2026 recap', [], review)
  assert.deepEqual(acceptSuggestion({ pills: [], text: 'send portola 2026 recap' }, mid).text, 'send recap ')
})

test('flag emoji (regional indicators) are stripped', () => {
  assert.equal(fold('🇺🇸 Travel'), 'travel')
  assert.deepEqual(kinds(suggestFilters('travel', [], review)), ['label:l-travel'])
})

test('type beats label on an exact tie of the same span', () => {
  assert.deepEqual(kinds(suggestFilters('notes', [], review)).slice(0, 2), ['type:note', 'label:l-notes'])
})

test('"complete" is an exact alias of completed', () => {
  const [s] = suggestFilters('complete', [], catalog)
  assert.equal(`${s.pill.kind}:${s.pill.value}`, 'status:completed')
  assert.equal(s.exact, true)
})
