/* Which subtasks a parent's completion cascade closed (Agentation pass 3,
   C3). Completing a parent completes its open subtasks too (Rust
   `task_tx.rs` set_status_tx; the web provider's setTaskStatus), but
   reopening the parent touches only the parent — so after a reopen the app
   offers "Reopen N subtasks too?" for exactly the ones the cascade took.

   There is no cascade marker in the data, only timestamps. Rust stamps the
   parent and then its children in two statements, each with
   datetime('now','localtime') at second resolution, so a cascaded child
   carries the parent's second or one a little later — never an earlier one.
   The window is therefore [parent, parent + 2 s]: wide enough for a second
   boundary between the two statements, and a subtask finished even one
   second before the parent was the user's own completion, not the cascade's.
   Pure so `tests/cascadeReopen.test.mjs` can import it. */

export interface CascadeSubtask {
  id: string
  completed: boolean
  status?: string | null
  completed_at: string | null
}

/** How long after the parent's stamp a child's stamp may land. */
export const CASCADE_WINDOW_MS = 2000

/** Parses both stamp formats in use: Rust's local "YYYY-MM-DD HH:MM:SS"
 * and ISO 8601 (with or without a zone). NaN when unparseable. */
export function stampMs(stamp: string | null | undefined): number {
  if (!stamp) return NaN
  const s = stamp.trim()
  // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS" (no zone → local time).
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s
  return new Date(iso).getTime()
}

/** Ids of `subtasks` still complete with a completion stamp inside the
 * cascade window of `parentCompletedAt` (the parent's stamp as it was
 * before the reopen nulled it), in the order given. Empty when the parent
 * has no stamp or nothing matches — the caller shows no toast then. */
export function cascadeReopenCandidates(
  parentCompletedAt: string | null | undefined,
  subtasks: readonly CascadeSubtask[],
): string[] {
  const parent = stampMs(parentCompletedAt)
  if (Number.isNaN(parent)) return []
  const out: string[] = []
  for (const t of subtasks) {
    const done = t.completed || t.status === 'complete'
    if (!done) continue
    const at = stampMs(t.completed_at)
    if (Number.isNaN(at)) continue
    const delta = at - parent
    if (delta >= 0 && delta <= CASCADE_WINDOW_MS) out.push(t.id)
  }
  return out
}

export interface CascadeTask extends CascadeSubtask {
  parent_id: string | null
}

/** One offer for a whole reopen (a bulk Status change can reopen several
 * parents): the union, per reopened parent, of its cascade candidates
 * (`cascadeReopenCandidates` against that parent's own pre-reopen stamp),
 * minus any task that was itself part of the reopen — it already got the
 * chosen status. `parents` maps each reopened id to its `completed_at` as it
 * was BEFORE the reopen (null for a task that wasn't complete). `after` is
 * the task list read after the reopen. Deduplicated, in parent order. */
export function aggregateCascadeReopen(
  parents: ReadonlyArray<readonly [id: string, completedAt: string | null]>,
  after: readonly CascadeTask[],
): string[] {
  const reopened = new Set(parents.map(([id]) => id))
  const out: string[] = []
  const seen = new Set<string>()
  for (const [id, completedAt] of parents) {
    if (!completedAt) continue
    const children = after.filter((t) => t.parent_id === id)
    for (const childId of cascadeReopenCandidates(completedAt, children)) {
      if (reopened.has(childId) || seen.has(childId)) continue
      seen.add(childId)
      out.push(childId)
    }
  }
  return out
}
