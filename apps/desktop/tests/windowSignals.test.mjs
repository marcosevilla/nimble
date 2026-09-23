import test from 'node:test'
import assert from 'node:assert/strict'
import { onWindowReturn, ownsTodoistPush } from '../src/lib/windowSignals.ts'

test('only the main window schedules the Todoist push', () => {
  assert.equal(ownsTodoistPush(''), true)
  assert.equal(ownsTodoistPush('?foo=1'), true)
  assert.equal(ownsTodoistPush('?window=focus'), false)
  assert.equal(ownsTodoistPush('?window=capture'), false)
})

test('re-reads when the window becomes visible or focused, not when hidden', () => {
  const doc = new EventTarget()
  doc.visibilityState = 'hidden'
  const win = new EventTarget()
  let calls = 0
  const stop = onWindowReturn(doc, win, () => calls++)
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(calls, 0, 'hidden: no refresh')
  doc.visibilityState = 'visible'
  doc.dispatchEvent(new Event('visibilitychange'))
  win.dispatchEvent(new Event('focus'))
  assert.equal(calls, 2)
  stop()
  doc.dispatchEvent(new Event('visibilitychange'))
  win.dispatchEvent(new Event('focus'))
  assert.equal(calls, 2, 'unsubscribed')
})
