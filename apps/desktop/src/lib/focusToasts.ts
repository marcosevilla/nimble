/**
 * Focus feedback in the app's normal toast (sonner), shared by the main
 * Focus view and the companion window (each mounts a Toaster). Up next
 * removal and local delete offer Undo for the same 10 seconds the old inline
 * strip did; assistant-context copy confirms or fails here, and a failure
 * keeps the manual-copy fallback one click away.
 *
 * `toastFn` is injectable for tests; production uses sonner's `toast`.
 */
import { toast } from 'sonner'
import type { CopyResult } from './focusPrompt.ts'

/** How long a removal/delete stays undoable (unchanged from the inline strip). */
export const FOCUS_UNDO_MS = 10_000

type ToastOptions = {
  duration?: number
  action?: { label: string; onClick: (event: { preventDefault(): void }) => void }
}
type ToastCall = (message: string, options?: ToastOptions) => unknown
export type FocusToastFn = ToastCall & { success: ToastCall; error: ToastCall }

/**
 * `onUndo` returns false when Undo can't run right now (queue writes
 * blocked, another focus command in flight): the toast then stays open so
 * the user can try again while it is still valid.
 */
type UndoHandler = () => boolean | void

const undoAction = (onUndo: UndoHandler) => ({
  label: 'Undo',
  onClick: (event: { preventDefault(): void }) => {
    if (onUndo() === false) event.preventDefault()
  },
})

export function showRemovedToast(title: string, onUndo: UndoHandler, toastFn: FocusToastFn = toast) {
  toastFn(`Removed “${title}” from queue`, { duration: FOCUS_UNDO_MS, action: undoAction(onUndo) })
}

/** A local-only delete; Undo only when the engine returned an undo token. */
export function showDeletedToast(title: string, onUndo: UndoHandler | null, toastFn: FocusToastFn = toast) {
  toastFn(`Deleted “${title}”`, onUndo ? { duration: FOCUS_UNDO_MS, action: undoAction(onUndo) } : { duration: FOCUS_UNDO_MS })
}

export function showCopyContextToast(
  result: CopyResult,
  onShowText: (text: string) => void,
  toastFn: FocusToastFn = toast,
) {
  if (result.ok) {
    toastFn.success('Assistant context copied')
    return
  }
  toastFn.error(`Couldn’t copy assistant context (${result.message})`, {
    duration: FOCUS_UNDO_MS,
    action: { label: 'Show text', onClick: () => onShowText(result.text) },
  })
}
