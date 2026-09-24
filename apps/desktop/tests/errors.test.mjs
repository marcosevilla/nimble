import test from 'node:test'
import assert from 'node:assert/strict'
import { friendlyError, isMissingTodayNote } from '../src/lib/errors.ts'

test('a missing vault-root today.md is recognised', () => {
  assert.equal(isMissingTodayNote('Failed to read today.md: not found'), true)
  assert.equal(isMissingTodayNote(new Error('Failed to read today.md: not found')), true)
})

test('other not-found errors are not mistaken for a missing today.md', () => {
  assert.equal(isMissingTodayNote('Failed to read Quick Captures.md: not found'), false)
  assert.equal(isMissingTodayNote('Vault path not found'), false)
  assert.equal(isMissingTodayNote(undefined), false)
})

test('other not-found errors still get the vault-path message', () => {
  assert.match(friendlyError('Vault path not found'), /vault path/)
})
