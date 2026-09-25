import { useCallback, useEffect, useState } from 'react'
import type { Label, LabelGroup } from '@nimble/types'
import { getDataProvider } from '@/services/provider-context'
import { subscribeDataChanges } from '@/lib/dataChanges'

export interface LabelTaxonomy {
  labels: Label[]
  groups: LabelGroup[]
}

// One module-level cache for every row, picker, filter and the Label
// Manager: N visible rows must not each fetch the label table. Invalidated
// by `tasks-changed` (labels can be created inline) and the `labels` data
// domain (another window, `dt`, a sync). `generation` drops a slower,
// older fetch that resolves after a newer one.
let cache: LabelTaxonomy | null = null
let inflight: Promise<LabelTaxonomy> | null = null
let generation = 0
const subscribers = new Set<(t: LabelTaxonomy) => void>()

export function fetchLabelTaxonomy(force = false): Promise<LabelTaxonomy> {
  if (force) {
    cache = null
    inflight = null
  }
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    const mine = ++generation
    // Resolve the provider at call time, never at module eval.
    const dp = getDataProvider()
    inflight = Promise.all([dp.labels.list(), dp.labels.groups.list().catch(() => [] as LabelGroup[])])
      .then(([labels, groups]) => {
        if (mine !== generation) return cache ?? { labels, groups }
        cache = { labels, groups }
        for (const notify of subscribers) notify(cache)
        return cache
      })
      .catch((e: unknown) => {
        if (mine === generation) inflight = null
        throw e
      })
  }
  return inflight
}

if (typeof window !== 'undefined') {
  const refresh = () => { fetchLabelTaxonomy(true).catch(() => {}) }
  window.addEventListener('tasks-changed', refresh)
  subscribeDataChanges('labels', refresh)
}

export function useLabelTaxonomy(): LabelTaxonomy & { loading: boolean; reload: () => void } {
  const [state, setState] = useState<LabelTaxonomy>(() => cache ?? { labels: [], groups: [] })
  const [loading, setLoading] = useState(cache === null)
  useEffect(() => {
    let live = true
    const onChange = (t: LabelTaxonomy) => {
      if (!live) return
      setState(t)
      setLoading(false)
    }
    subscribers.add(onChange)
    fetchLabelTaxonomy().then(onChange, () => { if (live) setLoading(false) })
    return () => {
      live = false
      subscribers.delete(onChange)
    }
  }, [])
  const reload = useCallback(() => { fetchLabelTaxonomy(true).catch(() => {}) }, [])
  return { ...state, loading, reload }
}
