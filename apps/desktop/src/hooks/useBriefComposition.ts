import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Brief, BriefItem } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { subscribeDataChanges } from '@/lib/dataChanges'
import { composeView, type ComposeView } from '@/lib/briefItems'

// One first-open compose per date per window, shared across remounts and
// StrictMode's double effect, so leaving Today and coming back never re-calls.
const firstOpen = new Map<string, Promise<void>>()

/** After a Regenerate lands, the menu item rests this long ("Just regenerated"). */
export const REGENERATE_COOLDOWN_MS = 60_000

export interface BriefComposition {
  date: string
  /** `undefined` while loading, `null` when no row exists. */
  brief: Brief | null | undefined
  items: BriefItem[] | undefined
  view: ComposeView
  /** Past dates and the web: rows render without actions. */
  readOnly: boolean
  regenerating: boolean
  /** A Regenerate landed less than a minute ago: the menu item rests. */
  justRegenerated: boolean
  regenerate: () => void
}

/**
 * The brief row and its items for `date`, re-read on `brief` events (a
 * scheduled composition landing, Regenerate, an item state change) and on
 * task changes (items carry their task's live state). For today on the
 * desktop, once the day's data is `ready`, it asks Rust to compose if due —
 * once per date; Rust waits for an in-flight scheduled run instead of
 * starting another.
 */
export function useBriefComposition({ date, today, ready }: { date: string; today: string; ready: boolean }): BriefComposition {
  const dp = useDataProvider()
  const live = date === today && dp.brief.composeSupported
  const [loaded, setLoaded] = useState<{ date: string; brief: Brief | null; items: BriefItem[] } | null>(null)
  const [settledFor, setSettledFor] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [cooldownFor, setCooldownFor] = useState<string | null>(null)
  useEffect(() => {
    if (!cooldownFor) return
    const t = setTimeout(() => setCooldownFor(null), REGENERATE_COOLDOWN_MS)
    return () => clearTimeout(t)
  }, [cooldownFor])
  const justRegenerated = cooldownFor === date
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let alive = true
    const load = () => {
      Promise.all([dp.brief.get(date).catch(() => null), dp.brief.items(date).catch(() => [] as BriefItem[])]).then(
        ([brief, items]) => {
          if (alive) setLoaded({ date, brief, items })
        },
      )
    }
    load()
    const offBrief = subscribeDataChanges('brief', load)
    window.addEventListener('tasks-changed', load)
    return () => {
      alive = false
      offBrief()
      window.removeEventListener('tasks-changed', load)
    }
  }, [dp, date, version])

  const shown = loaded?.date === date ? loaded : null
  const hasRow = shown !== null
  const composed = !!shown?.brief?.composed_at
  const settled = settledFor === date

  useEffect(() => {
    if (!live || !ready || !hasRow || composed || settled) return
    let alive = true
    let pending = firstOpen.get(date)
    if (!pending) {
      pending = dp.brief.composeIfDue(date).then(
        () => undefined,
        () => undefined,
      )
      firstOpen.set(date, pending)
    }
    pending.then(() => {
      if (!alive) return
      setSettledFor(date)
      reload()
    })
    return () => {
      alive = false
    }
  }, [live, ready, hasRow, composed, settled, date, dp, reload])

  const regenerate = useCallback(() => {
    if (!live || regenerating || justRegenerated) return
    setRegenerating(true)
    dp.brief
      .regenerate(date)
      .then(() => {
        setCooldownFor(date)
        reload()
      })
      .catch(() => {
        // Rust changed nothing (the picks on screen stay): say so calmly.
        toast('Couldn’t regenerate right now. Your brief is unchanged.')
      })
      .finally(() => setRegenerating(false))
  }, [dp, date, live, regenerating, justRegenerated, reload])

  const brief = shown ? shown.brief : undefined
  return {
    date,
    brief,
    items: shown?.items,
    view: composeView({ brief, date, today, supported: dp.brief.composeSupported, settled }),
    readOnly: !live,
    regenerating,
    justRegenerated,
    regenerate,
  }
}
