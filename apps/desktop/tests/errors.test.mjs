import test from 'node:test'
import assert from 'node:assert/strict'
import { friendlyError, friendlyErrorOrNull, isMissingTodayNote, isWebNotImplemented } from '../src/lib/errors.ts'

test('a missing vault-root today.md is recognised', () => {
  assert.equal(isMissingTodayNote('Failed to read today.md: not found'), true)
  assert.equal(isMissingTodayNote(new Error('Failed to read today.md: not found')), true)
})

test('other not-found errors are not mistaken for a missing today.md', () => {
  assert.equal(isMissingTodayNote('Failed to read Quick Captures.md: not found'), false)
  assert.equal(isMissingTodayNote('Vault path not found'), false)
  assert.equal(isMissingTodayNote(undefined), false)
})

test('a vault-path not-found error still gets the vault-path message', () => {
  assert.match(friendlyError('Vault path not found'), /vault path/)
})

test('a missing today.md or Quick Captures.md still gets the vault-path message', () => {
  assert.match(friendlyError('Failed to read today.md: not found'), /vault path/)
  assert.match(friendlyError('Failed to read Quick Captures.md: not found'), /vault path/)
})

test('a generic not-found error (e.g. a 404 iCal feed or a missing Todoist item) does not get the vault-path message', () => {
  assert.doesNotMatch(friendlyError('Item not found'), /vault path/)
  assert.doesNotMatch(friendlyError('Request failed: 404 Not Found'), /vault path/)
  assert.doesNotMatch(friendlyError('Document not found'), /vault path/)
})

test('an "Obsidian vault path not configured" error still gets the configuration message, not the vault-path one', () => {
  const msg = friendlyError('Obsidian vault path not configured')
  assert.match(msg, /configuration/)
  assert.doesNotMatch(msg, /vault path/)
})

test('a WebNotImplementedError from the web provider is recognised', () => {
  const err = new Error('obsidian.readTodayMd() is not implemented in the web client yet.')
  err.name = 'WebNotImplementedError'
  assert.equal(isWebNotImplemented(err), true)
})

test('an ordinary error or non-error value is not mistaken for WebNotImplementedError', () => {
  assert.equal(isWebNotImplemented(new Error('boom')), false)
  assert.equal(isWebNotImplemented('plain string'), false)
  assert.equal(isWebNotImplemented(undefined), false)
})

test('friendlyErrorOrNull resolves a not-yet-implemented web method to null, not a message', () => {
  // e.g. useCalendar on web, where calendar.getCachedEvents/fetchEvents are
  // both ni() -- this should let the panel show a calm empty state instead
  // of a permanent "Calendar offline. Retry" that can never succeed.
  const err = new Error('calendar.getCachedEvents() is not implemented in the web client yet.')
  err.name = 'WebNotImplementedError'
  assert.equal(friendlyErrorOrNull(err), null)
})

test('friendlyErrorOrNull falls back to friendlyError for a real error', () => {
  assert.equal(friendlyErrorOrNull('network request failed'), friendlyError('network request failed'))
})
