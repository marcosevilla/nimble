import { useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'

/* Whether Todoist sync is on — gates the read-only rule of Todoist-owned
   recurring tasks (lib/todoistRecurrence). One status read shared by every
   mounted row, refreshed at most once a minute. The web has no Todoist status
   and assumes sync is on, as its completion path does. The backend is the
   authority either way (`recurrence_locked`). */

const TTL_MS = 60_000
let cached: { on: boolean; at: number } | null = null
let inflight: Promise<boolean> | null = null

export function useTodoistSyncOn(): boolean {
  const dp = useDataProvider()
  const [on, setOn] = useState(cached?.on ?? true)
  useEffect(() => {
    let live = true
    if (cached && Date.now() - cached.at < TTL_MS) {
      setOn(cached.on)
      return
    }
    inflight ??= dp.todoistSync
      .status()
      .then((s) => s.enabled && s.connected)
      .catch(() => true)
      .then((v) => {
        cached = { on: v, at: Date.now() }
        inflight = null
        return v
      })
    void inflight.then((v) => {
      if (live) setOn(v)
    })
    return () => {
      live = false
    }
  }, [dp])
  return on
}
