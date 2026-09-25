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
      {/* 560 wide, pinned 16vh from the top rather than centred: the
          description auto-grows, and a centred card would creep upward
          under the caret on every new line. `sm:max-w-` because the
          primitive's own `sm:max-w-sm` (384) outranks an unprefixed width. */}
      <DialogContent
        showCloseButton={false}
        className="top-[16vh] w-full max-w-[calc(100%-2rem)] translate-y-0 gap-0 border-none bg-transparent p-0 shadow-none ring-0 sm:max-w-[560px]"
      >
        <DialogTitle className="sr-only">New task</DialogTitle>
        <DialogDescription className="sr-only">Create a new task</DialogDescription>
        {open && <TaskComposerCard defaults={defaults} onClose={close} />}
      </DialogContent>
    </Dialog>
  )
}
