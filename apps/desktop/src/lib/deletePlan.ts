/* What a task delete really removes (review I1). `delete_local_task`
   cascades to subtasks, and the frontend Undo can only re-create what it
   snapshotted, so a delete that takes subtasks with it gets a confirm and
   no Undo; a delete of leaves stays optimistic with an Undo. Pure so
   `tests/deletePlan.test.mjs` can import it. */

export interface TaskLike {
  id: string
  parent_id: string | null
}

export interface DeletePlan<T extends TaskLike> {
  /** Tasks to call delete on — a selected task whose ancestor is also
   * selected is left to the cascade. */
  roots: T[]
  /** Subtasks (any depth) the cascade removes along with `roots`. */
  subtaskCount: number
  /** True when anything beyond the roots goes: confirm first, no Undo. */
  needsConfirm: boolean
}

export function planTaskDelete<T extends TaskLike>(selected: readonly T[], all: readonly TaskLike[]): DeletePlan<T> {
  const parentOf = new Map<string, string | null>()
  for (const t of all) parentOf.set(t.id, t.parent_id)
  for (const t of selected) if (!parentOf.has(t.id)) parentOf.set(t.id, t.parent_id)

  const underAny = (id: string, ids: Set<string>): boolean => {
    const seen = new Set<string>()
    let p = parentOf.get(id) ?? null
    while (p && !seen.has(p)) {
      if (ids.has(p)) return true
      seen.add(p)
      p = parentOf.get(p) ?? null
    }
    return false
  }

  const selectedIds = new Set(selected.map((t) => t.id))
  const roots = selected.filter((t) => !underAny(t.id, selectedIds))
  const rootIds = new Set(roots.map((t) => t.id))
  let subtaskCount = 0
  for (const id of parentOf.keys()) {
    if (!rootIds.has(id) && underAny(id, rootIds)) subtaskCount++
  }
  return { roots, subtaskCount, needsConfirm: subtaskCount > 0 }
}

const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Confirm title, sentence case. */
export function deleteConfirmTitle(rootCount: number, subtaskCount: number): string {
  return rootCount === 1
    ? `Delete this task and its ${n(subtaskCount, 'subtask')}?`
    : `Delete ${n(rootCount, 'task')} and their ${n(subtaskCount, 'subtask')}?`
}
