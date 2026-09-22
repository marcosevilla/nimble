/**
 * A pending action that settles exactly once: either it is undone or it is
 * committed, never both, and never twice. Wire `commit` to the toast's
 * lifecycle (auto-close / dismiss) and `undo` to its Undo button, so Undo is
 * only live while the commit hasn't happened. Each call returns whether it
 * was the one that settled the action.
 */
export interface Undoable {
  readonly settled: boolean
  undo(): boolean
  commit(): boolean
}

export function createUndoable(handlers: { onCommit: () => void; onUndo: () => void }): Undoable {
  let settled = false
  const settle = (fn: () => void) => {
    if (settled) return false
    settled = true
    fn()
    return true
  }
  return {
    get settled() { return settled },
    undo: () => settle(handlers.onUndo),
    commit: () => settle(handlers.onCommit),
  }
}
