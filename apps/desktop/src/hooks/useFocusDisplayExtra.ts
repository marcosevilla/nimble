import { useEffect, useState } from 'react'
import {
  checkpointMs,
  displayBaseMs,
  displayExtraFrom,
  displayExtraMs,
  displayKey,
  nextDisplayTotal,
  type DisplayMemo,
} from '@/lib/focusDisplay'
import type { FocusEntry, FocusSnapshot } from '@nimble/types'

const TICK_MS = 1_000

/**
 * Display-only running time for one card (see `lib/focusDisplay.ts`). Ticks
 * about once a second only while this entry's session is running with live
 * timing and the page is visible; the value is only ever rendered. Each
 * new snapshot snaps the base; the shown total never steps backwards within
 * one uninterrupted running stretch, and snaps to the settled total after a
 * pause, gap-pause settle or resume.
 */
export function useFocusDisplayExtra(snapshot: FocusSnapshot | null, entry: FocusEntry | null, liveTiming: boolean): number {
  const key = displayKey(snapshot, entry, liveTiming)
  const base = snapshot && entry ? displayBaseMs(snapshot, entry) : 0
  const checkpoint = snapshot?.checkpoint_at ?? null
  const [memo, setMemo] = useState<DisplayMemo | null>(null)

  useEffect(() => {
    if (key == null || !snapshot) {
      // Not running: drop the memo so a later resume starts from the snapshot.
      setMemo(null)
      return
    }
    const cp = checkpointMs(snapshot)
    const update = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      setMemo((prev) => nextDisplayTotal(prev, key, base, displayExtraMs(snapshot, key, Date.now()), cp))
    }
    const first = requestAnimationFrame(update)
    const id = setInterval(update, TICK_MS)
    document.addEventListener('visibilitychange', update)
    return () => {
      cancelAnimationFrame(first)
      clearInterval(id)
      document.removeEventListener('visibilitychange', update)
    }
    // `checkpoint` stands in for the snapshot's reference time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, base, checkpoint])

  return displayExtraFrom(memo, key, base)
}
