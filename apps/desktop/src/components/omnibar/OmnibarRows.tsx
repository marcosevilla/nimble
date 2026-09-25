import { Fragment } from 'react'
import { Check, Circle, FolderInput, Sparkles, X } from 'lucide-react'
import type { LocalTask, Project, TaskSearchHit } from '@nimble/types'
import { cn } from '@/lib/utils'
import { PRIORITY_COLORS } from '@/lib/priorities'
import { formatDoneDate, markTitle, splitMarked, type Segment } from '@/lib/taskSearch'
import { Icon } from '@/components/shared/Icon'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { FocusPlayMenu } from '@/components/focus/FocusPlayMenu'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

// 24px icon actions in the selected row. Hit target is 24×36 via `after:` —
// exactly the row's height, so it never reaches into the rows above/below.
const ACTION_BUTTON_CLASS =
  'relative flex size-6 items-center justify-center rounded-md transition-colors duration-(--transition-fast) hover:bg-hover after:absolute after:inset-x-0 after:-inset-y-1.5'

export function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.mark
          ? <mark key={i} className="rounded-[3px] bg-primary/15 px-px text-foreground">{s.text}</mark>
          : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </>
  )
}

function ActionButton({ icon: Glyph, hint, title, onClick, className }: {
  icon: typeof Check
  hint: string
  title: string
  onClick: () => void
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={(e) => { e.stopPropagation(); onClick() }}
        aria-label={title}
        className={cn(ACTION_BUTTON_CLASS, className)}
      >
        <Icon icon={Glyph} />
      </TooltipTrigger>
      <TooltipContent side="top" className="text-meta">
        {title} <kbd className="ml-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-label">{hint}</kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** One task result: open first, completed dimmed with its done date; the
 *  highlighted open row shows ⌥C / focus / ⌥B / ⌥M actions. The option
 *  element holds only the title — the action buttons are its siblings, since
 *  an option may not contain interactive content (axe nested-interactive). */
export function TaskRow({ hit, rowKey, optionId, selected, tokens, projects, onHover, onOpen, onComplete, onBreakDown, onMove }: {
  hit: TaskSearchHit
  rowKey: string
  /** Index-based DOM id (aria-activedescendant target). */
  optionId: string
  selected: boolean
  tokens: readonly string[]
  projects: readonly Project[]
  onHover: () => void
  onOpen: () => void
  onComplete: () => void
  onBreakDown: () => void
  onMove: (projectId: string) => void
}) {
  const task = hit.task
  const done = task.status === 'complete'
  const project = projects.find((p) => p.id === task.project_id)
  return (
    // min-h-9: the 24px action buttons appear on the highlighted row without growing it.
    <div
      onMouseEnter={onHover}
      className={cn('relative flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-body transition-colors', selected && 'bg-hover')}
    >
      <div
        role="option"
        id={optionId}
        aria-selected={selected}
        data-omnibar-row={rowKey}
        data-selected={selected || undefined}
        onMouseDown={(e) => e.preventDefault()} // keep focus in the field
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
          {done ? (
            <Check className="size-3.5" />
          ) : task.priority > 1 ? (
            <span className={cn('size-2 rounded-full', PRIORITY_COLORS[task.priority])} />
          ) : (
            <Circle className="size-3" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('truncate', done && 'text-muted-foreground line-through')}>
            <Marked segments={markTitle(task.content, tokens)} />
          </span>
          {hit.snippet && (
            <Meta className="truncate">
              <Marked segments={splitMarked(hit.snippet)} />
            </Meta>
          )}
        </span>
        {!selected && done && <Meta className="shrink-0">{formatDoneDate(task.completed_at)}</Meta>}
        {!selected && !done && project && project.id !== 'inbox' && (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-label text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: project.color }} />
            {project.name}
          </span>
        )}
      </div>

      {selected && !done && (
        <div className="flex shrink-0 items-center gap-0.5">
          <ActionButton icon={Check} hint="⌥C" title="Complete" onClick={onComplete} className="text-success/70 hover:text-success" />
          <FocusPlayMenu task={task} />
          <ActionButton icon={Sparkles} hint="⌥B" title="Break down" onClick={onBreakDown} className="text-ai/70 hover:text-ai" />
          <DropdownMenu>
            {/* One element, two roles: the tooltip trigger renders the menu
                trigger through Base UI's `render` prop — never two stacked
                <button>s (shell P1-3, §3.3). */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    data-move-trigger
                    aria-label="Move to project"
                    className={cn(ACTION_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
                  />
                }
              >
                <Icon icon={FolderInput} />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-meta">
                Move to project <kbd className="ml-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-label">⌥M</kbd>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" sideOffset={4} align="end" className="w-36">
              {projects
                .filter((p) => p.id !== task.project_id)
                .map((p) => (
                  <DropdownMenuItem key={p.id} className="gap-2" onClick={() => onMove(p.id)}>
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

/** ⌥B: AI breakdown of the highlighted task (moved from CommandBarResults). */
export function BreakdownPanel({ task, loading, items, onEdit, onRemove, onConfirm, onCancel }: {
  task: LocalTask
  loading: boolean
  items: string[]
  onEdit: (index: number, value: string) => void
  onRemove: (index: number) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-popover shadow-lg">
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-label text-muted-foreground">
            Breaking down: <span className="text-foreground">{task.content}</span>
          </span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel breakdown"
            className="relative -m-1.5 rounded-md p-1.5 text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground after:absolute after:-inset-2"
          >
            <Icon icon={X} />
          </button>
        </div>
        {/* Loading: skeleton rows shaped like the subtask inputs — no spinner. */}
        {loading ? (
          <div className="space-y-1" role="status" aria-label="Breaking down task">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Skeleton className="h-3 w-4 shrink-0" />
                <Skeleton className="h-7 flex-1 rounded-md" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-1">
              {items.map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-4 shrink-0 text-right text-meta text-muted-foreground">{i + 1}</span>
                  <input
                    type="text"
                    value={item}
                    aria-label={`Step ${i + 1}`}
                    onChange={(e) => onEdit(i, e.target.value)}
                    className="flex-1 rounded-md bg-muted/30 px-2 py-1 text-body outline-none focus:ring-1 focus:ring-accent-blue/40"
                  />
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={`Remove step ${i + 1}`}
                    className="relative -m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-(--transition-fast) hover:text-destructive after:absolute after:-inset-2.5"
                  >
                    <Icon icon={X} className="size-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1 text-meta text-muted-foreground hover:bg-hover">
                Cancel
              </button>
              {/* font-medium kept for contrast on foreground bg */}
              <button type="button" onClick={onConfirm} className="rounded-md bg-foreground px-2.5 py-1 text-meta font-medium text-background hover:bg-foreground/90">
                Create {items.filter(Boolean).length} subtasks
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
