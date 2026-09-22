import { Trash2 } from 'lucide-react'
import type { DocNote } from '@nimble/types'

interface DocNoteEntryProps {
  note: DocNote
  onDelete: (id: string) => void
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

export function DocNoteEntry({ note, onDelete }: DocNoteEntryProps) {
  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover transition-colors duration-(--transition-fast)">
      <div className="flex-1 min-w-0">
        <p className="text-body">{note.content}</p>
        <p className="text-label text-muted-foreground mt-0.5">{formatTime(note.created_at)}</p>
      </div>
      <button
        type="button"
        onClick={() => onDelete(note.id)}
        aria-label="Delete note"
        className="relative flex size-6 shrink-0 items-center justify-center rounded-md text-destructive/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-destructive hover:bg-hover transition-[opacity,color,background-color] duration-(--transition-fast) before:absolute before:-inset-1"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}
