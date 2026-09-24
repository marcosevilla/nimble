import { toast } from 'sonner'
import type { Undoable } from '@/lib/undoable'
import { ToastAction } from './ToastAction'

let seq = 0

/**
 * "<Thing> deleted · Undo" toast bound to a settle-once action: the toast
 * closing (auto-close after `duration`, swipe, `toast.dismiss`) commits,
 * Undo undoes. Sonner pauses the timer while the toast is hovered or the
 * window is hidden, so the commit follows the toast rather than a parallel
 * wall-clock timer. Returns the toast id.
 *
 * The Undo is our own button, not sonner's `action: { label, onClick }`:
 * sonner renders that without a tabindex and WebKit (the app's WKWebView)
 * skips a tabindex-less <button> on Tab, so the Undo was unreachable by
 * keyboard. `ToastAction` below carries tabIndex={0} and the app's focus
 * ring instead.
 */
export function showUndoToast(message: string, pending: Undoable, duration: number): string {
  const id = `undo-toast-${++seq}`
  toast(message, {
    id,
    duration,
    onAutoClose: () => { pending.commit() },
    onDismiss: () => { pending.commit() },
    action: (
      <ToastAction
        onClick={() => {
          pending.undo()
          toast.dismiss(id)
        }}
      >
        Undo
      </ToastAction>
    ),
  })
  return id
}
