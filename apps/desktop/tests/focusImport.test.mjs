import test from 'node:test'
import assert from 'node:assert/strict'
import { legacyFileRole, importBlockedReason, importSummary, FOCUS_QUEUE_NAMESPACE } from '../src/lib/focusImport.ts'
import { readFileSync } from 'node:fs'

test('the dialog imports under one fixed, non-editable source name', () => {
  assert.equal(FOCUS_QUEUE_NAMESPACE, 'focus-queue')
  const dialog = readFileSync(new URL('../src/components/focus/FocusImportDialog.tsx', import.meta.url), 'utf8')
  assert.match(dialog, /source_namespace: FOCUS_QUEUE_NAMESPACE/)
  assert.doesNotMatch(dialog, /setNamespace/)
  for (const field of ['preview.tasks', 'differences', 'preview.source_order', 'preview.manual_order', 'legacy_completed_today']) {
    assert.ok(dialog.includes(field), `dialog renders ${field}`)
  }
})

const preview = (over = {}) => ({
  preview_token: 't', source_namespace: 'fixture', file_hashes: {}, destination: { queue_revision: 1, engine_revision: 1, tasks_fingerprint: 'f' },
  source_kind: 'today', source_order: [], manual_order: [], merged_order: [], tasks: [], contributions: [], records: [], issues: [],
  legacy_completed_today: null, blocked: false, noop: false, ...over,
})

test('files are assigned by name and config.json is refused', () => {
  assert.equal(legacyFileRole('state.json'), 'state')
  assert.equal(legacyFileRole('/frozen/manual.json'), 'manual')
  assert.equal(legacyFileRole('pending.json'), 'pending')
  assert.equal(legacyFileRole('config.json'), 'config')
  assert.equal(legacyFileRole('notes.json'), null)
})

test('a blocked preview names every blocking reason; review notes never block', () => {
  const p = preview({ blocked: true, issues: [
    { severity: 'blocking', record_key: null, message: 'A focus session is running.' },
    { severity: 'review', record_key: 'task:m', message: 'changed' },
    { severity: 'blocking', record_key: null, message: 'Legacy task 9 matches 2 Nimble tasks.' },
  ] })
  assert.equal(importBlockedReason(p), 'A focus session is running. Legacy task 9 matches 2 Nimble tasks.')
  assert.equal(importBlockedReason(preview({ issues: [{ severity: 'review', record_key: null, message: 'x' }] })), null)
  assert.equal(importBlockedReason(preview({ noop: true })), 'Nothing new to import. These files match the last import.')
})

test('summary counts included time once and keeps quarantine visible', () => {
  const s = importSummary(preview({
    tasks: [{ action: 'create' }, { action: 'create' }, { action: 'unchanged' }],
    contributions: [
      { inclusion: 'included', duration_ms: 12345 },
      { inclusion: 'excluded', duration_ms: 12345 },
      { inclusion: 'unresolved', duration_ms: 60000 },
      { inclusion: 'included', duration_ms: 7000 },
    ],
    records: [{ status: 'quarantined', kind: 'pending' }, { status: 'quarantined', kind: 'timer' }, { status: 'included', kind: 'task' }],
  }))
  assert.deepEqual(s, { create: 2, includedMs: 19345, excludedMs: 12345, unresolved: 1, quarantined: 2, pending: 1 })
})
