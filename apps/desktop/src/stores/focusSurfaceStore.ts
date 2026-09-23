import { create } from 'zustand'

/**
 * Per-window focus presentation only: whether the expanded focus view
 * replaces the page, and the completion acknowledgement currently shown.
 * Nothing here is timing or queue state — that lives in the engine and its
 * snapshot cache (`focusStore.ts`). Toggling presentation never starts,
 * pauses or resets a timer.
 */
export interface FocusCelebrationState {
  /** Unique per completion, so a repeat of the same title re-announces. */
  id: number
  title: string
  totalMs: number
  /** The next entry, already selected paused; shown, never started. */
  nextTitle: string | null
  /** Nothing left queued after this completion. */
  queueEmpty: boolean
}

interface FocusSurfaceState {
  expanded: boolean
  celebration: FocusCelebrationState | null
  setExpanded: (expanded: boolean) => void
  celebrate: (c: Omit<FocusCelebrationState, 'id'>) => void
  dismissCelebration: () => void
}

let nextId = 1

export const useFocusSurface = create<FocusSurfaceState>((set) => ({
  expanded: false,
  celebration: null,
  setExpanded: (expanded) => set({ expanded }),
  celebrate: (c) => set({ celebration: { ...c, id: nextId++ } }),
  dismissCelebration: () => set({ celebration: null }),
}))
