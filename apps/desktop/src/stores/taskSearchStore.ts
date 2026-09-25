import { create } from 'zustand'

interface TaskSearchState {
  open: boolean
  /** Bumps on every open so the dialog remounts with fresh state. */
  session: number
  initialQuery: string
  /** Where focus returns on Escape: the ⌘F opener, or ⌘K's opener on a handoff. */
  returnFocus: HTMLElement | null
  openSearch: (query?: string, returnFocus?: HTMLElement | null) => void
  close: () => void
}

export const useTaskSearchStore = create<TaskSearchState>((set) => ({
  open: false,
  session: 0,
  initialQuery: '',
  returnFocus: null,
  openSearch: (query = '', returnFocus = null) =>
    set((s) => ({ open: true, session: s.session + 1, initialQuery: query, returnFocus })),
  close: () => set({ open: false }),
}))
