import test from 'node:test'
import assert from 'node:assert/strict'
import { OMNIBAR_ACTIONS, matchActions } from '../src/lib/omnibarActions.ts'
import { SHORTCUTS } from '../src/lib/shortcuts.ts'

test('an empty query lists every action (the default Actions list)', () => {
  assert.equal(matchActions('').length, OMNIBAR_ACTIONS.length)
  assert.equal(matchActions('   ').length, OMNIBAR_ACTIONS.length)
})

test('every typed word must start a word of the label or a keyword', () => {
  assert.deepEqual(matchActions('go sett').map((a) => a.id), ['go-settings'])
  assert.deepEqual(matchActions('PREFERENCES').map((a) => a.id), ['go-settings'])
  assert.deepEqual(matchActions('go on a 4K run'), [])
})

test('each action shows a shortcut that exists in the registry', () => {
  const keys = new Set(SHORTCUTS.map((s) => s.keys))
  for (const a of OMNIBAR_ACTIONS) assert.ok(keys.has(a.hint), `${a.id}: ${a.hint}`)
})
