import { useId, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/shared/IconButton'
import { Caption, Label, Meta } from '@/components/shared/typography'
import { cn } from '@/lib/utils'
import { addToQueueLabel, dueLabel, NIMBLE_ONLY, sourceLabel } from '@/lib/focusQueueIntents'
import type { FocusSource, LocalTask, Project } from '@nimble/types'

const LOCAL = 'local'
const TODAY = 'today'

const sourceKey = (source: FocusSource) => (source.kind === 'project' ? `project:${source.project_id}` : source.kind)

function sourceFromKey(key: string): FocusSource {
  if (key === TODAY) return { kind: 'today' }
  if (key === LOCAL) return { kind: 'local' }
  return { kind: 'project', project_id: key.slice('project:'.length) }
}

export interface FocusAddPanelProps {
  /** Where new tasks go and where "Add all" pulls from. Never reorders the queue. */
  source: FocusSource
  /** Active projects offered as sources. */
  projects: Project[]
  /** All projects (archived included) for naming the current source. */
  displayProjects?: Project[]
  onSourceChange: (source: FocusSource) => void
  /** Tasks in this source not already queued. */
  newCount: number
  /** All tasks this source offers (queued or not). */
  sourceCount: number
  onQueueThese: () => void
  /** Earlier open work (Today source only), added only on request. */
  stillOpen: LocalTask[]
  today: string
  /** Explicit still-open add; flagged as still-open in the queue entry. */
  onAddStillOpen: (taskIds: string[]) => void
  /** Why queue writes are unavailable: every add control stays visible, disabled, with this reason. */
  blockedReason: string | null
  /** Quick add (same semantics as before: one task per line, source captured at submit). */
  onQuickAdd: (text: string) => Promise<{ remaining: string; error: string | null }>
  /** The draft survives closing the popover; the owner keeps it. */
  draft: string
  onDraftChange: (text: string) => void
  inputRef?: RefObject<HTMLTextAreaElement | null>
  /** Still open starts collapsed each time the panel opens (tests may start it open). */
  initialStillOpenExpanded?: boolean
}

/**
 * Everything that adds to the queue, in one place: type a task (Enter adds,
 * Shift+Enter starts another line), pick where tasks come from and append
 * all of that source, or pick earlier still-open work.
 */
export function FocusAddPanel({
  source,
  projects,
  displayProjects,
  onSourceChange,
  newCount,
  sourceCount,
  onQueueThese,
  stillOpen,
  today,
  onAddStillOpen,
  blockedReason,
  onQuickAdd,
  draft,
  onDraftChange,
  inputRef,
  initialStillOpenExpanded = false,
}: FocusAddPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stillOpenExpanded, setStillOpenExpanded] = useState(initialStillOpenExpanded)
  const stillOpenId = useId()
  const label = sourceLabel(source, displayProjects ?? projects)
  const placeholder = source.kind === 'today' ? 'Add task to Today' : source.kind === 'local' ? 'Add a Nimble-only task' : `Add task to ${label}`
  const addLabel = addToQueueLabel(newCount, sourceCount)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await onQuickAdd(draft)
      onDraftChange(result.remaining)
      setError(result.error)
    } finally {
      setBusy(false)
      inputRef?.current?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {blockedReason && (
        <Caption as="p" role="note">
          {blockedReason}
        </Caption>
      )}
      <div>
        <Textarea
          ref={inputRef}
          rows={Math.min(4, Math.max(1, draft.split('\n').length))}
          aria-label={placeholder}
          aria-invalid={error ? true : undefined}
          aria-busy={busy || undefined}
          disabled={blockedReason != null}
          readOnly={busy}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          className={cn('min-h-0 resize-none px-2 py-1.5', busy && 'opacity-60')}
        />
        {error && (
          <Caption as="p" role="alert" className="mt-1 text-destructive">
            {error}
          </Caption>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Add tasks from: ${label}`}
            className="-ml-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-meta-strong text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground focus-ring"
          >
            <span className="truncate">{`From: ${label}`}</span>
            <ChevronDown className="size-3 shrink-0" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Add tasks from</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sourceKey(source)} onValueChange={(key) => onSourceChange(sourceFromKey(String(key)))}>
                <DropdownMenuRadioItem value={TODAY}>Today</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value={LOCAL}>
                  <span className="flex min-w-0 flex-col">
                    <span>{NIMBLE_ONLY}</span>
                    <Meta>Not synced to Todoist</Meta>
                  </span>
                </DropdownMenuRadioItem>
                {projects.length > 0 && <DropdownMenuSeparator />}
                {projects.map((project) => (
                  <DropdownMenuRadioItem key={project.id} value={`project:${project.id}`}>
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="xs"
          variant="ghost"
          disabled={blockedReason != null || newCount === 0}
          title={blockedReason ?? (newCount === 0 ? undefined : 'Adds to the end of the queue')}
          onClick={onQueueThese}
          className="shrink-0"
        >
          {addLabel}
        </Button>
      </div>

      {stillOpen.length > 0 && (
        <section aria-label="Still open" className="-mx-2.5 border-t border-border px-2.5 pt-2">
          <div className="flex min-h-6 items-center justify-between gap-2">
            {/* Collapsed on every open: earlier work is offered, never pushed. */}
            <button
              type="button"
              aria-expanded={stillOpenExpanded}
              aria-controls={stillOpenId}
              onClick={() => setStillOpenExpanded((v) => !v)}
              className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground focus-ring"
            >
              <Label tone={null} className="text-inherit">{`Still open · ${stillOpen.length}`}</Label>
              <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-(--transition-fast) motion-reduce:transition-none', stillOpenExpanded && 'rotate-90')} aria-hidden />
            </button>
            {stillOpenExpanded && (
              <Button
                size="xs"
                variant="ghost"
                disabled={blockedReason != null}
                title={blockedReason ?? undefined}
                onClick={() => onAddStillOpen(stillOpen.map((t) => t.id))}
              >
                Queue all
              </Button>
            )}
          </div>
          {stillOpenExpanded && (
            <ul id={stillOpenId} className="-mx-1 mt-1 max-h-40 overflow-y-auto">
              {stillOpen.map((task) => (
                <li key={task.id} className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-meta text-foreground">{task.content}</span>
                  <Meta className="shrink-0">{dueLabel(task, today)}</Meta>
                  <IconButton
                    aria-label={`Add ${task.content} to queue`}
                    disabled={blockedReason != null}
                    title={blockedReason ?? undefined}
                    onClick={() => onAddStillOpen([task.id])}
                    className="focus-ring disabled:opacity-50"
                  >
                    <Plus className="size-3" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * The surface header's `+`: opens the add panel with the text field focused
 * (when adding is allowed). The trigger stays enabled when the queue is
 * read-only so the reason is one click away; every control inside is disabled.
 */
export function FocusAddPopover(props: Omit<FocusAddPanelProps, 'draft' | 'onDraftChange' | 'inputRef'>) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<IconButton size="lg" aria-label="Add to queue" title="Add to queue" className="focus-ring data-popup-open:bg-hover data-popup-open:text-foreground" />}
      >
        <Plus className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" initialFocus={props.blockedReason == null ? inputRef : true}>
        <FocusAddPanel {...props} draft={draft} onDraftChange={setDraft} inputRef={inputRef} />
      </PopoverContent>
    </Popover>
  )
}
