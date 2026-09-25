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
  /** Close for another overlay (⌘K): focus does not return anywhere, and the
   *  original opener is handed back so that overlay can restore to it. */
  closeForHandoff: () => HTMLElement | null
}

export const useTaskSearchStore = create<TaskSearchState>((set, get) => ({
  open: false,
  session: 0,
  initialQuery: '',
  returnFocus: null,
  openSearch: (query = '', returnFocus = null) =>
    set((s) => ({ open: true, session: s.session + 1, initialQuery: query, returnFocus })),
  close: () => set({ open: false }),
  closeForHandoff: () => {
    const opener = get().returnFocus
    set({ open: false, returnFocus: null })
    return opener
  },
}))
