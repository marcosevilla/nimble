import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import { openSettings } from '@/stores/settingsNavStore'
import { syncHealth, type SyncHealthInput } from '@/lib/syncHealth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const POLL_MS = 60_000

/**
 * Shell-level strip that surfaces a Todoist sync that has gone quiet or
 * started failing — the R1 gap where a 401 sat silent for three weeks.
 * Renders nothing while sync is off or healthy; no-guilt phrasing, same
 * house banner treatment as FocusBanner. Polls status every 60s plus on
 * window focus so a fix elsewhere (re-auth in Settings) clears it promptly.
 */
export function SyncHealthBanner() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<SyncHealthInput | null>(null)
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(() => {
    dp.todoistSync.status().then(setStatus).catch(() => {})
  }, [dp])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  if (!status) return null
  const health = syncHealth(status, new Date())
  if (health === 'ok' || health === 'off') return null

  const isError = health === 'error'

  const openTodoistSettings = () => openSettings('todoist-sync')

  const syncNow = async () => {
    setSyncing(true)
    try {
      await dp.todoistSync.syncNow()
    } catch (e) {
      toast.error(`Todoist sync failed: ${e}`)
    } finally {
      setSyncing(false)
      refresh()
    }
  }

  return (
    <div
      role="status"
      className={cn(
        'flex h-10 shrink-0 items-center gap-3 border-b border-border/50 px-4 animate-in slide-in-from-top duration-(--transition-fast) motion-reduce:animate-none',
        isError ? 'bg-destructive/5' : 'bg-warning/5',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-body">
        {isError
          ? "Todoist sync paused. Todoist didn't accept the last sync."
          : "Todoist hasn't synced in over an hour."}
      </span>
      {isError ? (
        <Button variant="secondary" size="sm" onClick={openTodoistSettings}>
          Open settings
        </Button>
      ) : (
        <Button variant="secondary" size="sm" disabled={syncing} onClick={() => void syncNow()}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      )}
    </div>
  )
}
