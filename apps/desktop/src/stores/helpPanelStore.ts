import { create } from 'zustand'

/* Open/closed state for the shortcuts help panel, lifted out of HelpPanel
   so the Dashboard `?` handler can toggle it (shell audit P1-1).

   Closing is two-phase so every close path — `?`, Escape, click-outside,
   the floating button — plays the same 150ms exit transition: `requestClose`
   flags `closing` while the panel stays mounted; the panel's effect calls
   `finishClose` when the transition ends. */
interface HelpPanelState {
  open: boolean
  /** True while the exit transition plays; `open` stays true until finishClose. */
  closing: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  requestClose: () => void
  finishClose: () => void
}

export const useHelpPanelStore = create<HelpPanelState>((set) => ({
  open: false,
  closing: false,
  setOpen: (open) => set({ open, closing: false }),
  requestClose: () => set((s) => (s.open ? { closing: true } : {})),
  finishClose: () => set({ open: false, closing: false }),
  toggle: () =>
    set((s) => {
      if (!s.open) return { open: true, closing: false }
      // Pressed during the exit transition: cancel the close and stay open,
      // so a quick `?` never gets swallowed.
      return s.closing ? { closing: false } : { closing: true }
    }),
}))
