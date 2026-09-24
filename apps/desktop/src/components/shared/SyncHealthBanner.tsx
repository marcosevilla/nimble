import { useCallback, useEffect, useState } from 'react'
import { OctagonAlert, TriangleAlert, X } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'
import { openSettings } from '@/stores/settingsNavStore'
import { syncHealth, type SyncHealth, type SyncHealthInput } from '@/lib/syncHealth'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
import { Icon } from '@/components/shared/Icon'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const POLL_MS = 60_000

/* The problem the user dismissed, for this app session only — module
   memory, never storage, so a relaunch while still unhealthy shows it
   again (Marco 2026-09-24). Outlives a remount of the shell. */
let sessionDismissed: SyncHealth | null = null

/**
 * Persistent bottom-right notice for a Todoist sync that has gone quiet or
 * started failing — the R1 gap where a 401 sat silent for three weeks.
 * Renders nothing while sync is off or healthy; no-guilt phrasing. A
 * floating notice (Agentation pass 3, A4) so the page never shifts: it sits
 * just above the `?` help button, inside the right rail's footprint (w-64
 * fits the 288px rail) where it covers the rail's quiet bottom rather than
 * task rows. One notice per problem; Dismiss hides it
 * until a different problem shows up or the app relaunches. Polls status
 * every 60s plus on window focus so a fix elsewhere (re-auth in Settings)
 * clears it promptly.
 */
export function SyncHealthBanner() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<SyncHealthInput | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [dismissed, setDismissed] = useState<SyncHealth | null>(sessionDismissed)

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

  const health = status ? syncHealth(status, new Date()) : null
  const healthy = health === 'ok' || health === 'off'

  // Back to healthy: the next problem, even the same kind, is new.
  useEffect(() => {
    if (!healthy) return
    sessionDismissed = null
    setDismissed(null)
  }, [healthy])

  if (!health || healthy || dismissed === health) return null

  const isError = health === 'error'

  const dismiss = () => {
    sessionDismissed = health
    setDismissed(health)
  }

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
      aria-live="polite"
      className="panel-in fixed right-4 bottom-16 z-20 flex w-64 items-start gap-2.5 rounded-lg border border-border bg-popover py-3 pr-2 pl-3 text-popover-foreground shadow-popover"
    >
      <Icon
        icon={isError ? OctagonAlert : TriangleAlert}
        className={cn('mt-0.5', isError ? 'text-destructive' : 'text-warning')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-body">
          {isError
            ? "Todoist sync paused. Todoist didn't accept the last sync."
            : "Todoist hasn't synced in over an hour."}
        </p>
        <div className="mt-2 flex">
          {isError ? (
            <Button variant="secondary" size="sm" onClick={() => openSettings('todoist-sync')}>
              Open settings
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={syncing} onClick={() => void syncNow()}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </div>
      </div>
      {/* tabIndex: WebKit leaves a bare <button> out of the Tab order */}
      <IconButton onClick={dismiss} aria-label="Dismiss" title="Dismiss" tabIndex={0}>
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
