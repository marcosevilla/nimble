import { useEffect, useState } from 'react'
import type { WeatherView } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'

const UNAVAILABLE: WeatherView = { status: 'unavailable', location: null, forecast: null, fetched_at: null }

/** Today's weather for the brief chip. Rust owns freshness (60-minute cache),
 *  so asking again on window focus is cheap and keeps a long-open app
 *  current without a timer. A new `key` (new day, new location) shows the
 *  skeleton until it lands; a focus refresh keeps the last view on screen.
 *  `view` is null when off or unsupported (web). */
export function useWeather(enabled: boolean, key: string): { view: WeatherView | null; loading: boolean } {
  const dp = useDataProvider()
  const on = enabled && dp.weather.supported
  const [state, setState] = useState<{ key: string; view: WeatherView } | null>(null)
  const [focusTick, setFocusTick] = useState(0)

  useEffect(() => {
    if (!on) return
    const onFocus = () => setFocusTick((t) => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [on])

  useEffect(() => {
    if (!on) return
    let live = true
    dp.weather
      .get()
      .then((view) => { if (live) setState({ key, view }) })
      .catch(() => { if (live) setState({ key, view: UNAVAILABLE }) })
    return () => { live = false }
  }, [dp, on, key, focusTick])

  const view = on && state?.key === key ? state.view : null
  return { view, loading: on && view === null }
}
