/**
 * Focus timer presentation. Pure formatting over integer-ms totals that the
 * focus service reports — never a clock of its own. Display rounding floors
 * to whole seconds and never changes stored totals.
 *
 * Count-up: amber at 25 min, deep amber at 45 min, never red.
 * Timebox: counts down to zero (neutral), then counts overtime; red
 * (`overtime`) is reserved for an exceeded timebox.
 */

import type { FocusAction } from '@nimble/types'

export type TimerPhase = 'normal' | 'amber' | 'deepAmber' | 'overtime'

export interface TimerPresentation {
  text: string
  phase: TimerPhase
}

const MINUTE_MS = 60_000
export const AMBER_MS = 25 * MINUTE_MS
export const DEEP_AMBER_MS = 45 * MINUTE_MS

const clampMs = (ms: number): number => (Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0)

/** `m:ss`, or `h:mm:ss` from one hour. Negative/NaN reads as zero. */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.floor(clampMs(ms) / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = String(totalSeconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function timerPresentation(totalMs: number, budgetMs: number | null): TimerPresentation {
  const total = clampMs(totalMs)
  if (budgetMs == null) {
    const phase = total >= DEEP_AMBER_MS ? 'deepAmber' : total >= AMBER_MS ? 'amber' : 'normal'
    return { text: formatDurationMs(total), phase }
  }
  const budget = clampMs(budgetMs)
  if (total > budget) return { text: `+${formatDurationMs(total - budget)}`, phase: 'overtime' }
  // Ceil the remaining seconds so the countdown reads 0:00 only at zero.
  const remaining = budget - total
  return { text: formatDurationMs(Math.ceil(remaining / 1000) * 1000), phase: 'normal' }
}

/**
 * What dismissing the completion acknowledgement does. Always nothing: the
 * next entry is already selected paused and needs its own explicit Start.
 * Enter, Escape, Space or a click only close the acknowledgement — a
 * generic key never starts a task (spec §4 "Complete").
 */
export function completionNextAction(key: string): FocusAction | null {
  void key
  return null
}
