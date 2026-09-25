import { useCallback, useEffect, useState } from 'react'
import type { MomentumRange, MomentumSummary } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { subscribeDataChanges } from '@/lib/dataChanges'
import { TASKS_CHANGED } from '@/hooks/useLocalTasks'
import { useLocalToday } from '@/hooks/useLocalToday'

const MOMENTUM_CHANGED = 'momentum-changed'

/** Tell every mounted momentum surface (box, stat tiles, settings) to re-read
 *  after a Pause or a goals save. */
export function emitMomentumChanged() {
  window.dispatchEvent(new Event(MOMENTUM_CHANGED))
}

/** Live momentum numbers for `range`. Re-reads after any task change (local
 *  mutations, dt/agent invalidations), a Pause or goals save, and when the
 *  local day turns over. `enabled = false` (web, a past brief) never calls
 *  the backend. A failed read keeps the last numbers: the box never shows an
 *  error for a read. */
export function useMomentumSummary(range: MomentumRange, enabled = true) {
  const dp = useDataProvider()
  const today = useLocalToday()
  const [summary, setSummary] = useState<MomentumSummary | null>(null)
  const [loading, setLoading] = useState(enabled)

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      setSummary(await dp.momentum.summary(range))
    } catch {
      // keep the last numbers
    } finally {
      setLoading(false)
    }
  }, [dp, range, enabled])

  useEffect(() => {
    void refresh()
  }, [refresh, today])

  useEffect(() => {
    if (!enabled) return
    const on = () => { void refresh() }
    window.addEventListener(TASKS_CHANGED, on)
    window.addEventListener(MOMENTUM_CHANGED, on)
    const offTasks = subscribeDataChanges('tasks', on)
    const offActivity = subscribeDataChanges('activity', on)
    return () => {
      window.removeEventListener(TASKS_CHANGED, on)
      window.removeEventListener(MOMENTUM_CHANGED, on)
      offTasks()
      offActivity()
    }
  }, [enabled, refresh])

  return { summary, loading, refresh }
}
