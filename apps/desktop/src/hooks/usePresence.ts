import { useEffect, useState } from 'react'
import { motionMs, type MotionToken } from '@/lib/motion'

/** Keeps a surface mounted while its exit plays (loop 4 P2-18).
 *
 *  `show` true → `{ mounted: true, exiting: false }` (render with `.panel-in`).
 *  `show` false → `exiting: true` for motionMs(token) (render with
 *  `.panel-out`), then `mounted: false`. Under reduced motion the token reads
 *  0, so the surface goes at once. Showing again mid-exit cancels the exit. */
export function usePresence(show: boolean, token: MotionToken = '--transition-base') {
  const [lingering, setLingering] = useState(false)
  // Adjust-state-during-render: remember that the surface was up, so the
  // render where `show` flips false still mounts it (as exiting).
  if (show && !lingering) setLingering(true)

  useEffect(() => {
    if (show || !lingering) return
    const t = window.setTimeout(() => setLingering(false), motionMs(token))
    return () => window.clearTimeout(t)
  }, [show, lingering, token])

  return { mounted: show || lingering, exiting: !show && lingering }
}

/** `value` while live; the last live value while `hold` is set — so an
 *  exiting surface keeps its last content ("3 selected", not "0 selected")
 *  instead of re-rendering the state that made it leave. Primitives only:
 *  it compares with Object.is. */
export function useLatched<T>(value: T, hold: boolean): T {
  const [kept, setKept] = useState(value)
  if (!hold && !Object.is(kept, value)) setKept(value)
  return hold ? kept : value
}
