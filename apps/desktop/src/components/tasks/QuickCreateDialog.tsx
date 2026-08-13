import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { TaskComposerCard } from '@/components/tasks/TaskComposerCard'

interface QuickCreateDialogProps {
  open: boolean
  onClose: () => void
}

/** Thin `Dialog` shell around Task 8's `TaskComposerCard` — the card owns
 * all of its own chrome (border/shadow/padding), so the dialog popup itself
 * is stripped down to just positioning + backdrop. `closeOnSave` closes the
 * modal after a successful create, unlike the inline mount points which
 * stay open for rapid entry. */
export function QuickCreateDialog({ open, onClose }: QuickCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[480px] w-full gap-0 border-none bg-transparent p-0 shadow-none ring-0"
      >
        <DialogTitle className="sr-only">New task</DialogTitle>
        <DialogDescription className="sr-only">Create a new task</DialogDescription>
        {open && (
          <TaskComposerCard defaults={{ projectId: 'inbox' }} onClose={onClose} closeOnSave />
        )}
      </DialogContent>
    </Dialog>
  )
}
