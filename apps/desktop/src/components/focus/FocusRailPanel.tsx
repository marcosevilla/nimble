import { useState } from 'react'
import { Maximize2, PictureInPicture2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Caption, SectionTitle } from '@/components/shared/typography'
import { FocusQueueTray } from '@/components/focus/FocusQueueTray'
import { FocusLoadState } from '@/components/focus/FocusLoadState'
import { useFocusTrayData } from '@/hooks/useFocusTrayData'
import { useDataProvider } from '@/services/provider-context'
import { FocusRequestError } from '@/services/focus-events'
import { refreshFocus, useFocusCache } from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'

/**
 * The right column's Focus tab: the same tray as the pop-out companion,
 * plus Expand (the full focus view, with import and sends) and Pop out.
 * Renders engine snapshots only; opening it never starts timing.
 */
export function FocusRailPanel() {
  const snapshot = useFocusCache((s) => s.snapshot)
  const capabilities = useFocusCache((s) => s.capabilities)
  const loadError = useFocusCache((s) => s.error)
  const expanded = useFocusSurface((s) => s.expanded)
  const setExpanded = useFocusSurface((s) => s.setExpanded)
  const data = useFocusTrayData()
  const dp = useDataProvider()
  const [popOutError, setPopOutError] = useState<string | null>(null)
  const canPopOut = capabilities?.companion === true
  const popOut = () => {
    setPopOutError(null)
    dp.focus.openCompanion().catch((error: unknown) => setPopOutError(FocusRequestError.from(error).message))
  }

  const header = (
    <div className="flex items-center justify-between gap-1">
      <SectionTitle as="h2">Focus queue</SectionTitle>
      {!expanded && (
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={popOut}
            disabled={!canPopOut}
            title={canPopOut ? 'Open the always-on-top focus window' : capabilities?.reason ?? undefined}
            aria-label="Pop out"
            className="px-1.5 text-muted-foreground"
          >
            <PictureInPicture2 className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(true)}
            title="Open the full focus view (import, sends)"
            aria-label="Expand"
            className="px-1.5 text-muted-foreground"
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )

  // One tray per window: while the full view is open it owns the queue.
  if (expanded) {
    return (
      <div className="space-y-3">
        {header}
        <Caption as="p">The focus queue is open in the main view.</Caption>
        <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
          Show it here
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {header}
      {popOutError && (
        <Caption as="p" role="alert" className="text-destructive">
          {popOutError}
        </Caption>
      )}
      <div className="overflow-hidden rounded-lg border border-border">
        {snapshot ? (
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
        ) : (
          <FocusLoadState error={loadError} onRetry={() => void refreshFocus()} />
        )}
      </div>
    </div>
  )
}
