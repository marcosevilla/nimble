import { useEffect, useState } from 'react'
import { Minimize2, PictureInPicture2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Caption } from '@/components/shared/typography'
import { FocusQueueTray } from '@/components/focus/FocusQueueTray'
import { FocusLoadState } from '@/components/focus/FocusLoadState'
import { useFocusTrayData } from '@/hooks/useFocusTrayData'
import { shouldIgnoreKey } from '@/lib/keyGuard'
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
  const canPopOut = capabilities?.companion === true
  const popOut = () => {
    setPopOutError(null)
    // A view only: opening the companion never starts or retimes anything.
    dp.focus.openCompanion().catch((error: unknown) => setPopOutError(FocusRequestError.from(error).message))
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // defaultPrevented: the Dashboard's g-chord already claimed this key.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (shouldIgnoreKey(e.target as HTMLElement)) return
      if (useFocusSurface.getState().celebration) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setExpanded(false)
        return
      }
      const current = useFocusCache.getState().snapshot
      const first = current?.queue[0]
      if (!first || useFocusCache.getState().pending) return
      if (e.key === 'Enter') {
        e.preventDefault()
        void data.onAction({ kind: 'complete', occurrence_id: first.occurrence_id }).catch(() => {})
      } else if (e.key === 's') {
        e.preventDefault()
        void data.onAction({ kind: 'stop' }).catch(() => {})
      }
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
    </div>
  )
}
