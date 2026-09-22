/** Local invalidation bus. Events carry identifiers, never private task bodies. */
export type DataDomain = 'tasks' | 'projects' | 'sections' | 'labels' | 'captures' | 'activity'
const subscribers = new Map<DataDomain, Set<() => void>>()
export function subscribeDataChanges(domain: DataDomain, callback: () => void): () => void {
  let callbacks = subscribers.get(domain)
  if (!callbacks) { callbacks = new Set(); subscribers.set(domain, callbacks) }
  callbacks.add(callback)
  return () => { callbacks.delete(callback) }
}
export function dispatchDataChanges(domains: DataDomain[]): void {
  for (const domain of new Set(domains)) {
    for (const callback of [...(subscribers.get(domain) ?? [])]) {
      try { callback() } catch { /* One stale view must not block other views. */ }
    }
  }
}
