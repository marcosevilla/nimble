import { useEffect, useState } from 'react'
import { Minimize2 } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/shared/IconButton'
import { SectionTitle } from '@/components/shared/typography'
import { FocusQueueTray } from '@/components/focus/FocusQueueTray'
import { FocusLoadState } from '@/components/focus/FocusLoadState'
import { FocusImportDialog } from '@/components/focus/FocusImportDialog'
import { FocusDeliveryReview } from '@/components/focus/FocusDeliveryReview'
import { useFocusTrayData } from '@/hooks/useFocusTrayData'
import { focusViewKey } from '@/lib/keyGuard'
import type { PanelMenuExtra } from '@/lib/focusQueueIntents'
import { useDataProvider } from '@/services/provider-context'
import { FocusRequestError } from '@/services/focus-events'
import { refreshFocus, useFocusCache } from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'

/**
 * Expanded focus: the same tray as the rail and companion, centered in the
 * page area. Its header carries `+`, Minimize (Esc) and ⋯ (Import, Sends,
 * Pop out, queue, sounds). It renders engine snapshots and never starts
 * timing by itself.
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
  const [importOpen, setImportOpen] = useState(false)
  const [sendsOpen, setSendsOpen] = useState(false)
  const canPopOut = capabilities?.companion === true
  const popOut = () => {
    // A view only: opening the companion never starts or retimes anything.
    dp.focus.openCompanion().catch((error: unknown) => toast.error(FocusRequestError.from(error).message))
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
        <div className="w-full max-w-md">
          <FocusLoadState error={loadError} onRetry={() => void refreshFocus()} />
        </div>
      </div>
    )
  }

  const menuExtras: PanelMenuExtra[] = [
    ...(capabilities?.import
      ? [
          { id: 'import', label: 'Import from Focus Queue…', onSelect: () => setImportOpen(true) },
          { id: 'sends', label: 'Review sends…', onSelect: () => setSendsOpen(true) },
        ]
      : []),
    {
      id: 'pop_out',
      label: 'Pop out',
      onSelect: popOut,
      disabledReason: canPopOut ? null : capabilities?.reason ?? 'The focus window isn’t available yet.',
    },
  ]

  return (
    <div className="flex flex-1 justify-center px-4 py-6 animate-in fade-in duration-(--transition-base) motion-reduce:animate-none">
      <div className="w-full max-w-md">
        <FocusQueueTray
          snapshot={snapshot}
          capabilities={capabilities}
          tasks={data.tasks}
          projects={data.projects}
          allProjects={data.allProjects}
          sections={data.sections}
          completed={data.completed}
          today={data.today}
          onAction={data.onAction}
          taskOps={data.taskOps}
          soundMuted={data.soundMuted}
          onSoundMutedChange={data.setSoundMuted}
          title={<SectionTitle as="h2">Focus</SectionTitle>}
          headerActions={
            <IconButton size="lg" onClick={() => setExpanded(false)} title="Minimize (Esc)" aria-label="Minimize" aria-keyshortcuts="Escape" className="focus-ring">
              <Minimize2 className="size-3.5" aria-hidden />
            </IconButton>
          }
          menuExtras={menuExtras}
          timerSize="display"
        />
      </div>
      {importOpen && <FocusImportDialog open={importOpen} onOpenChange={setImportOpen} />}
      {sendsOpen && <FocusDeliveryReview open={sendsOpen} onOpenChange={setSendsOpen} />}
    </div>
  )
}
