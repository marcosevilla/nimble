import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OctagonAlert, TriangleAlert, X } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'
import { openSettings } from '@/stores/settingsNavStore'
import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { syncHealth, type SyncHealth, type SyncHealthInput } from '@/lib/syncHealth'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
import { Icon } from '@/components/shared/Icon'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const POLL_MS = 60_000
/** Side inset inside the right column, and the notice's readable minimum. */
const INSET = 16
const MIN_NOTICE = 160
const MAX_NOTICE = 320
/** The compact notice's button (size-7). */
const COMPACT = 28

/* The problem the user dismissed, for this app session only — module
   memory, never storage, so a relaunch while still unhealthy shows it
   again (Marco 2026-09-24). Outlives a remount of the shell. */
let sessionDismissed: SyncHealth | null = null

/** Live width of the shell's right column — the rail, its collapsed strip,
 *  Settings' empty slot or the detail sidebar, whichever is mounted
 *  (`[data-right-rail]`). Re-found when any of those swap. */
function useRightColumnWidth() {
  const [width, setWidth] = useState<number | null>(null)
  const page = useAppStore((s) => s.currentPage)
  const detail = useDetailStore((s) => `${s.mode}:${s.target?.id ?? ''}`)
  const collapsed = useLayoutStore((s) => s.rightCollapsed)
  useLayoutEffect(() => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('[data-right-rail]')).pop()
    if (!el) {
      setWidth(null)
      return
    }
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [page, detail, collapsed])
  return width
}

export function SyncHealthBanner() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<SyncHealthInput | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [dismissed, setDismissed] = useState<SyncHealth | null>(sessionDismissed)
  const columnWidth = useRightColumnWidth()
  const setRightCollapsed = useLayoutStore((s) => s.setRightCollapsed)
  const noticeRef = useRef<HTMLDivElement>(null)

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

  const visible = !!health && !healthy && dismissed !== health
  const compact = columnWidth !== null && columnWidth - 2 * INSET < MIN_NOTICE

  // Sonner's toasts share this corner: lift them by the notice's height
  // (+8px gap) while it shows, and drop the lift when it goes.
  useLayoutEffect(() => {
    const el = noticeRef.current
    const root = document.documentElement
    if (!visible || !el) return
    const measure = () => root.style.setProperty('--sync-notice-space', `${Math.ceil(el.getBoundingClientRect().height) + 8}px`)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--sync-notice-space')
    }
  }, [visible, compact])

  if (!visible) return null

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

  const message = isError
    ? "Todoist sync paused. Todoist didn't accept the last sync."
    : "Todoist hasn't synced in over an hour."

  // Rail collapsed: one calm warning button in the 36px strip; the message
  // stays in the live region for screen readers. Opening the rail shows the
  // full notice there.
  if (compact) {
    return (
      <div
        ref={noticeRef}
        role="status"
        aria-live="polite"
        className="panel-in fixed bottom-16 z-20"
        style={{ right: Math.max(0, ((columnWidth ?? COMPACT) - COMPACT) / 2) }}
      >
        <span className="sr-only">{message}</span>
        {/* tabIndex: WebKit leaves a bare <button> out of the Tab order */}
        <IconButton
          onClick={() => setRightCollapsed(false)}
          size="lg"
          tabIndex={0}
          title={`${message} Open the sidebar for options.`}
          aria-label="Show Todoist sync notice"
          className={cn('border border-border bg-popover shadow-popover', isError ? 'text-destructive' : 'text-warning')}
        >
          <Icon icon={isError ? OctagonAlert : TriangleAlert} />
        </IconButton>
      </div>
    )
  }

  return (
    <div
      ref={noticeRef}
      role="status"
      aria-live="polite"
      className="panel-in fixed bottom-16 z-20 flex items-start gap-2.5 rounded-lg border border-border bg-popover py-3 pr-2 pl-3 text-popover-foreground shadow-popover"
      style={{ right: INSET, width: columnWidth === null ? 256 : Math.min(MAX_NOTICE, columnWidth - 2 * INSET) }}
    >
      <Icon
        icon={isError ? OctagonAlert : TriangleAlert}
        className={cn('mt-0.5', isError ? 'text-destructive' : 'text-warning')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-body">{message}</p>
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
