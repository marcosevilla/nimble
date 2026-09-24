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
