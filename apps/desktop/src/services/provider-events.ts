/**
 * Provider-root event bridge. Mounted once per window by <DataProviderRoot>,
 * so the main window, the capture strip and the future focus companion all
 * receive the same invalidations — no surface can bypass it by skipping App.
 *
 * Desktop events arrive via Tauri; the web build aliases `listen` to a no-op
 * stub, so there the bridge relies on visibility/online gaps. Every event is
 * an invalidation only (IDs/revisions): consumers re-read through their
 * DataProvider.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { dispatchDataChanges, type DataDomain } from '@/lib/dataChanges'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { notifyFocusChanged, parseFocusChangeSignal } from './focus-events'

const TASK_DOMAINS: readonly DataDomain[] = ['tasks', 'projects', 'labels', 'sections']

export function connectProviderEvents(): () => void {
  let closed = false
  const pending: Promise<UnlistenFn>[] = [
    listen<{ version: number; domains: DataDomain[] }>('nimble-data-changed', ({ payload }) => {
      if (payload?.version !== 1 || !Array.isArray(payload.domains)) return
      dispatchDataChanges(payload.domains)
      if (payload.domains.some((d) => TASK_DOMAINS.includes(d))) emitTasksChanged()
    }),
    // Todoist and Turso pulls changed rows underneath the UI.
    listen('todoist-sync-applied', () => emitTasksChanged()),
    listen('remote-sync-applied', () => emitTasksChanged()),
    // Emitted after a focus commit; malformed payloads degrade to a full re-read.
    listen('nimble-focus-changed', ({ payload }) => notifyFocusChanged(parseFocusChangeSignal(payload))),
  ]
  // Anything committed before the listeners were registered is a revision
  // gap: once they are live, ask every focus consumer for a full snapshot.
  Promise.all(pending).then(() => { if (!closed) notifyFocusChanged() }, () => {})

  const gap = () => notifyFocusChanged()
  const onVisibility = () => { if (document.visibilityState === 'visible') gap() }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', gap)

  return () => {
    closed = true
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', gap)
    for (const p of pending) p.then((unlisten) => unlisten(), () => {})
  }
}
