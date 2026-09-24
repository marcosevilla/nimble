import { createUndoable, type Undoable } from './undoable.ts'

/**
 * Deferred-commit deletes (labels, capture routes, docs). The row hides at
 * once, an Undo toast stays up for `DEFERRED_DELETE_MS`, and the real delete
 * only runs when the toast closes. Each key settles exactly once (see
 * `createUndoable`); `flushAll` commits whatever is still pending when the
 * owning surface unmounts, so leaving the page never loses a delete and the
 * toast closing later can't run it a second time.
 */
export const DEFERRED_DELETE_MS = 5_000

export interface DeferredDeletes {
  /** Register a pending delete. A key that is already pending keeps its
   * original handlers and returns its existing handle. */
  schedule(key: string, h: { onCommit: () => void; onUndo: () => void }): Undoable
  /** True if this call settled `key` (ran onUndo). */
  undo(key: string): boolean
  /** True if this call settled `key` (ran onCommit). */
  commit(key: string): boolean
  isPending(key: string): boolean
  /** Pending keys in schedule order. */
  pendingKeys(): string[]
  /** Commit every pending item; returns how many. */
  flushAll(): number
}

export function createDeferredDeletes(): DeferredDeletes {
  // Map keeps insertion order, which is the schedule order.
  const pending = new Map<string, Undoable>()

  const settle = (key: string, how: 'undo' | 'commit') => {
    const handle = pending.get(key)
    return handle ? handle[how]() : false
  }

  return {
    schedule(key, h) {
      const existing = pending.get(key)
      if (existing) return existing
      // The handle leaves the queue as it settles, whichever path settles it
      // (queue call, the handle itself, or flushAll).
      const handle = createUndoable({
        onCommit: () => { pending.delete(key); h.onCommit() },
        onUndo: () => { pending.delete(key); h.onUndo() },
      })
      pending.set(key, handle)
      return handle
    },
    undo: (key) => settle(key, 'undo'),
    commit: (key) => settle(key, 'commit'),
    isPending: (key) => pending.has(key),
    pendingKeys: () => [...pending.keys()],
    flushAll() {
      let n = 0
      for (const handle of [...pending.values()]) if (handle.commit()) n++
      return n
    },
  }
}
