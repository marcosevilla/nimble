import { create } from 'zustand'
import type { BriefSettings } from '@nimble/types'
import { draftFrom, type SetupDraft } from '@/lib/briefLayout'

export const SETUP_STEPS = 6

/* The Today setup's session state (not persisted): open, step and draft
   survive a detour to Settings → Connections from step 4. Closing only
   happens after a successful save, which sets today.setup_completed_at,
   so the first-visit trigger can't loop. */
interface TodaySetupState {
  open: boolean
  step: number
  draft: SetupDraft | null
  start: (from: BriefSettings) => void
  go: (step: number) => void
  patch: (patch: Partial<SetupDraft>) => void
  close: () => void
}

export const useTodaySetupStore = create<TodaySetupState>((set) => ({
  open: false,
  step: 0,
  draft: null,
  start: (from) => set({ open: true, step: 0, draft: draftFrom(from) }),
  go: (step) => set({ step: Math.max(0, Math.min(SETUP_STEPS - 1, step)) }),
  patch: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),
  close: () => set({ open: false, step: 0, draft: null }),
}))
