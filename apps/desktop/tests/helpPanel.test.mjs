import test from 'node:test'
import assert from 'node:assert/strict'
import { useHelpPanelStore } from '../src/stores/helpPanelStore.ts'

// The help panel plays a 150ms exit transition. Every close path — the `?`
// key, Escape, click-outside, the floating button — goes through the store's
// `requestClose`, which keeps the panel mounted (`open: true`) with
// `closing: true` until the panel calls `finishClose` (shell B4 minor).

test('toggle from closed opens immediately', () => {
  useHelpPanelStore.setState({ open: false, closing: false })
  useHelpPanelStore.getState().toggle()
  const s = useHelpPanelStore.getState()
  assert.equal(s.open, true)
  assert.equal(s.closing, false)
})

test('toggle from open requests a close and stays mounted for the exit transition', () => {
  useHelpPanelStore.setState({ open: true, closing: false })
  useHelpPanelStore.getState().toggle()
  const s = useHelpPanelStore.getState()
  assert.equal(s.open, true)
  assert.equal(s.closing, true)
})

test('toggle while already closing does not reopen', () => {
  useHelpPanelStore.setState({ open: true, closing: true })
  useHelpPanelStore.getState().toggle()
  const s = useHelpPanelStore.getState()
  assert.equal(s.open, true)
  assert.equal(s.closing, true)
})

test('requestClose is a no-op when closed', () => {
  useHelpPanelStore.setState({ open: false, closing: false })
  useHelpPanelStore.getState().requestClose()
  const s = useHelpPanelStore.getState()
  assert.equal(s.open, false)
  assert.equal(s.closing, false)
})

test('finishClose unmounts and clears closing', () => {
  useHelpPanelStore.setState({ open: true, closing: true })
  useHelpPanelStore.getState().finishClose()
  const s = useHelpPanelStore.getState()
  assert.equal(s.open, false)
  assert.equal(s.closing, false)
})
