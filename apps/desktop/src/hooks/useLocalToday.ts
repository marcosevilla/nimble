import { useEffect, useState } from 'react'
import { localIsoDate, msUntilNextLocalDay } from '@/lib/briefDate'

/** Today's local date (`YYYY-MM-DD`), re-read at local midnight and whenever
 *  the window regains focus or visibility — a timer alone can fire late
 *  after the Mac sleeps across midnight. */
export function useLocalToday(): string {
  const [today, setToday] = useState(() => localIsoDate())

  useEffect(() => {
    const refresh = () => setToday(localIsoDate())
    // +1s so the timer never lands a hair before midnight.
    const timer = setTimeout(refresh, msUntilNextLocalDay() + 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [today])

  return today
}
