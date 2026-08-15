import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'
import { useProjects } from '@/hooks/useLocalTasks'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { taskToast } from '@/lib/taskToast'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
import { MetadataChips, type ChipValues } from '@/components/tasks/MetadataChips'
import type { LocalTask, Section, Label } from '@nimble/types'

const EMPTY_DUE: ChipValues['due'] = { dueDate: null, dueTime: null, durationMinutes: null, recurrenceRule: null }

/** `defaults.parentId` seeds a subtask create (Task Details' "Add subtask"
 * mount); everything else maps 1:1 onto Task 7's `ChipValues`. */
export interface TaskComposerDefaults extends Partial<ChipValues> {
  parentId?: string
}

interface TaskComposerCardProps {
  defaults?: TaskComposerDefaults
  onClose: () => void
  onCreated?: (task: LocalTask) => void
}

function buildInitialChipValues(defaults?: TaskComposerDefaults): ChipValues {
  return {
    priority: defaults?.priority ?? 1,
    due: defaults?.due ?? EMPTY_DUE,
    labelIds: defaults?.labelIds ?? [],
    projectId: defaults?.projectId,
    sectionId: defaults?.sectionId ?? null,
    linkedDocId: defaults?.linkedDocId ?? null,
  }
}

function sameLabelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

function chipValuesEqual(a: ChipValues, b: ChipValues): boolean {
  return (
    a.priority === b.priority &&
    a.due.dueDate === b.due.dueDate &&
    a.due.dueTime === b.due.dueTime &&
    a.due.durationMinutes === b.due.durationMinutes &&
    a.due.recurrenceRule === b.due.recurrenceRule &&
    (a.projectId ?? null) === (b.projectId ?? null) &&
    (a.sectionId ?? null) === (b.sectionId ?? null) &&
    (a.linkedDocId ?? null) === (b.linkedDocId ?? null) &&
    sameLabelSet(a.labelIds, b.labelIds)
  )
}

/**
 * Unified create-task card — replaces both the old inline task editor and
 * `QuickCreateDialog`'s form body. Create-only: editing an existing task
 * happens on Task Details, never here.
 *
 * Modal-only (Marco QA round 3, item 3): mounted exclusively inside
 * `QuickCreateDialog`'s `Dialog`, closing on a successful save. Every
 * creation entry point (the "Q" shortcut, a list's "Add a task" row, a task
 * detail's "Add subtask", with `defaults.parentId`) opens that shared
 * dialog with its own defaults via `useQuickCreateStore` rather than
 * mounting this card inline — the inline mount points this component used
 * to support were removed by explicit design decision.
 */
export function TaskComposerCard({ defaults, onClose, onCreated }: TaskComposerCardProps) {
  const dp = useDataProvider()
  const { projects } = useProjects()

  // Captured once at mount — this card is remounted fresh per context
  // (toggled in/out, or a new Dialog instance), so `defaults` churning on
  // an unrelated parent re-render must not silently reset in-progress typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, see comment above
  const initialChipValues = useMemo(() => buildInitialChipValues(defaults), [])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [chipValues, setChipValues] = useState<ChipValues>(initialChipValues)
  const [sections, setSections] = useState<Section[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [saving, setSaving] = useState(false)

  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    dp.labels.list().then(setLabels).catch(() => setLabels([]))
  }, [dp])

  // Sections are scoped to whichever project is currently selected in the
  // chip row, not just the mount point's default — reload on every change.
  useEffect(() => {
    if (!chipValues.projectId) {
      setSections([])
      return
    }
    dp.sections.list(chipValues.projectId).then(setSections).catch(() => setSections([]))
  }, [dp, chipValues.projectId])

  const dirty =
    title.trim() !== '' || description.trim() !== '' || !chipValuesEqual(chipValues, initialChipValues)

  const canSave = title.trim() !== ''

  const handleSave = useCallback(async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const created = await dp.tasks.create({
        content: title.trim(),
        description: description.trim() || undefined,
        projectId: chipValues.projectId,
        sectionId: chipValues.sectionId ?? undefined,
        parentId: defaults?.parentId,
        priority: chipValues.priority,
        dueDate: chipValues.due.dueDate ?? undefined,
        dueTime: chipValues.due.dueTime ?? undefined,
        durationMinutes: chipValues.due.durationMinutes ?? undefined,
        recurrenceRule: chipValues.due.recurrenceRule ?? undefined,
        labelIds: chipValues.labelIds.length ? chipValues.labelIds : undefined,
      })
      emitTasksChanged()
      taskToast('Task created', created.id)
      onCreated?.(created)
      onClose()
    } catch (e) {
      toast.error(`Failed to create task: ${e}`)
    } finally {
      setSaving(false)
    }
  }, [canSave, saving, dp, title, description, chipValues, defaults?.parentId, onCreated, onClose])

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Modal mount (QuickCreateDialog): this card sits inside the Dialog
        // Popup, and Base UI's useDismiss/closeOnEscapeKeyDown doesn't check
        // defaultPrevented — only stopping propagation keeps the Dialog from
        // unconditionally closing itself (losing a dirty draft even when the
        // user clicks Cancel on the confirm below). Stop it on both branches:
        // the non-dirty branch already closes via our own onClose(), so
        // letting the Dialog *also* handle the same Escape would just be a
        // harmless double-close today, but stays correct if onClose ever
        // stops being synchronous-with-unmount.
        e.stopPropagation()
        if (dirty) {
          if (window.confirm('Discard this task?')) onClose()
        } else {
          onClose()
        }
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (canSave) handleSave()
      }
    },
    [dirty, onClose, canSave, handleSave],
  )

  // Plain Enter in the title just advances focus — it never submits or
  // inserts a newline (the title is a single-line input). ⌘/Ctrl+Enter and
  // Shift+Enter fall through to the card-level handler / native behavior.
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault()
      descriptionRef.current?.focus()
    }
  }, [])

  return (
    <div
      onKeyDown={handleCardKeyDown}
      className="rounded-xl border border-input bg-card px-5 py-4 shadow-[0px_2px_8px_0px_rgba(0,0,0,0.06)] flex flex-col gap-8"
    >
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-body-strong">New task</span>
          <IconButton size="md" onClick={onClose} aria-label="Close">
            <X className="size-[17px]" />
          </IconButton>
        </div>

        {/* Title */}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          placeholder="Task title"
          autoFocus
          className={cn(
            'h-auto border-none bg-transparent px-0 py-0 shadow-none outline-none',
            'text-display placeholder:text-foreground/25',
            'focus-visible:ring-0 focus-visible:border-none',
          )}
        />

        {/* Description — raw markdown, auto-grows via field-sizing-content */}
        <Textarea
          ref={descriptionRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={1}
          className={cn(
            'min-h-0 resize-none border-none bg-transparent px-0 py-0 shadow-none outline-none',
            'text-body placeholder:text-foreground/25',
            'focus-visible:ring-0 focus-visible:border-none',
          )}
        />

        {/* Metadata chips */}
        <MetadataChips
          values={chipValues}
          onChange={(patch) => setChipValues((v) => ({ ...v, ...patch }))}
          context="composer"
          projects={projects}
          sections={sections}
          labels={labels}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" className="h-8 rounded-lg px-3.5 text-body" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="h-8 rounded-lg px-4 bg-primary text-body text-primary-foreground disabled:opacity-50"
          disabled={!canSave || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
