import { useRef } from 'react'
import { Ellipsis, ListCheck, ListPlus, ListX, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FocusTaskControls } from '@/lib/focusTaskEntry'
import { useFocusTaskEntry, type FocusEntryTask } from './useFocusTaskEntry'
import { IconButton } from '@/components/shared/IconButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Visible focus entry points for one task — the row's hover icon and
 * overflow menu, and the task detail's Focus control. Every write goes
 * through the focus store; nothing starts except the explicit Focus now.
 */

// ── Task row ──

const QUIET = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'

/**
 * Row icon. `add`: quiet until row hover/focus. `remove`: persistent queued
 * state, click removes. `open`: the selected entry — a non-removing
 * indicator whose click opens the queue (removing it pauses a live
 * session, so that is menu-only). Disabled via `aria-disabled` + a click
 * guard, so QUIET keeps control of opacity, keyboard focus stays put and
 * the reason tooltip still shows.
 */
export function FocusQueueRowButton({
  controls,
  onToggle,
  onOpenQueue,
}: {
  controls: FocusTaskControls
  onToggle: () => void
  onOpenQueue: () => void
}) {
  if (!controls.visible || !controls.writable) return null
  const icon = controls.rowIcon
  if (icon === 'open') {
    return (
      <IconButton
        type="button"
        aria-label={`${controls.status} (current), open focus queue`}
        title={`${controls.status} — current task`}
        className="text-accent-blue/70 hover:text-accent-blue"
        onClick={(e) => { e.stopPropagation(); onOpenQueue() }}
      >
        <ListCheck className="size-3.5" />
      </IconButton>
    )
  }
  const queued = icon === 'remove'
  const { disabled, reason, label } = controls.toggle
  return (
    <IconButton
      type="button"
      aria-label={queued ? `${controls.status}, remove from focus queue` : label}
      aria-pressed={queued}
      aria-disabled={disabled || undefined}
      title={reason ?? (queued ? `${controls.status} — click to remove` : label)}
      className={cn(queued ? 'text-accent-blue/70 hover:text-accent-blue' : QUIET, 'aria-disabled:cursor-default')}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onToggle() }}
    >
      {queued ? <ListCheck className="size-3.5" /> : <ListPlus className="size-3.5" />}
    </IconButton>
  )
}

/** The focus section of a task menu: status, Add/Remove, Focus now (disabled items keep their reason). */
export function FocusTaskMenuItems({
  controls,
  onToggle,
  onFocusNow,
  shortcut,
}: {
  controls: FocusTaskControls
  onToggle: () => void
  onFocusNow: () => void
  /** Row lists that bind `f` show it next to Focus now. */
  shortcut?: string
}) {
  const { toggle, focusNow: now } = controls
  const ToggleIcon = toggle.kind === 'remove' ? ListX : ListPlus
  return (
    <DropdownMenuGroup>
      {controls.status && (
        <DropdownMenuLabel className="flex items-center gap-2">
          <ListCheck className="size-3.5 text-accent-blue" />
          {controls.status}
        </DropdownMenuLabel>
      )}
      <DropdownMenuItem className="gap-2" disabled={toggle.disabled} onClick={onToggle}>
        <ToggleIcon className="size-3.5 text-muted-foreground" />
        <span className="flex flex-col">
          {toggle.label}
          {toggle.reason && <span className="text-label text-muted-foreground">{toggle.reason}</span>}
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2" disabled={now.disabled} onClick={onFocusNow}>
        <Play className="size-3.5 text-muted-foreground" />
        <span className="flex flex-col">
          {now.label}
          {now.reason && <span className="text-label text-muted-foreground">{now.reason}</span>}
        </span>
        {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

/** Trailing row actions: the focus-queue icon and the row's overflow menu. */
export function TaskRowActions({ task, focusShortcut = false }: { task: FocusEntryTask; focusShortcut?: boolean }) {
  const { controls, toggle, start, openQueue } = useFocusTaskEntry(task)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Completed tasks and read-only queues (web) get no row focus actions.
  if (!controls.visible || !controls.writable) return null
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <FocusQueueRowButton controls={controls} onToggle={toggle} onOpenQueue={openQueue} />
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={`More actions for ${task.content}`}
          className={cn(
            'relative flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-popup-open:opacity-100',
            QUIET,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Ellipsis className="size-3.5" />
        </DropdownMenuTrigger>
        {/* Portal detaches the DOM, not the React tree: stop clicks here from
            bubbling to the row's onOpen. Closing hands focus back to the row. */}
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="w-56"
          finalFocus={() => triggerRef.current?.closest<HTMLElement>('[data-nav-row]') ?? true}
          onClick={(e) => e.stopPropagation()}
        >
          <FocusTaskMenuItems controls={controls} onToggle={toggle} onFocusNow={start} shortcut={focusShortcut ? 'F' : undefined} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ── Task detail ──

const DETAIL_BUTTON =
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-meta transition-colors aria-disabled:cursor-default aria-disabled:opacity-50'

/**
 * Detail header Focus control: primary Add to focus queue (or "In focus
 * queue" with Remove), secondary Focus now. Blocked controls stay visible,
 * `aria-disabled` so the reason tooltip still shows on hover.
 */
export function TaskFocusControlsView({
  controls,
  onToggle,
  onFocusNow,
}: {
  controls: FocusTaskControls
  onToggle: () => void
  onFocusNow: () => void
}) {
  const { toggle, focusNow: now } = controls
  if (!controls.visible) return null
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Focus">
      {toggle.kind === 'remove' ? (
        <>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-accent-blue/10 px-2 text-meta text-foreground">
            <ListCheck className="size-3 text-accent-blue" />
            {controls.status}
          </span>
          <button
            type="button"
            aria-label={toggle.label}
            aria-disabled={toggle.disabled || undefined}
            title={toggle.reason ?? toggle.label}
            className={cn(DETAIL_BUTTON, 'text-muted-foreground hover:bg-hover hover:text-foreground')}
            onClick={() => { if (!toggle.disabled) onToggle() }}
          >
            <ListX className="size-3" />
            Remove
          </button>
        </>
      ) : (
        <button
          type="button"
          aria-disabled={toggle.disabled || undefined}
          title={toggle.reason ?? undefined}
          className={cn(DETAIL_BUTTON, 'border border-border bg-card text-foreground hover:bg-hover')}
          onClick={() => { if (!toggle.disabled) onToggle() }}
        >
          <ListPlus className="size-3" />
          {toggle.label}
        </button>
      )}
      <button
        type="button"
        aria-disabled={now.disabled || undefined}
        title={now.reason ?? undefined}
        className={cn(DETAIL_BUTTON, 'text-muted-foreground hover:bg-hover hover:text-foreground')}
        onClick={() => { if (!now.disabled) onFocusNow() }}
      >
        <Play className="size-3" />
        {now.label}
      </button>
    </div>
  )
}

export function TaskFocusControls({ task }: { task: FocusEntryTask }) {
  const { controls, toggle, start } = useFocusTaskEntry(task)
  return <TaskFocusControlsView controls={controls} onToggle={toggle} onFocusNow={start} />
}
