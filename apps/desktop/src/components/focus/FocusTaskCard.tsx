import { useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { Check, MoreHorizontal, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { Caption, Label, Meta } from '@/components/shared/typography'
import { FocusTimeboxPicker } from '@/components/focus/FocusTimeboxPicker'
import { cn } from '@/lib/utils'
import {
  cardCaption,
  cardTiming,
  controlBlockedReason,
  descriptionOverflows,
  queueBlockedReason,
  taskMenuItems,
  timerControl,
  type TaskMenuId,
} from '@/lib/focusQueueIntents'
import type { FocusAction, FocusCapabilities, FocusEntry, FocusSnapshot, LocalTask } from '@nimble/types'
import { useFocusDisplayExtra } from '@/hooks/useFocusDisplayExtra'

// ── Shared pieces (also used by the Up next rows) ──

/** Completion circle — its own control, never the row's promote target. */
export function CompletionButton({
  title,
  size = 'md',
  disabled,
  reason,
  tabIndex,
  onComplete,
}: {
  title: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  /** Roving lists pass -1 for rows that are not the current Tab stop. */
  tabIndex?: number
  reason?: string | null
  onComplete: () => void
}) {
  const box = size === 'lg' ? 'size-5' : size === 'md' ? 'size-4' : 'size-3.5'
  return (
    <button
      type="button"
      aria-label={`Complete ${title}`}
      tabIndex={tabIndex}
      title={reason ?? undefined}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onComplete()
      }}
      className={cn(
        'group/complete relative flex shrink-0 items-center justify-center rounded-full border border-muted-foreground/60 text-transparent transition-colors duration-(--transition-fast) focus-ring hover:border-success hover:text-success disabled:pointer-events-none disabled:opacity-50 after:absolute after:-inset-2',
        box,
      )}
    >
      <Check className="size-2.5" strokeWidth={3} aria-hidden />
    </button>
  )
}

/**
 * Quiet task actions: the ⋯ shows on keyboard focus and while its menu is
 * open; pair it with the parent's `group-hover:opacity-100` variant.
 */
export const TASK_MENU_REVEAL =
  'opacity-0 transition-opacity duration-(--transition-fast) focus-within:opacity-100 has-[[data-popup-open]]:opacity-100 motion-reduce:transition-none'

/** One "More actions" menu for the card and each row. Clicks never reach the row. */
export function FocusTaskMenu({
  task,
  place,
  onSelect,
  className,
  tabIndex,
}: {
  task: LocalTask
  place: 'card' | 'row'
  onSelect: (id: TaskMenuId) => void
  className?: string
  /** Roving lists pass -1 for rows that are not the current Tab stop. */
  tabIndex?: number
}) {
  const items = taskMenuItems(task, place)
  return (
    // Stop propagation at a React ancestor: portal events still bubble to the row.
    <div className={cn('shrink-0', className)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${task.content}`}
          tabIndex={tabIndex}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--transition-fast) hover:bg-hover hover:text-foreground focus-ring"
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {items.map((item) => (
            <div key={item.id}>
              {item.destructive && <DropdownMenuSeparator />}
              <DropdownMenuItem variant={item.destructive ? 'destructive' : 'default'} onClick={() => onSelect(item.id)}>
                {item.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Inline local rename. Enter commits (empty is rejected and keeps editing),
 * Escape cancels. A failed save keeps the typed text.
 */
export function InlineRename({
  task,
  className,
  onCommit,
  onCancel,
}: {
  task: LocalTask
  className?: string
  onCommit: (content: string) => Promise<boolean>
  onCancel: () => void
}) {
  const [value, setValue] = useState(task.content)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const commit = async () => {
    if (!value.trim()) {
      setError('A task name cannot be empty.')
      return
    }
    if (value.trim() === task.content) return onCancel()
    if (!(await onCommit(value))) ref.current?.focus()
  }
  return (
    <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        aria-label={`Rename ${task.content}`}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className={cn('w-full min-w-0 rounded-sm bg-transparent outline-none focus-ring', className)}
      />
      {error && <Caption className="text-destructive">{error}</Caption>}
    </div>
  )
}

/**
 * The task description under the card title, as plain text (React escapes
 * it; markdown stays literal). Clamped to one line; "See more" appears only
 * when the clamped text actually overflows and expands it in place. The
 * expansion is this card view's state only (the parent keys it by task).
 */
export function FocusTaskDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const measure = () => setOverflows(descriptionOverflows(el))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])
  return (
    <div className="mt-0.5 min-w-0">
      <p
        ref={ref}
        id={id}
        data-slot="focus-description"
        className={cn('text-meta break-words text-muted-foreground', expanded ? 'whitespace-pre-wrap' : 'line-clamp-1')}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
          className="rounded-sm text-meta text-muted-foreground underline-offset-2 transition-colors duration-(--transition-fast) hover:text-foreground hover:underline focus-ring"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  )
}

// ── The focused-task card ──

export interface FocusTaskCardProps {
  snapshot: FocusSnapshot
  capabilities: FocusCapabilities | null
  /** First queue entry and its resolved task; null renders the empty card. */
  entry: FocusEntry | null
  task: LocalTask | null
  /** Open children, completable inline. */
  subtasks: LocalTask[]
  /** Where the task lives ("Project" or "Project / Section"), shown above the title. */
  placeLabel?: string | null
  today: string
  onAction: (action: FocusAction) => Promise<unknown>
  onCompleteSubtask: (task: LocalTask) => void
  onMenu: (id: TaskMenuId, task: LocalTask, entry: FocusEntry) => void
  renaming?: boolean
  onRename?: (task: LocalTask, content: string) => Promise<boolean>
  onRenameCancel?: () => void
  headingRef?: Ref<HTMLHeadingElement>
  /** A focus action is awaiting its commit: gate the controls that would repeat it. */
  busy?: boolean
}

/**
 * The focused task, quiet around a hero title: a small muted place label,
 * completion + title (full width — task actions live in one ⋯ revealed on
 * hover/focus at the top-right), inline subtasks, then the timer with one
 * caption line (budget · priority · due) and the circular Start/Pause.
 * Surface controls (add, queue toggle, sounds) live in the surface header.
 * Rendering it never starts timing.
 */
export function FocusTaskCard({
  snapshot,
  capabilities,
  entry,
  task,
  subtasks,
  placeLabel,
  today,
  onAction,
  onCompleteSubtask,
  onMenu,
  renaming,
  onRename,
  onRenameCancel,
  headingRef,
  busy = false,
}: FocusTaskCardProps) {
  const reasonId = useId()
  const displayExtra = useFocusDisplayExtra(snapshot, entry, capabilities?.live_timing === true)
  const writeBlocked = queueBlockedReason(capabilities)

  if (entry && !task) {
    // The queued task left native storage (deleted/moved elsewhere). Keep an
    // escape: remove or skip the orphan entry; its recorded time is kept.
    return (
      <section aria-label="Focused task" className="px-4 pt-1 pb-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-title text-muted-foreground outline-none">
          Task no longer available
        </h2>
        <Meta as="p" className="mt-1">It may have been deleted elsewhere. Its recorded time is kept.</Meta>
        <div className="mt-3 flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={writeBlocked != null}
            title={writeBlocked ?? undefined}
            onClick={() => void onAction({ kind: 'remove', occurrence_id: entry.occurrence_id })}
          >
            Remove from queue
          </Button>
          <Button size="sm" variant="ghost" disabled={writeBlocked != null} title={writeBlocked ?? undefined} onClick={() => void onAction({ kind: 'skip' })}>
            Skip
          </Button>
        </div>
      </section>
    )
  }

  if (!entry || !task) {
    return (
      <section aria-label="Focused task" className="flex min-h-28 flex-col items-center justify-center gap-1 px-8 pt-2 pb-6 text-center">
        <p className="text-body-strong text-foreground">Queue is clear</p>
        <Meta>Use + to add what’s next.</Meta>
      </section>
    )
  }

  const control = timerControl(snapshot, entry)
  const blocked = controlBlockedReason(control, capabilities)
  const timing = cardTiming(snapshot, entry, displayExtra)
  const running = control.label === 'Pause' || control.label === 'End break'
  const caption = cardCaption(timing.caption, task, today)
  const showBars = task.priority >= 2
  const description = task.description?.trim() ?? ''

  return (
    <section aria-label="Focused task" className="group/card relative px-4 pt-1 pb-4">
      {placeLabel && (
        <Label as="p" data-slot="focus-place" className="block truncate pr-8">
          {placeLabel}
        </Label>
      )}
      <div className={cn('flex items-start gap-2.5', placeLabel && 'mt-1')}>
        <div className="flex h-[calc(var(--text-title--line-height)*1em)] items-center text-title">
          <CompletionButton
            title={task.content}
            size="lg"
            disabled={writeBlocked != null || busy}
            reason={writeBlocked}
            onComplete={() => void onAction({ kind: 'complete', occurrence_id: entry.occurrence_id })}
          />
        </div>
        <div className="min-w-0 flex-1">
          {renaming && onRename && onRenameCancel ? (
            <InlineRename task={task} className="text-title" onCommit={(c) => onRename(task, c)} onCancel={onRenameCancel} />
          ) : (
            <h2 ref={headingRef} tabIndex={-1} className="text-title break-words text-foreground outline-none">
              {/* Without a place label the ⋯ sits on the title's first line: keep that corner clear. */}
              {!placeLabel && <span aria-hidden className="float-right h-5 w-6" />}
              {task.content}
            </h2>
          )}
          {description && <FocusTaskDescription key={task.id} text={description} />}
        </div>
      </div>
      {/* Task actions sit top-right, out of the title's way until hover or
          keyboard focus; in the DOM they follow the title, so Tab order
          reads completion → title → actions. An explicit tabIndex keeps the
          trigger a Tab stop in WKWebView, which skips plain buttons unless
          macOS keyboard navigation is on (it now holds Copy context). */}
      <FocusTaskMenu
        task={task}
        place="card"
        tabIndex={0}
        onSelect={(id) => onMenu(id, task, entry)}
        className={cn('absolute top-0.5 right-3 group-hover/card:opacity-100', TASK_MENU_REVEAL)}
      />

      {subtasks.length > 0 && (
        <ul aria-label="Subtasks" className="mt-2.5 ml-7.5 flex flex-col gap-1.5">
          {subtasks.map((sub) => (
            <li key={sub.id} className="flex min-w-0 items-center gap-2">
              <CompletionButton title={sub.content} size="sm" onComplete={() => onCompleteSubtask(sub)} />
              <span className="min-w-0 truncate text-body text-foreground">{sub.content}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-end justify-between gap-3">
        <FocusTimeboxPicker
          config={timing.config}
          presentation={timing.presentation}
          caption={
            caption.timing || caption.meta || showBars ? (
              <>
                {caption.timing && <span className="shrink-0">{caption.timing}</span>}
                {caption.timing && (showBars || caption.meta) && <span aria-hidden>·</span>}
                {showBars && <PriorityBars priority={task.priority} />}
                {caption.meta && <span className="min-w-0 truncate">{caption.meta}</span>}
              </>
            ) : null
          }
          disabledReason={writeBlocked}
          onConfigure={(config) => void onAction({ kind: 'configure', occurrence_id: entry.occurrence_id, config })}
        />
        <Button
          aria-label={control.label}
          aria-describedby={blocked ? reasonId : undefined}
          aria-busy={busy || undefined}
          disabled={blocked != null || busy}
          variant={running ? 'secondary' : 'default'}
          onClick={() => void onAction(control.action)}
          className="mb-0.5 size-10 shrink-0 rounded-full p-0"
        >
          {running ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </Button>
      </div>
      {blocked && (
        <Caption as="p" id={reasonId} className="mt-1.5 text-right">
          {blocked}
        </Caption>
      )}
    </section>
  )
}
