/* Shared dated-convert UX for the single-note "Convert to task" action,
   used by both the Inbox row (`t`) and the capture detail panel — so
   "call mom friday" gets the same due date and the same undo, wherever it's
   converted from.

   Owns the module-level `latestKeep` slot and a single window ⌘Z listener
   (installed once — the toast, and any future convert, outlives whichever
   page triggered it). Fix round 1: converting note A then note B inside A's
   undo window used to register two independent `keydown` listeners, so one
   ⌘Z ran BOTH keeps. A single slot always points at the latest dated
   convert; only that one fires. Each toast's own "Keep as text" button still
   calls its own `keep`, unaffected by which entry currently holds the slot.

   ⌘Z is only swallowed while an undo is actually pending — with no
   `latestKeep`, the listener returns before `preventDefault()` so the key
   is left alone for anything else on the page. */
import { toast } from 'sonner'
import type { Capture, LocalTask } from '@nimble/types'
import { convertWithDate, type CaptureDp } from '@/lib/captureActions'
import { taskToast } from '@/lib/taskToast'
import { isTextEntry } from '@/lib/keyGuard'
import { useDetailStore } from '@/stores/detailStore'
import { emitTasksChanged } from '@/hooks/useLocalTasks'

let latestKeep: { run: () => void } | null = null
let undoListenerInstalled = false
function installUndoListener() {
  if (undoListenerInstalled) return
  undoListenerInstalled = true
  window.addEventListener('keydown', (e) => {
    if (
      e.key !== 'z' ||
      !(e.metaKey || e.ctrlKey) ||
      e.shiftKey ||
      e.altKey ||
      e.repeat ||
      e.defaultPrevented ||
      isTextEntry(e.target as Element | null)
    ) {
      return
    }
    if (!latestKeep) return
    e.preventDefault()
    latestKeep.run()
  })
}

/** Converts a capture to a task, dating it when its text carries a date.
 *  With a date, shows "Converted · due {label}" with "Keep as text" (via
 *  ⌘Z or its own button) and a "View" cancel button that opens the task.
 *  With no date, the plain `taskToast`. Returns the created task; throws if
 *  the conversion itself fails, so callers keep their own optimistic
 *  add/remove and error toast — this only handles the dating + undo UX. */
export async function convertCaptureWithUndo(
  dp: CaptureDp,
  capture: Pick<Capture, 'id' | 'content'>,
): Promise<LocalTask> {
  const { task, date, keepAsText } = await convertWithDate(dp, capture, new Date())
  emitTasksChanged()
  if (!date || !keepAsText) {
    taskToast(`Converted to task: "${capture.content}"`, task.id)
    return task
  }

  installUndoListener()
  // `entry`'s identity (not its contents) is the slot key — `.run` is filled
  // in below once `keep` exists, but the object itself is created first so
  // `cleanup` can compare `latestKeep === entry` from the start.
  const entry: { run: () => void } = { run: () => {} }
  let done = false
  const cleanup = () => { if (latestKeep === entry) latestKeep = null }
  const keep = async () => {
    if (done) return
    done = true
    cleanup()
    toast.dismiss(toastId)
    try {
      await keepAsText()
      emitTasksChanged()
      toast(`Kept "${capture.content}" as written`)
    } catch (e) {
      toast.error(`Couldn't restore the text: ${e}`)
    }
  }
  entry.run = () => void keep()
  latestKeep = entry
  const toastId = toast.success(`Converted · due ${date.label}`, {
    action: { label: 'Keep as text', onClick: () => void keep() },
    cancel: { label: 'View', onClick: () => useDetailStore.getState().openTask(task.id) },
    onDismiss: cleanup,
    onAutoClose: cleanup,
  })
  return task
}
