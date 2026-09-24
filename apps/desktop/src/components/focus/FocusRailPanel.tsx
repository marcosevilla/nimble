import { Maximize2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
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
 * flush with the column (no box). Its header carries `+`, Expand (the full
 * focus view, with import and sends) and ⋯ (Pop out, queue, sounds).
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
  const canPopOut = capabilities?.companion === true
  const popOut = () => {
    dp.focus.openCompanion().catch((error: unknown) => toast.error(FocusRequestError.from(error).message))
  }

  // One tray per window: while the full view is open it owns the queue.
  if (expanded) {
    return (
      <div className="space-y-3">
        <SectionTitle as="h2">Focus</SectionTitle>
        <Caption as="p">The focus queue is open in the main view.</Caption>
        <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
          Show it here
        </Button>
      </div>
    )
  }

  // Bleed to the column edges so the tray's own gutters line up with the
  // other tabs' content, and row hovers run edge to edge.
  return (
    <div className="-mx-4 -mt-1.5">
      {snapshot ? (
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
            <IconButton
              size="lg"
              onClick={() => setExpanded(true)}
              title="Open the full focus view (import, sends)"
              aria-label="Expand"
              className="focus-ring"
            >
              <Maximize2 className="size-3.5" aria-hidden />
            </IconButton>
          }
          menuExtras={[
            {
              id: 'pop_out',
              label: 'Pop out',
              onSelect: popOut,
              disabledReason: canPopOut ? null : capabilities?.reason ?? 'The focus window isn’t available yet.',
            },
          ]}
        />
      ) : (
        <div className="px-4">
          <FocusLoadState error={loadError} onRetry={() => void refreshFocus()} />
        </div>
      )}
    </div>
  )
}
