import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DataProvider } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { createLatestGuard } from '@/lib/taskSearch'
import { isWebNotImplemented } from '@/lib/errors'
import {
  EMPTY_RESULTS, OMNIBAR_DEBOUNCE_MS, SOURCE_LIMIT, needsFetch, runSearch,
  type FetchedResults, type SearchPlan, type SearchSources,
} from '@/lib/omnibarSearch'

function sourcesFrom(dp: DataProvider): SearchSources {
  return {
    searchTasks: (q, filters) => dp.tasks.search(q, filters),
    listTasks: (opts) => dp.tasks.list(opts),
    searchNotes: (q) => dp.captures.search(q, SOURCE_LIMIT),
    searchDocs: (q) => dp.docs.searchDocuments(q),
    searchVault: (q) => dp.vault.search(q, SOURCE_LIMIT),
    searchGoals: (q) => dp.goals.search(q, SOURCE_LIMIT),
  }
}

// A failed source is an empty group: logged, never a toast. A web method that
// isn't implemented is expected (its group is hidden anyway) — not logged.
function logSourceFailure(source: string, error: unknown) {
  if (isWebNotImplemented(error)) return
  console.error(`Omnibar: ${source} search failed`, error)
}

/** Debounced fan-out for the open Omnibar. Results for an older query stay
 *  on screen until the new ones land, but they are stale meanwhile
 *  (`settled` false): the Omnibar re-searches before acting on a fetched row
 *  (Enter, click, ⌥ keys) rather than trusting it. Only the latest request
 *  may render. `searchNow` skips the debounce. */
export function useOmnibarResults(plan: SearchPlan, open: boolean): {
  results: FetchedResults
  settled: boolean
  searchNow: () => Promise<FetchedResults>
} {
  const dp = useDataProvider()
  const sources = useMemo(() => sourcesFrom(dp), [dp])
  const [guard] = useState(createLatestGuard)
  const [state, setState] = useState<{ key: string; results: FetchedResults }>({ key: '', results: EMPTY_RESULTS })
  const key = JSON.stringify(plan)
  const fetches = open && needsFetch(plan)

  // Keyed on the plan's content, not its identity: a re-memoised but equal
  // plan (new pills array, same pills) must not restart the debounce.
  const search = useCallback(async (): Promise<FetchedResults> => {
    const id = guard.next()
    const results = await runSearch(JSON.parse(key) as SearchPlan, sources, logSourceFailure)
    if (guard.isLatest(id)) setState({ key, results })
    return results
  }, [guard, sources, key])

  useEffect(() => {
    if (!fetches) {
      guard.next() // drop anything still in flight
      return
    }
    const timer = window.setTimeout(() => { void search() }, OMNIBAR_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [fetches, guard, search])

  const searchNow = useCallback(() => (fetches ? search() : Promise.resolve(EMPTY_RESULTS)), [fetches, search])

  if (!fetches) return { results: EMPTY_RESULTS, settled: true, searchNow }
  return { results: state.results, settled: state.key === key, searchNow }
}
