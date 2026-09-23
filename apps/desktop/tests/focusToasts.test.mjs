// Focus feedback toasts (checklist H4/H7, 2026-09-23): Up next removal and
// local delete offer Undo in the app's normal sonner toast for the same
// 10 seconds the inline strip used; assistant-context copy confirms (or
// fails) in a toast and keeps the manual-copy fallback reachable.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOCUS_UNDO_MS,
  showCopyContextToast,
  showDeletedToast,
  showRemovedToast,
} from '../src/lib/focusToasts.ts'

function fakeToast() {
  const calls = []
  const record = (kind) => (message, opts) => { calls.push({ kind, message, opts }); return calls.length }
  const t = Object.assign(record('default'), { success: record('success'), error: record('error') })
  return { t, calls }
}
const click = (call) => {
  let prevented = false
  call.opts.action.onClick({ preventDefault: () => { prevented = true } })
  return prevented
}

test('undo validity stays 10 seconds', () => {
  assert.equal(FOCUS_UNDO_MS, 10_000)
})

test('Up next removal: toast with Undo for 10 s; Undo runs once and closes the toast', () => {
  const { t, calls } = fakeToast()
  let undone = 0
  showRemovedToast('Write notes', () => { undone += 1 }, t)
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.message, 'Removed “Write notes” from queue')
  assert.equal(call.opts.duration, FOCUS_UNDO_MS)
  assert.equal(call.opts.action.label, 'Undo')
  assert.equal(click(call), false, 'toast closes after Undo')
  assert.equal(undone, 1)
})

test('Undo refused right now (queue writes blocked or a command in flight) keeps the toast open', () => {
  const { t, calls } = fakeToast()
  showRemovedToast('Write notes', () => false, t)
  assert.equal(click(calls[0]), true)
})

test('local delete: Undo only when the engine returned an undo token', () => {
  const withToken = fakeToast()
  let undone = 0
  showDeletedToast('Draft', () => { undone += 1 }, withToken.t)
  assert.equal(withToken.calls[0].message, 'Deleted “Draft”')
  assert.equal(withToken.calls[0].opts.duration, FOCUS_UNDO_MS)
  click(withToken.calls[0])
  assert.equal(undone, 1)

  const noToken = fakeToast()
  showDeletedToast('Draft', null, noToken.t)
  assert.equal(noToken.calls[0].message, 'Deleted “Draft”')
  assert.equal(noToken.calls[0].opts?.action, undefined)
})

test('copy assistant context: success toast; failure toast keeps the text reachable for manual copy', () => {
  const ok = fakeToast()
  showCopyContextToast({ ok: true }, () => assert.fail('no manual copy on success'), ok.t)
  assert.deepEqual([ok.calls[0].kind, ok.calls[0].message], ['success', 'Assistant context copied'])

  const failed = fakeToast()
  let shown = null
  showCopyContextToast({ ok: false, text: 'CTX', message: 'denied' }, (text) => { shown = text }, failed.t)
  const [call] = failed.calls
  assert.equal(call.kind, 'error')
  assert.equal(call.message, 'Couldn’t copy assistant context (denied)')
  assert.equal(call.opts.action.label, 'Show text')
  click(call)
  assert.equal(shown, 'CTX')
})
