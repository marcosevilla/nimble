import { create } from 'zustand'
import { toast } from 'sonner'
import type { BriefSettings, BriefSettingsPatch } from '@nimble/types'
import { getDataProvider } from '@/services/provider-context'
import { applySettingsPatch } from '@/lib/briefLayout'
import { createHabitLoadGate } from '@/lib/habitToggle'
import { settingsFailure, type SettingsFailure } from '@/lib/settingsMessage'

/* One copy of the brief settings for Today, the setup and the three
   Settings sections, so a change in one shows everywhere at once.
   Every save applies optimistically, then saves run one at a time in click
   order. Only the answer to the last outstanding save replaces local state:
   an earlier answer would undo patches that are still queued (Review Focus
   5 — toggle, move, toggle within a second). A failed save re-reads Rust's
   truth once nothing else is pending, instead of guessing a rollback. */

type Status = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'

interface BriefSettingsState {
  settings: BriefSettings | null
  status: Status
  /** Why the last failed save failed (cleared by the next success), for a
   *  row that shows it inline with FailureNote. */
  lastFailure: SettingsFailure | null
  load: (force?: boolean) => Promise<void>
  /** `silent`: skip the toast; the caller shows `lastFailure` inline. */
  save: (patch: BriefSettingsPatch, opts?: { silent?: boolean }) => Promise<boolean>
}

let queue: Promise<unknown> = Promise.resolve()
let outstanding = 0
/* A load (e.g. the setup's Sources step re-reading what's connected) is
   applied only if no save started after it began and none is in flight:
   otherwise its older answer could land after Finish and undo it (reopening
   the setup with setup_completed_at back to null). Same gate as habits. */
const gate = createHabitLoadGate()

export const useBriefSettingsStore = create<BriefSettingsState>((set, get) => ({
  settings: null,
  status: 'idle',
  lastFailure: null,
  load: async (force = false) => {
    const dp = getDataProvider()
    if (!dp.briefSettings.supported) {
      set({ status: 'unsupported' })
      return
    }
    const { status } = get()
    if (!force && (status === 'ready' || status === 'loading')) return
    set({ status: 'loading' })
    const ticket = gate.beginLoad()
    try {
      const settings = await dp.briefSettings.get()
      if (gate.canApply(ticket)) set({ settings, status: 'ready' })
      else if (get().settings) set({ status: 'ready' })
    } catch {
      set({ status: get().settings ? 'ready' : 'error' })
    }
  },
  save: (patch, opts) => {
    const current = get().settings
    if (current) set({ settings: applySettingsPatch(current, patch) })
    outstanding += 1
    const settle = gate.beginToggle()
    const run = queue.then(async () => {
      try {
        const next = await getDataProvider().briefSettings.save(patch)
        settle()
        if (outstanding === 1) set({ settings: next, status: 'ready' })
        set({ lastFailure: null })
        return true
      } catch (e) {
        const failure = settingsFailure(e)
        set({ lastFailure: failure })
        if (!opts?.silent) toast.error(failure.message, failure.detail ? { description: failure.detail } : undefined)
        settle()
        if (outstanding === 1) await get().load(true)
        return false
      } finally {
        settle()
        outstanding -= 1
      }
    })
    queue = run.catch(() => undefined)
    return run
  },
}))
