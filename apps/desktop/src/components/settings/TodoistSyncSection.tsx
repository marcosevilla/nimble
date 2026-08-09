import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type { TodoistSyncStatus } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Meta } from '@/components/shared/typography'
import { toast } from 'sonner'

export function TodoistSyncSection() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<TodoistSyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const refresh = useCallback(() => {
    dp.todoistSync.status().then(setStatus).catch(() => {})
  }, [dp])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const toggle = async (enabled: boolean) => {
    setToggling(true)
    try {
      await dp.todoistSync.setEnabled(enabled)
      refresh()
    } catch (e) {
      toast.error(`Failed to update Todoist sync: ${e}`)
      refresh()
    } finally {
      setToggling(false)
    }
  }

  const syncNow = async () => {
    setSyncing(true)
    try {
      await dp.todoistSync.syncNow()
    } finally {
      setSyncing(false)
      refresh()
    }
  }

  if (!status) return null

  const statusLine = [
    status.last_sync_at ? `Last synced ${status.last_sync_at}` : 'Not synced yet',
    status.pending_ops > 0
      ? `${status.pending_ops} change${status.pending_ops === 1 ? '' : 's'} waiting`
      : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Switch
          checked={status.enabled}
          disabled={!status.connected || toggling}
          onCheckedChange={toggle}
          aria-label="Toggle Todoist sync"
        />
      </div>

      {!status.connected && (
        <Meta as="p">Add your Todoist API token above to connect.</Meta>
      )}

      {status.connected && (
        <div className="flex items-center gap-3">
          <Meta as="p">{statusLine}</Meta>
          <Button
            variant="secondary"
            size="sm"
            disabled={syncing || !status.enabled}
            onClick={syncNow}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      )}

      {(status.last_error || status.error_ops > 0) && (
        <div className="space-y-1">
          <button
            type="button"
            className="text-meta text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowErrors((v) => !v)}
          >
            Some changes couldn&apos;t sync — they&apos;ll retry automatically.
            {status.error_ops > 0 ? ` (${status.error_ops})` : ''}
          </button>
          {showErrors && (
            <ul className="space-y-0.5">
              {status.errors.map(([id, op, error]) => (
                <li key={id} className="text-meta text-muted-foreground">
                  {op}: {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
