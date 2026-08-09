import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { labelColor, LABEL_COLOR_OPTIONS, DEFAULT_LABEL_COLOR } from '@/lib/labelColors'
import { listLabels, createLabel, updateLabel, deleteLabel } from '@/services/tauri'
import type { Label } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { IconButton } from '@/components/shared/IconButton'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export function LabelManager() {
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>(DEFAULT_LABEL_COLOR)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listLabels()
      .then(setLabels)
      .catch((e) => toast.error(`Failed to load labels: ${e}`))
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      const label = await createLabel(trimmed, newColor)
      setLabels((prev) => [...prev, label])
      toast.success(`Label created: "${trimmed}"`)
      setNewName('')
      setNewColor(DEFAULT_LABEL_COLOR)
      setShowForm(false)
    } catch (e) {
      toast.error(`Failed to create label: ${e}`)
    } finally {
      setSaving(false)
    }
  }, [newName, newColor, saving])

  const handleRename = useCallback(async (id: string, name: string) => {
    try {
      const updated = await updateLabel(id, { name })
      setLabels((prev) => prev.map((l) => (l.id === id ? updated : l)))
    } catch (e) {
      toast.error(`Failed to rename label: ${e}`)
    }
  }, [])

  const handleColorChange = useCallback(async (id: string, color: string) => {
    try {
      const updated = await updateLabel(id, { color })
      setLabels((prev) => prev.map((l) => (l.id === id ? updated : l)))
    } catch (e) {
      toast.error(`Failed to update label color: ${e}`)
    }
  }, [])

  const handleDelete = useCallback(async (label: Label) => {
    try {
      await deleteLabel(label.id)
      setLabels((prev) => prev.filter((l) => l.id !== label.id))
      toast.success(`Label deleted: "${label.name}"`)
    } catch (e) {
      toast.error(`Failed to delete label: ${e}`)
    }
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Label list */}
      <div className="space-y-0.5">
        {labels.map((label) => (
          <LabelRow
            key={label.id}
            label={label}
            onRename={handleRename}
            onColorChange={handleColorChange}
            onDelete={() => handleDelete(label)}
          />
        ))}
        {labels.length === 0 && (
          <p className="text-body text-muted-foreground">No labels yet.</p>
        )}
      </div>

      {/* Add form */}
      {showForm ? (
        <div className="space-y-3 rounded-md border p-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            placeholder="Label name"
            autoFocus
          />
          <div className="flex items-center gap-2">
            {LABEL_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'size-6 rounded-full border-2 transition-all',
                  newColor === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                )}
                style={{ backgroundColor: labelColor(c) }}
                onClick={() => setNewColor(c)}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || saving}>
              {saving ? 'Adding...' : 'Add label'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowForm(false); setNewName(''); setNewColor(DEFAULT_LABEL_COLOR) }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          + Add label
        </Button>
      )}
    </div>
  )
}

function LabelRow({
  label,
  onRename,
  onColorChange,
  onDelete,
}: {
  label: Label
  onRename: (id: string, name: string) => void
  onColorChange: (id: string, color: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(label.name)

  useEffect(() => { setDraft(label.name) }, [label.name])

  const save = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label.name) onRename(label.id, trimmed)
    else setDraft(label.name)
  }

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/10 transition-colors">
      <Popover>
        <PopoverTrigger
          className="flex size-5 shrink-0 items-center justify-center rounded-full hover:ring-2 hover:ring-border/60 transition-all"
          aria-label={`Change color for ${label.name}`}
        >
          <span className="size-2.5 rounded-full" style={{ backgroundColor: labelColor(label.color) }} />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-auto p-2">
          <div className="flex items-center gap-1.5">
            {LABEL_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'size-5 rounded-full border-2 transition-all',
                  label.color === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                )}
                style={{ backgroundColor: labelColor(c) }}
                onClick={() => onColorChange(label.id, c)}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setDraft(label.name); (e.target as HTMLInputElement).blur() }
        }}
        className="flex-1 min-w-0 bg-transparent text-body outline-none"
      />

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <IconButton
              tone="destructive"
              className="opacity-0 group-hover:opacity-100"
              aria-label={`Delete label ${label.name}`}
            >
              <Trash2 className="size-3" />
            </IconButton>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{label.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the label from any tasks that use it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
