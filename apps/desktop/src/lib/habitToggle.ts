/* Optimistic habit check-off (goals audit P1-3, §1.6).

   Pure so node can test it: `goalsStore.toggleHabit` supplies the store's
   habits, its `set`, and the provider's log/unlog. The flip is written
   before the call; on failure the original list is written back and the
   error is rethrown so the caller can toast. */

export interface ToggleableHabit {
  id: string
  today_completed: boolean
}

export function flipHabit<H extends ToggleableHabit>(habits: H[], id: string): H[] {
  return habits.map((h) => (h.id === id ? { ...h, today_completed: !h.today_completed } : h))
}

export async function toggleHabitOptimistically<H extends ToggleableHabit>(opts: {
  habits: H[]
  id: string
  write: (habits: H[]) => void
  log: (id: string) => Promise<unknown>
  unlog: (id: string) => Promise<unknown>
}): Promise<void> {
  const { habits, id, write, log, unlog } = opts
  const before = habits
  const target = habits.find((h) => h.id === id)
  if (!target) return
  write(flipHabit(habits, id))
  try {
    if (target.today_completed) await unlog(id)
    else await log(id)
  } catch (e) {
    write(before)
    throw e
  }
}
