import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createDeferredDeletes, DEFERRED_DELETE_MS } from '@/lib/deferredDelete'
import { showUndoToast } from '@/components/shared/undoToast'

/**
 * Deferred-commit delete for one list surface (labels, capture routes, docs).
 * `defer(id, message, commit)` hides the row at once and shows a 5 s Undo
 * toast; Undo un-hides it in place, the toast closing runs `commit` (the
 * real delete — it handles its own errors and list update). Callers filter
 * their rows through `hidden`, so a pending row stays out of view even if
 * the list refetches, and comes back at its original position on Undo.
 *
 * Unmount (navigating away) commits everything still pending right away and
 * clears those toasts, so a delete is never lost and never runs twice.
 */
export function useDeferredDeletes() {
  const [queue] = useState(createDeferredDeletes)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const toastIds = useRef(new Map<string, string>())

  const setHiddenFor = useCallback((id: string, on: boolean) => {
    setHidden((prev) => {
      if (prev.has(id) === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    const ids = toastIds.current
    return () => {
      const open = [...ids.values()]
      queue.flushAll()
      for (const id of open) toast.dismiss(id)
    }
  }, [queue])

  const defer = useCallback((
    id: string,
    message: string,
    commit: () => Promise<unknown>,
    opts: { onUndo?: () => void } = {},
  ) => {
    if (queue.isPending(id)) return
    setHiddenFor(id, true)
    const pending = queue.schedule(id, {
      onCommit: () => {
        toastIds.current.delete(id)
        // Un-hide only once the delete has landed (the row is gone from the
        // list by then) or failed (the row should come back).
        // `commit` reports its own failures; this catch only keeps a stray
        // rejection from going unhandled.
        void Promise.resolve()
          .then(commit)
          .catch((e) => console.error('Deferred delete failed', e))
          .finally(() => setHiddenFor(id, false))
      },
      onUndo: () => {
        toastIds.current.delete(id)
        setHiddenFor(id, false)
        opts.onUndo?.()
      },
    })
    toastIds.current.set(id, showUndoToast(message, pending, DEFERRED_DELETE_MS))
  }, [queue, setHiddenFor])

  return { hidden, defer }
}
