import { useDataVersion } from '@/hooks/useDataVersion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'
import { useProjects } from '@/hooks/useLocalTasks'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { taskToast } from '@/lib/taskToast'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
import { MetadataChips, type ChipValues } from '@/components/tasks/MetadataChips'
import { useQuickCreateStore } from '@/stores/quickCreateStore'
import type { LocalTask, Section, Label } from '@nimble/types'

const EMPTY_DUE: ChipValues['due'] = { dueDate: null, dueTime: null, durationMinutes: null, recurrenceRule: null }

const FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')

/** Grow a textarea to its content where `field-sizing: content` is missing
 * (older WebKit). A no-op where the CSS does the job. */
function autoGrow(el: HTMLTextAreaElement | null, maxPx = Infinity) {
  if (!el || FIELD_SIZING) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
}

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
  const referenceVersion = useDataVersion('labels')
  const sectionVersion = useDataVersion('sections')
  const dp = useDataProvider()
  const { projects } = useProjects()

  // Captured once at mount — this card is remounted fresh per context
  // (toggled in/out, or a new Dialog instance), so `defaults` churning on
  // an unrelated parent re-render must not silently reset in-progress typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, see comment above
  const initialChipValues = useMemo(() => buildInitialChipValues(defaults), [])

  // A draft left behind by a dirty close comes back on the next open —
  // nothing typed is ever lost, so no confirm is needed (P1-6).
  const [title, setTitle] = useState(() => useQuickCreateStore.getState().draft?.title ?? '')
  const [description, setDescription] = useState(() => useQuickCreateStore.getState().draft?.description ?? '')
  const [chipValues, setChipValues] = useState<ChipValues>(initialChipValues)
  const [sections, setSections] = useState<Section[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [saving, setSaving] = useState(false)

  const titleRef = useRef<HTMLTextAreaElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    dp.labels.list().then(setLabels).catch(() => setLabels([]))
  }, [dp, referenceVersion])

  // Sections are scoped to whichever project is currently selected in the
  // chip row, not just the mount point's default — reload on every change.
  useEffect(() => {
    if (!chipValues.projectId) {
      setSections([])
      return
    }
    dp.sections.list(chipValues.projectId).then(setSections).catch(() => setSections([]))
  }, [dp, chipValues.projectId, sectionVersion])

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
      useQuickCreateStore.getState().setDraft(null)
      taskToast('Task created', created.id)
      onCreated?.(created)
      onClose()
    } catch (e) {
      toast.error(`Failed to create task: ${e}`)
    } finally {
      setSaving(false)
    }
  }, [canSave, saving, dp, title, description, chipValues, defaults?.parentId, onCreated, onClose])

  // Every close path (Escape, Cancel, ✕, backdrop via Dialog) stashes what
  // was typed instead of interrupting with a confirm (tasks audit P1-6,
  // §3.2). An empty draft clears the stash.
  const handleClose = useCallback(() => {
    const text = { title: title.trim(), description: description.trim() }
    useQuickCreateStore.getState().setDraft(text.title || text.description ? { title, description } : null)
    onClose()
  }, [title, description, onClose])

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Modal mount (QuickCreateDialog): this card sits inside the Dialog
        // Popup, and Base UI's useDismiss/closeOnEscapeKeyDown doesn't check
        // defaultPrevented — stop propagation so the Dialog doesn't also
        // close itself past our draft stash.
        e.stopPropagation()
        handleClose()
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (canSave) handleSave()
      }
    },
    [handleClose, canSave, handleSave],
  )

  // Plain Enter in the title just advances focus — it never submits or
  // inserts a newline (the title wraps visually but stays one line of
  // text). ⌘/Ctrl+Enter falls through to the card-level handler.
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // WKWebView sends the IME-committing Enter with isComposing=false but
    // keyCode 229: leave both alone so composing never jumps fields.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      descriptionRef.current?.focus()
    }
  }, [])

  // Engines without `field-sizing: content` get the same auto-grow by hand.
  useLayoutEffect(() => autoGrow(titleRef.current), [title])
  useLayoutEffect(() => autoGrow(descriptionRef.current, window.innerHeight * 0.4), [description])

  return (
    <div
      data-composer-card
      onKeyDown={handleCardKeyDown}
      className="surface-popover flex flex-col"
    >
      <div className="flex flex-col px-6 pt-4 pb-6">
        {/* Header — quiet chrome; the title field below is the hero. */}
        <div className="flex items-center justify-between">
          <span className="text-meta-strong text-muted-foreground">New task</span>
          <IconButton size="md" onClick={handleClose} aria-label="Close" className="-mr-1">
            <X className="size-4" />
          </IconButton>
        </div>

        {/* Title — a one-row textarea so long titles wrap instead of
            scrolling sideways; newlines are stripped (Enter moves on). */}
        <Textarea
          ref={titleRef}
          variant="ghost"
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\r?\n/g, ' '))}
          onKeyDown={handleTitleKeyDown}
          placeholder="Task title"
          aria-label="Task title"
          autoFocus
          className="mt-4 text-display leading-[1.3]"
        />

        {/* Description — raw markdown, auto-grows from three lines */}
        <Textarea
          ref={descriptionRef}
          variant="ghost"
          rows={1}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          aria-label="Description"
          // Capped at 40vh and scrolls inside: the card is pinned near the
          // top, so an unbounded paste would push Save off screen.
          className="mt-2 min-h-16 max-h-[40vh] overflow-y-auto text-body"
        />

        {/* Metadata chips */}
        <div data-composer-chips className="mt-6">
          <MetadataChips
            values={chipValues}
            onChange={(patch) => setChipValues((v) => ({ ...v, ...patch }))}
            context="composer"
            projects={projects}
            sections={sections}
            labels={labels}
          />
        </div>
      </div>

      {/* Footer — its own strip, so the actions never crowd the chips. */}
      <div data-composer-footer className="flex items-center justify-between gap-4 border-t border-border/60 px-6 py-4">
        <span className="text-meta text-muted-foreground">
          <kbd className="rounded-sm bg-muted px-1 py-0.5 font-sans text-label">⌘↵</kbd> to save
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="h-8 rounded-lg px-3 text-body" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            className="h-8 rounded-lg px-4"
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
