import { create } from 'zustand'

/* Open/closed state for the shortcuts help panel, lifted out of HelpPanel
   so the Dashboard `?` handler can toggle it (shell audit P1-1). */
interface HelpPanelState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useHelpPanelStore = create<HelpPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
