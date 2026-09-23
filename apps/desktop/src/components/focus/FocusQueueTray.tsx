import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
import { Caption } from '@/components/shared/typography'
import { FocusTaskCard } from '@/components/focus/FocusTaskCard'
import { FocusQueueList, type FocusQueueRow } from '@/components/focus/FocusQueueList'
import { FocusCompletedTray } from '@/components/focus/FocusCompletedTray'
import { FocusSourcePicker, FocusStillOpenDrawer } from '@/components/focus/FocusSourcePicker'
import { useFocusCache, retryFocusCommand } from '@/stores/focusStore'
import type { FocusRequestError } from '@/services/focus-events'
import { buildFocusPrompt, copyFocusPrompt } from '@/lib/focusPrompt'
import { candidateIds, queueTheseAction } from '@/lib/focusSources'
import {
  failureControl,
  menuFocusAction,
  queueBlockedReason,
  runQuickAdd,
  sourceLabel,
  stillOpenAction,
  undoDeleteAction,
  type FocusTaskOps,
  type TaskMenuId,
} from '@/lib/focusQueueIntents'
import { playCompletionSound } from '@/lib/sound'
import { cn } from '@/lib/utils'
import type {
  FocusAction,
  FocusCapabilities,
  FocusCommand,
  FocusEntry,
  FocusHistoryRow,
  FocusReply,
  FocusSnapshot,
  FocusSource,
  LocalTask,
  Project,
  Section,
} from '@nimble/types'

const UNDO_MS = 10_000
const ACK_MS = 2_500

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isOpen = (task: LocalTask) => !task.completed && task.status !== 'complete'

export interface FocusQueueTrayProps {
  snapshot: FocusSnapshot
  capabilities: FocusCapabilities | null
  /** Native tasks (including children) the queue and candidates resolve against. */
  tasks: LocalTask[]
  projects: Project[]
  /** All sections; project candidates need them for project order. */
  sections: Section[]
  /** Today's completed, non-archived tray rows. */
  completed: FocusHistoryRow[]
  /** Local calendar date (YYYY-MM-DD). */
  today: string
  onAction: (action: FocusAction) => Promise<FocusReply>
  taskOps: FocusTaskOps
  initialSource?: FocusSource
  /** Card-only presentation (companion collapse); purely visual. */
  initialCompact?: boolean
  soundMuted?: boolean
  onSoundMutedChange?: (muted: boolean) => void
  /** Focus request failure to show; defaults to the shared focus cache's error. */
  error?: FocusRequestError | null
}

/** Inline Add: Enter submits (Shift+Enter for a batch line); focus stays for rapid entry. */
function FocusQuickAdd({
  source,
  projects,
  blockedReason,
  onSubmit,
}: {
  source: FocusSource
  projects: Project[]
  blockedReason: string | null
  onSubmit: (text: string) => Promise<{ remaining: string; error: string | null }>
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  const placeholder =
    source.kind === 'today' ? 'Add task to Today' : source.kind === 'local' ? 'Add a local-only task' : `Add task to ${sourceLabel(source, projects)}`

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await onSubmit(text)
      setText(result.remaining)
      setError(result.error)
    } finally {
      setBusy(false)
      ref.current?.focus()
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={blockedReason != null}
        title={blockedReason ?? undefined}
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-body text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground focus-ring focus-visible:-outline-offset-2 disabled:opacity-50"
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        Add task
      </button>
    )
  }

  return (
    <div className="border-b border-border px-4 py-2">
      <div className="flex items-start gap-2.5">
        <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <textarea
          ref={ref}
          rows={Math.min(4, Math.max(1, text.split('\n').length))}
          aria-label={placeholder}
          aria-invalid={error ? true : undefined}
          aria-busy={busy || undefined}
          readOnly={busy}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setText('')
              setError(null)
              setEditing(false)
            }
          }}
          onBlur={() => {
            if (!text.trim() && !busy) setEditing(false)
          }}
          className={cn('min-w-0 flex-1 resize-none bg-transparent text-body outline-none placeholder:text-muted-foreground', busy && 'opacity-60')}
        />
      </div>
      {error && (
        <Caption as="p" role="alert" className="mt-1 pl-6.5 text-destructive">
          {error}
        </Caption>
      )}
    </div>
  )
}

/**
 * The ambient focus tray: familiar card, Up next, inline Add, completed tray,
 * still-open drawer and bottom-anchored source footer. Card-only mode
 * unmounts everything below the card (and its tab stops) but keeps feedback
 * and "Show queue". It renders provider snapshots; it never starts timing.
 */
export function FocusQueueTray({
  snapshot,
  capabilities,
  tasks,
  projects,
  sections,
  completed,
  today,
  onAction,
  taskOps,
  initialSource = { kind: 'today' },
  initialCompact = false,
  soundMuted = false,
  onSoundMutedChange,
  error,
}: FocusQueueTrayProps) {
  const [compact, setCompact] = useState(initialCompact)
  const [source, setSource] = useState<FocusSource>(initialSource)
  const [renamingEntryId, setRenamingEntryId] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ token: string | null; title: string } | null>(null)
  const [ack, setAck] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [manualCopy, setManualCopy] = useState<{ text: string; message: string } | null>(null)
  const storeError = useFocusCache((s) => s.error)
  const cacheError = error !== undefined ? error : storeError
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!undo) return
    const id = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(id)
  }, [undo])
  useEffect(() => {
    if (!ack) return
    const id = setTimeout(() => setAck(null), ACK_MS)
    return () => clearTimeout(id)
  }, [ack])

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const projectName = useCallback((id: string) => projects.find((p) => p.id === id)?.name, [projects])
  const blocked = queueBlockedReason(capabilities)

  /** Every write goes through here: failures stay visible, completion is acknowledged after commit. */
  const run = useCallback(
    async (action: FocusAction): Promise<FocusReply | null> => {
      setLocalError(null)
      try {
        const reply = await onAction(action)
        if (action.kind === 'complete') {
          if (!soundMuted) playCompletionSound()
          setAck('Completed. Next task is ready when you are.')
        }
        return reply
      } catch (error) {
        setLocalError(messageOf(error))
        return null
      }
    },
    [onAction, soundMuted],
  )

  const [first, ...rest] = snapshot.queue
  const firstTask = first ? byId.get(first.task_id) ?? null : null
  const rows: FocusQueueRow[] = rest.map((entry) => ({ entry, task: byId.get(entry.task_id) ?? null }))
  const childrenOf = (id: string) => tasks.filter((t) => t.parent_id === id)

  const sourceSections = source.kind === 'project' ? sections.filter((s) => s.project_id === source.project_id) : []
  const queueThese = queueTheseAction(tasks, source, today, snapshot, { sections: sourceSections })
  const queuedTaskIds = new Set(snapshot.queue.map((e) => e.task_id))
  const stillOpen =
    source.kind === 'today'
      ? candidateIds(tasks, source, today)
          .still_open_ids.filter((id) => !queuedTaskIds.has(id))
          .flatMap((id) => byId.get(id) ?? [])
      : []

  const focusCard = () => requestAnimationFrame(() => headingRef.current?.focus())
  const promote = async (entry: FocusEntry) => {
    if (await run({ kind: 'promote', occurrence_id: entry.occurrence_id })) focusCard()
  }

  const rename = async (task: LocalTask, content: string) => {
    try {
      await taskOps.rename(task, content)
      setRenamingEntryId(null)
      return true
    } catch (error) {
      setLocalError(messageOf(error))
      return false
    }
  }

  const handleMenu = async (id: TaskMenuId, task: LocalTask, entry: FocusEntry) => {
    setLocalError(null)
    try {
      switch (id) {
        case 'copy_context': {
          const text = buildFocusPrompt(task, childrenOf(task.id), snapshot, {
            projectName: projectName(task.project_id),
            capabilities,
          })
          const result = await copyFocusPrompt(text, taskOps.writeClipboard)
          if (result.ok) setAck('Assistant context copied.')
          else setManualCopy({ text: result.text, message: result.message })
          return
        }
        case 'open_details':
          return taskOps.openDetail(task)
        case 'rename':
          return setRenamingEntryId(entry.id)
        case 'duplicate': {
          const copy = await taskOps.duplicate(task)
          await run({ kind: 'enqueue', task_ids: [copy.id], source: { kind: 'local' }, explicit_still_open: false })
          return
        }
        case 'move_top':
          return void (await promote(entry))
        case 'move_bottom':
        case 'skip':
        case 'stop':
        case 'remove': {
          const action = menuFocusAction(id, entry, snapshot.queue)
          if (action) await run(action)
          return
        }
        case 'delete': {
          const { undo_token } = await taskOps.remove(task)
          setUndo({ token: undo_token, title: task.content })
          return
        }
      }
    } catch (error) {
      setLocalError(messageOf(error))
    }
  }

  const completeSubtask = async (sub: LocalTask) => {
    setLocalError(null)
    try {
      await taskOps.complete(sub)
    } catch (error) {
      setLocalError(messageOf(error))
    }
  }

  const failure = failureControl(cacheError) ?? (localError ? { message: localError, retry: null } : null)
  const syncNote = snapshot.replica ? `Last synced ${format(parseISO(snapshot.as_of), 'h:mm a')}` : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <FocusTaskCard
          snapshot={snapshot}
          capabilities={capabilities}
          entry={first ?? null}
          task={firstTask}
          subtasks={firstTask ? childrenOf(firstTask.id).filter(isOpen) : []}
          projectName={firstTask ? projectName(firstTask.project_id) : undefined}
          today={today}
          compact={compact}
          onToggleCompact={() => setCompact((v) => !v)}
          onAction={run}
          onCompleteSubtask={(sub) => void completeSubtask(sub)}
          onMenu={(id, task, entry) => void handleMenu(id, task, entry)}
          renaming={first != null && renamingEntryId === first.id}
          onRename={rename}
          onRenameCancel={() => setRenamingEntryId(null)}
          headingRef={headingRef}
        />

        {/* Feedback stays in both modes. Failures render above acknowledgement
            and are never replaced by it. */}
        <div className="flex flex-col gap-1.5 empty:hidden px-4 pt-2 last:pb-2">
          {failure && (
            <div role="alert" className="flex items-start justify-between gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-meta text-foreground">
              <span className="min-w-0 break-words">{failure.message}</span>
              <span className="flex shrink-0 gap-1">
                {failure.retry != null && (
                  <Button size="xs" variant="outline" onClick={() => void retryFocusCommand(failure.retry as FocusCommand).catch(() => {})}>
                    Try again
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setLocalError(null)
                    useFocusCache.setState({ error: null })
                  }}
                >
                  Dismiss
                </Button>
              </span>
            </div>
          )}
          {snapshot.recovery_reason && (
            <Caption as="p" role="status">{`Timer paused and saved: ${snapshot.recovery_reason}`}</Caption>
          )}
          {undo && (
            <div role="status" className="flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5 text-meta text-foreground">
              <span className="min-w-0 truncate">{`Deleted “${undo.title}”`}</span>
              {undo.token && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={blocked != null}
                  onClick={() => {
                    const token = undo.token as string
                    setUndo(null)
                    void run(undoDeleteAction(token))
                  }}
                >
                  Undo
                </Button>
              )}
            </div>
          )}
          {ack && !failure && (
            <Caption as="p" role="status">
              {ack}
            </Caption>
          )}
          {manualCopy && (
            <div role="alert" className="flex flex-col gap-1 rounded-md bg-muted px-2.5 py-1.5">
              <Caption as="p" tone="default">{`Couldn't copy (${manualCopy.message}). Select the text below and copy it.`}</Caption>
              <textarea
                readOnly
                aria-label="Assistant context"
                value={manualCopy.text}
                onFocus={(e) => e.currentTarget.select()}
                className="h-24 w-full resize-none rounded-sm bg-background p-1.5 text-meta outline-none focus-ring"
              />
              <Button size="xs" variant="ghost" className="self-end" onClick={() => setManualCopy(null)}>
                Close
              </Button>
            </div>
          )}
        </div>

        {!compact && (
          <>
            <FocusQueueList
              snapshot={snapshot}
              capabilities={capabilities}
              rows={rows}
              today={today}
              onAction={run}
              onPromote={(entry) => void promote(entry)}
              onMenu={(id, task, entry) => void handleMenu(id, task, entry)}
              renamingEntryId={renamingEntryId}
              onRename={rename}
              onRenameCancel={() => setRenamingEntryId(null)}
            />
            <FocusQuickAdd
              source={source}
              projects={projects}
              blockedReason={blocked}
              onSubmit={(text) => runQuickAdd(text, source, today, { create: taskOps.create, onAction })}
            />
            <FocusCompletedTray rows={completed} capabilities={capabilities} onAction={run} />
          </>
        )}
      </div>

      {!compact && (
        <div className="shrink-0">
          <FocusStillOpenDrawer
            tasks={stillOpen}
            today={today}
            blockedReason={blocked}
            onAdd={(taskIds) => void run(stillOpenAction(taskIds))}
          />
          <FocusSourcePicker
            source={source}
            projects={projects}
            onSourceChange={setSource}
            newCount={queueThese?.task_ids.length ?? 0}
            onQueueThese={() => {
              if (queueThese) void run(queueThese)
            }}
            blockedReason={blocked}
            doneCount={completed.length}
            syncNote={syncNote}
            trailing={
              onSoundMutedChange && (
                <IconButton
                  aria-label={soundMuted ? 'Unmute focus sounds' : 'Mute focus sounds'}
                  aria-pressed={soundMuted}
                  onClick={() => onSoundMutedChange(!soundMuted)}
                  className="focus-ring"
                >
                  {soundMuted ? <VolumeX className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
                </IconButton>
              )
            }
          />
        </div>
      )}
    </div>
  )
}
