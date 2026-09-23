import { useEffect, useState } from 'react'
import { FileInput, Minimize2, PictureInPicture2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Caption } from '@/components/shared/typography'
import { FocusQueueTray } from '@/components/focus/FocusQueueTray'
import { FocusLoadState } from '@/components/focus/FocusLoadState'
import { FocusImportDialog } from '@/components/focus/FocusImportDialog'
import { FocusDeliveryReview } from '@/components/focus/FocusDeliveryReview'
import { useFocusTrayData } from '@/hooks/useFocusTrayData'
import { focusViewKey } from '@/lib/keyGuard'
import { useDataProvider } from '@/services/provider-context'
import { FocusRequestError } from '@/services/focus-events'
import { refreshFocus, useFocusCache } from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd aria-hidden="true" className="rounded bg-muted/60 px-1 font-mono text-label text-muted-foreground">
      {children}
    </kbd>
  )
}

/**
 * Expanded focus: the Focus Queue card, Up next, Add, completed tray and
 * source footer, centered in the page area. It renders engine snapshots and
 * never starts timing by itself.
 *
 * Keys (registry: Session), through the shared key guard: Enter completes
 * the selected task (the completion acknowledgement owns Enter while it is
 * up, so a second Enter never completes the next task); Escape minimizes to
 * the banner; `s` stops (banks time, keeps the queue). Space (pause a running timer)
 * stays in the Dashboard handler.
 */
export function FocusView() {
  const snapshot = useFocusCache((s) => s.snapshot)
  const capabilities = useFocusCache((s) => s.capabilities)
  const loadError = useFocusCache((s) => s.error)
  const setExpanded = useFocusSurface((s) => s.setExpanded)
  const data = useFocusTrayData()
  const dp = useDataProvider()
  const [popOutError, setPopOutError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [sendsOpen, setSendsOpen] = useState(false)
  const canPopOut = capabilities?.companion === true
  const popOut = () => {
    setPopOutError(null)
    // A view only: opening the companion never starts or retimes anything.
    dp.focus.openCompanion().catch((error: unknown) => setPopOutError(FocusRequestError.from(error).message))
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // defaultPrevented: the Dashboard's g-chord already claimed this key.
      const key = focusViewKey({
        key: e.key,
        target: e.target as HTMLElement,
        defaultPrevented: e.defaultPrevented,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        repeat: e.repeat,
      })
      if (!key || useFocusSurface.getState().celebration) return
      if (key === 'close') {
        e.preventDefault()
        e.stopPropagation()
        setExpanded(false)
        return
      }
      const current = useFocusCache.getState().snapshot
      const first = current?.queue[0]
      if (!first || useFocusCache.getState().pending) return
      e.preventDefault()
      if (key === 'complete') void data.onAction({ kind: 'complete', occurrence_id: first.occurrence_id }).catch(() => {})
      else void data.onAction({ kind: 'stop' }).catch(() => {})
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [data, setExpanded])

  if (!snapshot) {
    return (
      <div className="flex flex-1 justify-center px-4 py-6">
        <div className="w-full max-w-md overflow-hidden rounded-lg border border-border">
          <FocusLoadState error={loadError} onRetry={() => void refreshFocus()} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 justify-center px-4 py-6 animate-in fade-in duration-(--transition-base) motion-reduce:animate-none">
      <div className="flex w-full max-w-md flex-col gap-2">
        <div className="flex items-center justify-end gap-1">
          {popOutError && (
            <Caption as="p" role="alert" className="mr-auto text-destructive">
              {popOutError}
            </Caption>
          )}
          {capabilities?.import && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setImportOpen(true)}
              title="Import tasks and time from frozen Focus Queue files"
              className="gap-1.5 text-muted-foreground"
            >
              <FileInput className="size-3" aria-hidden />
              Import
            </Button>
          )}
          {capabilities?.import && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSendsOpen(true)}
              title="Review Todoist time comments and old Focus Queue sends"
              className="gap-1.5 text-muted-foreground"
            >
              <Send className="size-3" aria-hidden />
              Sends
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={popOut}
            disabled={!canPopOut}
            title={canPopOut ? 'Open the always-on-top focus window' : capabilities?.reason ?? undefined}
            className="gap-1.5 text-muted-foreground"
          >
            <PictureInPicture2 className="size-3" aria-hidden />
            Pop out
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} className="gap-1.5 text-muted-foreground">
            <Minimize2 className="size-3" aria-hidden />
            Minimize
            <Kbd>Esc</Kbd>
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <FocusQueueTray
            snapshot={snapshot}
            capabilities={capabilities}
            tasks={data.tasks}
            projects={data.projects}
            sections={data.sections}
            completed={data.completed}
            today={data.today}
            onAction={data.onAction}
            taskOps={data.taskOps}
            soundMuted={data.soundMuted}
            onSoundMutedChange={data.setSoundMuted}
          />
        </div>
      </div>
      {importOpen && <FocusImportDialog open={importOpen} onOpenChange={setImportOpen} />}
      {sendsOpen && <FocusDeliveryReview open={sendsOpen} onOpenChange={setSendsOpen} />}
    </div>
  )
}
