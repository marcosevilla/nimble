/* Recent ⌘F queries, per device (C4). Browser storage can be missing or
   throw (private window, cleared site data), so every access is guarded and
   search works without it. Pure over a Storage-like object; node-tested. */

export const RECENT_KEY = 'nimble.taskSearch.recent'
export const RECENT_MAX = 8

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadRecent(storage: StorageLike | null): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Newest first, case-insensitive dedupe, capped. Returns the new list. */
export function pushRecent(storage: StorageLike | null, query: string): string[] {
  const q = query.trim()
  const current = loadRecent(storage)
  if (!q) return current
  const next = [q, ...current.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX)
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Not persisted this time; the list still works for this session.
  }
  return next
}
