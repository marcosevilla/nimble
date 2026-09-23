import { useState } from 'react'
import { useLocalTasks } from '@/hooks/useLocalTasks'
import { recoveryNotice, type RecoveryNotice } from '@/lib/focusFlows'
import { useFocusCache } from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** Notices already dismissed in this window (keyed by the recovery itself). */
const dismissed = new Set<string>()

/** The notice body: the paused task and its durable total. It offers no Start or Resume. */
export function FocusRecoveryBody({ notice, onOpen, onDismiss }: { notice: RecoveryNotice; onOpen: () => void; onDismiss: () => void }) {
  return (
    <>
      <p className="text-body-strong">{notice.title}</p>
      <p className="text-meta text-muted-foreground">
        {`${notice.total} saved · ${notice.reason}`}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button size="sm" onClick={onOpen}>
          Show focus
        </Button>
      </div>
    </>
  )
}

/**
 * Recovery after an interruption (sleep, crash, relaunch — from any date):
 * the engine already paused the selected task at its last durable
 * checkpoint. This only shows that paused total; continuing is the card's
 * explicit Resume. Nothing starts from recovery.
 */
export function FocusResumeDialog() {
  const snapshot = useFocusCache((s) => s.snapshot)
  const setExpanded = useFocusSurface((s) => s.setExpanded)
  const { tasks } = useLocalTasks()
  const [, rerender] = useState(0)
  const notice = recoveryNotice(snapshot, tasks)
  const key = notice && snapshot ? `${snapshot.owner_epoch}:${snapshot.process_generation}:${snapshot.checkpoint_at}:${notice.reason}` : null
  const open = key != null && !dismissed.has(key)

  const dismiss = () => {
    if (key) dismissed.add(key)
    rerender((n) => n + 1)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismiss()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Focus was paused</DialogTitle>
          <DialogDescription>Your time is saved. Pick it back up whenever you like.</DialogDescription>
        </DialogHeader>
        {notice && (
          <FocusRecoveryBody
            notice={notice}
            onDismiss={dismiss}
            onOpen={() => {
              dismiss()
              setExpanded(true)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
