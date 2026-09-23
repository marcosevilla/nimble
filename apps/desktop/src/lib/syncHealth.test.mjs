import assert from 'node:assert/strict'
import test from 'node:test'
import { syncHealth } from './syncHealth.ts'

const now = new Date('2026-09-23T12:00:00')

test('off when disabled', () => {
  assert.equal(syncHealth({ enabled: false, last_sync_at: null, last_error: null }, now), 'off')
})

test('error wins', () => {
  assert.equal(
    syncHealth({ enabled: true, last_sync_at: '2026-09-23 11:59:00', last_error: '401' }, now),
    'error',
  )
})

test('stale after an hour', () => {
  assert.equal(
    syncHealth({ enabled: true, last_sync_at: '2026-09-23 10:30:00', last_error: null }, now),
    'stale',
  )
})

test('ok when recent', () => {
  assert.equal(
    syncHealth({ enabled: true, last_sync_at: '2026-09-23 11:30:00', last_error: null }, now),
    'ok',
  )
})
