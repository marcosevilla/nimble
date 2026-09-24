import { useEffect, useState } from 'react'
import { greetingFor } from '@/lib/todayBrief'

/** The header greeting, re-read on the hour and whenever the window regains
 *  focus or visibility (decision 6: a morning greeting must not survive into
 *  the afternoon or the next day). */
export function useGreeting(): string {
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const refresh = () => setHour(new Date().getHours())
    const now = new Date()
    const msToHour = (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 + 1000
    const timer = setTimeout(refresh, msToHour)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVis) }
  }, [hour])
  return greetingFor(hour)
}
