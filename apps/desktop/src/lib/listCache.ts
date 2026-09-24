/* Shared, lazily loaded list cache (loop 2 chunk 3, T1 review). Many rows
   each mount a picker that needs the same list (the project mark's menu), so
   the list is fetched once per page and shared instead of once per open.
   Pure (no `@/` imports) so `tests/listCache.test.mjs` can import it.

   - `load()` fetches only when there is no list yet or it was invalidated;
     concurrent loads share one request.
   - `invalidate()` marks the list stale but keeps it for display, so an
     open picker never blanks out while the fresh list is on its way. */

export interface ListCache<T> {
  /** The last loaded list (possibly stale), or null before the first load. */
  peek(): T[] | null
  load(): Promise<T[]>
  invalidate(): void
  /** Called with every newly loaded list. Returns the unsubscribe. */
  subscribe(fn: (list: T[]) => void): () => void
}

export function createListCache<T>(fetchList: () => Promise<T[]>): ListCache<T> {
  let data: T[] | null = null
  let stale = false
  let inflight: Promise<T[]> | null = null
  const subscribers = new Set<(list: T[]) => void>()

  return {
    peek: () => data,
    load() {
      if (data && !stale) return Promise.resolve(data)
      if (inflight) return inflight
      const request = fetchList().then(
        (list) => {
          if (inflight === request) {
            inflight = null
            data = list
            stale = false
            for (const fn of [...subscribers]) fn(list)
          }
          return list
        },
        (e) => {
          if (inflight === request) inflight = null
          throw e
        },
      )
      inflight = request
      return request
    },
    invalidate() {
      stale = true
      // A load already in flight may predate the change; the next load asks again.
      inflight = null
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },
  }
}
