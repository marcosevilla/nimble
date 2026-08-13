import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { TaskComposerCard } from '@/components/tasks/TaskComposerCard'
import { useQuickCreateStore } from '@/stores/quickCreateStore'

/** Thin `Dialog` shell around `TaskComposerCard` — the card owns all of its
 * own chrome (border/shadow/padding), so the dialog popup itself is
 * stripped down to just positioning + backdrop. Mounted once in
 * Dashboard.tsx; every task-creation entry point in the app (the "Q"
 * shortcut, a list's "Add a task" row, a task detail's "Add subtask") opens
 * THIS dialog via `useQuickCreateStore.openCreate(defaults)` rather than
 * mounting an inline composer of its own (Marco QA round 3, item 3 —
 * modal-only task creation). */
export function QuickCreateDialog() {
  const open = useQuickCreateStore((s) => s.open)
  const defaults = useQuickCreateStore((s) => s.defaults)
  const close = useQuickCreateStore((s) => s.close)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[480px] w-full gap-0 border-none bg-transparent p-0 shadow-none ring-0"
      >
        <DialogTitle className="sr-only">New task</DialogTitle>
        <DialogDescription className="sr-only">Create a new task</DialogDescription>
        {open && <TaskComposerCard defaults={defaults} onClose={close} />}
      </DialogContent>
    </Dialog>
  )
}
