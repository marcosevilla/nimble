/* Optimistic habit check-off (goals audit P1-3, §1.6).

   Pure so node can test it: `goalsStore.toggleHabit` supplies the store's
   habits, its `set`, and the provider's log/unlog. The flip is written
   before the call; on failure only that habit's value is restored and the
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
  /** Current list at rollback time; defaults to the snapshot. Pass the store's
   *  getter so a failed call reverts only its own habit, not a concurrent flip. */
  read?: () => H[]
  log: (id: string) => Promise<unknown>
  unlog: (id: string) => Promise<unknown>
}): Promise<void> {
  const { habits, id, write, log, unlog } = opts
  const target = habits.find((h) => h.id === id)
  if (!target) return
  const original = target.today_completed
  write(flipHabit(habits, id))
  try {
    if (original) await unlog(id)
    else await log(id)
  } catch (e) {
    const current = opts.read ? opts.read() : habits
    write(current.map((h) => (h.id === id ? { ...h, today_completed: original } : h)))
    throw e
  }
}

/* Orders habit reloads against optimistic toggles (goals review minor 1).
   A reload result is applied only if it is the latest reload, no toggle
   started after it began, and no toggle is still in flight — otherwise it
   could carry pre-toggle server state over a newer optimistic flip. The
   last toggle to settle triggers the reload that does apply. */
export interface HabitLoadTicket {
  load: number
  mutation: number
}

export function createHabitLoadGate() {
  let loadSeq = 0
  let mutationSeq = 0
  let inFlight = 0
  return {
    beginToggle(): () => void {
      mutationSeq++
      inFlight++
      let settled = false
      return () => { if (!settled) { settled = true; inFlight-- } }
    },
    beginLoad(): HabitLoadTicket {
      return { load: ++loadSeq, mutation: mutationSeq }
    },
    canApply(t: HabitLoadTicket): boolean {
      return t.load === loadSeq && t.mutation === mutationSeq && inFlight === 0
    },
    get pending(): number { return inFlight },
  }
}
