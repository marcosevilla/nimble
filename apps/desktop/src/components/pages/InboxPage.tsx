import { subscribeDataChanges } from '@/lib/dataChanges'
import { useEffect, useCallback, useMemo, useState, useRef } from 'react'
// Window-to-window event bus, not data access — the web build aliases
// '@tauri-apps/api/event' to a no-op stub (src/platform/), so this stays
// portable. Not part of the DataProvider seam.
// eslint-disable-next-line no-restricted-imports
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '@/stores/appStore'
import { useLocalTasks } from '@/hooks/useLocalTasks'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { useDetailStore } from '@/stores/detailStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { focusSpaceAction } from '@/stores/focusStore'
import { SelectionCheckbox } from '@/components/shared/SelectionCheckbox'
import { useDataProvider } from '@/services/provider-context'
import type { CaptureRoute } from '@nimble/types'
import { parseRoutePrefix } from '@/lib/captureRoutes'
import { cn } from '@/lib/utils'
import { LocalTaskRow } from '@/components/tasks/LocalTaskRow'
import { useRowNavigation } from '@/hooks/useTaskNavigation'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { taskToast } from '@/lib/taskToast'
import { Inbox as InboxIcon, PenLine, ArrowRight, FileText, Download, Search, X } from 'lucide-react'
import { PageFrame } from '@/components/shared/PageFrame'
import { EmptyState } from '@/components/shared/EmptyState'
import { RoutePill, DateChip } from '@/components/capture/CaptureTokens'
import { HighlightField } from '@/components/capture/HighlightField'
import { useCaptureDate } from '@/hooks/useCaptureDate'
import { routeWithDate, convertWithDate } from '@/lib/captureActions'
import { isTextEntry } from '@/lib/keyGuard'
import type { LocalTask, Capture, DocFolder, Document } from '@nimble/types'

// ── Unified inbox item type ──

type InboxItem =
  | {
      kind: 'task'
      data: LocalTask
      sortDate: string
      isSubtask?: boolean
      subtaskStats?: { done: number; total: number }
    }
  | { kind: 'note'; data: Capture; sortDate: string }

// Row ids for keyboard navigation — unique across the two kinds.
const rowId = (item: InboxItem) => `${item.kind}:${item.data.id}`

// Fix round 1: converting note A then note B inside A's undo window used to
// register two independent `keydown` listeners, so one ⌘Z ran BOTH keeps —
// both tasks lost their dates. A single module-level slot always points at
// the latest dated convert; a single listener (installed once, since the
// toast — and any future convert — outlives InboxPage's own lifetime) fires
// only that one. Each toast's own "Keep as text" button still calls its own
// `keep`, unaffected by which entry currently holds the slot.
let latestKeep: { run: () => void } | null = null
let undoListenerInstalled = false
function installUndoListener() {
  if (undoListenerInstalled) return
  undoListenerInstalled = true
  window.addEventListener('keydown', (e) => {
    if (
      e.key !== 'z' ||
      !(e.metaKey || e.ctrlKey) ||
      e.shiftKey ||
      e.altKey ||
      e.repeat ||
      e.defaultPrevented ||
      isTextEntry(e.target as Element | null)
    ) {
      return
    }
    e.preventDefault()
    latestKeep?.run()
  })
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable ||
    !!el.closest?.('[role="dialog"]')
  )
}

const noop = () => {}

// ── Main page ──

export function InboxPage() {
  const dp = useDataProvider()
  const currentPage = useAppStore((s) => s.currentPage)
  const captureRequested = useAppStore((s) => s.captureRequested)
  const setCaptureRequested = useAppStore((s) => s.setCaptureRequested)

  const { tasks, loading: tasksLoading } = useLocalTasks({ projectId: 'inbox' })
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  const [captures, setCaptures] = useState<Capture[]>([])
  const [capturesLoading, setCapturesLoading] = useState(true)
  const [inputValue, setInputValue] = useState('')
  const [importing, setImporting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [routes, setRoutes] = useState<CaptureRoute[]>([])

  // Fetch capture routes
  useEffect(() => {
    dp.captureRoutes.list().then(setRoutes).catch(() => {})
  }, [dp])

  // Real-time route detection
  const parsedRoute = useMemo(
    () => parseRoutePrefix(inputValue, routes),
    [inputValue, routes],
  )
  const taskBound = parsedRoute.route?.target_type === 'task' && parsedRoute.content.trim() !== ''
  const capDate = useCaptureDate(inputValue, parsedRoute.content, taskBound)

  const loading = tasksLoading || capturesLoading

  // Fetch captures
  const refreshCaptures = useCallback(async () => {
    try {
      const data = await dp.captures.list(50)
      setCaptures(data)
    } catch { /* silently fail */ }
    finally { setCapturesLoading(false) }
  }, [dp])

  useEffect(() => { refreshCaptures() }, [refreshCaptures])

  useEffect(() => subscribeDataChanges('captures', () => { void refreshCaptures() }), [refreshCaptures])

  // Listen for task changes to also refresh captures
  useEffect(() => {
    const handler = () => refreshCaptures()
    window.addEventListener('tasks-changed', handler)
    return () => window.removeEventListener('tasks-changed', handler)
  }, [refreshCaptures])

  // Cross-window: refresh when the quick-capture strip saves a capture
  useEffect(() => {
    const unlisten = listen('captures-changed', () => refreshCaptures())
    return () => { unlisten.then((fn) => fn()) }
  }, [refreshCaptures])

  // Auto-focus from the tray / command bar handoff
  useEffect(() => {
    if (captureRequested) {
      requestAnimationFrame(() => inputRef.current?.focus())
      const timer = setTimeout(() => setCaptureRequested(false), 100)
      return () => clearTimeout(timer)
    }
  }, [captureRequested, setCaptureRequested])

  // `c` focuses the capture field from anywhere on the page (inbox audit
  // P1-3); Escape inside the field blurs back to the list (see the input).
  useEffect(() => {
    if (currentPage !== 'inbox') return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPage])

  // Merge + sort chronologically. Parent tasks appear sorted by creation
  // date; their subtasks follow them as adjacent rows regardless of their
  // own creation date.
  const items = useMemo<InboxItem[]>(() => {
    const activeTasks = tasks.filter((t) => t.status !== 'complete')

    const subtaskMap: Record<string, LocalTask[]> = {}
    for (const t of activeTasks) {
      if (t.parent_id) {
        if (!subtaskMap[t.parent_id]) subtaskMap[t.parent_id] = []
        subtaskMap[t.parent_id].push(t)
      }
    }

    const parentTaskItems: InboxItem[] = activeTasks
      .filter((t) => !t.parent_id)
      .map((t) => {
        const subs = subtaskMap[t.id] ?? []
        const done = subs.filter((s) => s.completed || s.status === 'complete').length
        return {
          kind: 'task',
          data: t,
          sortDate: t.created_at,
          subtaskStats: subs.length > 0 ? { done, total: subs.length } : undefined,
        }
      })

    // A routed capture is already processed (it lives in its doc / became
    // a task) — it is history, not triage work (inbox audit P2-2).
    const noteItems: InboxItem[] = captures
      .filter((c) => !c.converted_to_task_id && c.source !== 'route')
      .map((c) => ({ kind: 'note', data: c, sortDate: c.created_at }))

    // Merge parents + notes, sort chronologically
    const merged: InboxItem[] = [...parentTaskItems, ...noteItems].sort((a, b) =>
      b.sortDate.localeCompare(a.sortDate),
    )

    // Interleave subtasks after their parent
    const result: InboxItem[] = []
    for (const item of merged) {
      result.push(item)
      if (item.kind === 'task' && !item.data.parent_id) {
        const subs = subtaskMap[item.data.id] ?? []
        for (const sub of subs) {
          result.push({ kind: 'task', data: sub, sortDate: sub.created_at, isSubtask: true })
        }
      }
    }
    return result
  }, [tasks, captures])

  const captureById = useCallback(
    (id: string) => captures.find((c) => c.id === id),
    [captures],
  )

  // ── Handlers (all optimistic — inbox audit P1-4, P2-3) ──

  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text) return
    const { route, content } = parseRoutePrefix(text, routes)
    setInputValue('')

    if (route && content) {
      // Routed captures never show in the triage list, so there is no row
      // to add optimistically — just keep the field free for the next one.
      try {
        const date = route.target_type === 'task' ? capDate.date : null
        const { result, dateSet, dateFailed } = await routeWithDate(dp, route, content, date)
        if (result.target_type === 'task') emitTasksChanged()
        if (dateSet && date) toast.success(`Saved to ${result.label} · due ${date.label}`)
        else if (dateFailed) toast(`Saved to ${result.label}. The date didn't stick. Set it on the task.`)
        else toast.success(`Saved to ${result.label}`)
        refreshCaptures()
      } catch (e) {
        setInputValue(text)
        toast.error(`Failed: ${e}`)
      }
      return
    }

    // Plain capture: the row appears now, reconciles when the save lands.
    const tempId = `temp-${Date.now()}`
    const temp: Capture = {
      id: tempId,
      content: text,
      source: 'inbox',
      converted_to_task_id: null,
      routed_to: null,
      context: null,
      created_at: new Date().toISOString(),
    }
    setCaptures((prev) => [temp, ...prev])
    try {
      const created = await dp.captures.create(text, 'inbox')
      setCaptures((prev) => prev.map((c) => (c.id === tempId ? created : c)))
    } catch (e) {
      setCaptures((prev) => prev.filter((c) => c.id !== tempId))
      setInputValue(text)
      toast.error(`Failed: ${e}`)
    }
  }, [inputValue, routes, refreshCaptures, dp, capDate.date])

  const handleConvert = useCallback(async (capture: Capture) => {
    if (capture.id.startsWith('temp-')) return
    setCaptures((prev) => prev.filter((c) => c.id !== capture.id))
    try {
      const { task, date, keepAsText } = await convertWithDate(dp, capture, new Date())
      emitTasksChanged()
      if (!date || !keepAsText) {
        taskToast(`Converted to task: "${capture.content}"`, task.id)
        return
      }
      // "Keep as text": click this toast's own action, or ⌘Z while it's the
      // MOST RECENT dated convert still showing (see `latestKeep` above) —
      // converting a second note reassigns the slot, so an earlier toast's
      // ⌘Z no longer fires; its own button still works regardless.
      installUndoListener()
      // `entry`'s identity (not its contents) is the slot key — `.run` is
      // filled in below once `keep` exists, but the object itself is created
      // first so `cleanup` can compare `latestKeep === entry` from the start.
      const entry: { run: () => void } = { run: () => {} }
      let done = false
      const cleanup = () => { if (latestKeep === entry) latestKeep = null }
      const keep = async () => {
        if (done) return
        done = true
        cleanup()
        toast.dismiss(toastId)
        try {
          await keepAsText()
          emitTasksChanged()
          toast(`Kept "${capture.content}" as written`)
        } catch (e) {
          toast.error(`Couldn't restore the text: ${e}`)
        }
      }
      entry.run = () => void keep()
      latestKeep = entry
      const toastId = toast.success(`Converted · due ${date.label}`, {
        action: { label: 'Keep as text', onClick: () => void keep() },
        onDismiss: cleanup,
        onAutoClose: cleanup,
      })
    } catch (e) {
      setCaptures((prev) => [capture, ...prev])
      toast.error(`Failed to convert: ${e}`)
    }
  }, [dp])

  // Row-level dismiss with Undo. Undo re-creates the capture, so it comes
  // back with a new id (a true soft-delete needs Rust — queued for Marco).
  const handleDismiss = useCallback(async (capture: Capture) => {
    if (capture.id.startsWith('temp-')) return
    setCaptures((prev) => prev.filter((c) => c.id !== capture.id))
    try {
      await dp.captures.delete(capture.id)
    } catch (e) {
      setCaptures((prev) => [capture, ...prev])
      toast.error(`Failed to dismiss: ${e}`)
      return
    }
    toast('Note dismissed', {
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            const restored = await dp.captures.create(capture.content, capture.source, capture.context ?? undefined)
            setCaptures((prev) => [restored, ...prev])
          } catch (e) {
            toast.error(`Failed to restore: ${e}`)
          }
        },
      },
    })
  }, [dp])

  const handleMovedToDoc = useCallback((capture: Capture) => {
    setCaptures((prev) => prev.filter((c) => c.id !== capture.id))
    setPickerFor(null)
  }, [])

  // The move failed before anything was written: put the row back.
  const handleMoveFailed = useCallback((capture: Capture) => {
    setCaptures((prev) => (prev.some((c) => c.id === capture.id) ? prev : [capture, ...prev]))
  }, [])

  const handleImport = useCallback(async () => {
    setImporting(true)
    try {
      const count = await dp.obsidian.importCaptures()
      if (count > 0) {
        toast.success(`Imported ${count} notes from Obsidian`)
        refreshCaptures()
      } else {
        toast.success('No new notes to import')
      }
    } catch (e) {
      toast.error(`Import failed: ${e}`)
    } finally {
      setImporting(false)
    }
  }, [refreshCaptures, dp])

  // ── Keyboard rows (inbox audit P1-2): j/k/Enter over every row, t/m/d on
  // the focused note. Registered in lib/shortcuts.ts under Inbox. ──
  const rowIds = useMemo(() => items.map(rowId), [items])

  const openRow = useCallback((id: string) => {
    const [kind, itemId] = id.split(':', 2)
    if (kind === 'task') useDetailStore.getState().openTask(itemId)
    else useDetailStore.getState().openCapture(itemId)
  }, [])

  const noteFromRow = useCallback(
    (id: string) => (id.startsWith('note:') ? captureById(id.slice(5)) : undefined),
    [captureById],
  )

  const rowKeys = useMemo(
    () => ({
      t: (id: string) => { const c = noteFromRow(id); if (c) void handleConvert(c) },
      m: (id: string) => { const c = noteFromRow(id); if (c) setPickerFor(c.id) },
      d: (id: string) => { const c = noteFromRow(id); if (c) void handleDismiss(c) },
    }),
    [noteFromRow, handleConvert, handleDismiss],
  )

  const { focusedId, focusRow } = useRowNavigation(rowIds, openRow, { pages: ['inbox'], keys: rowKeys, memoryKey: 'inbox' })

  return (
    <PageFrame
      title="Inbox"
      meta={items.length > 0 ? `${items.length} item${items.length !== 1 ? 's' : ''}` : undefined}
      actions={
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
          title="Import from Obsidian"
        >
          <Download className="size-3" />
          {importing ? 'Importing…' : 'Import'}
        </button>
      }
      bodyClassName="space-y-4"
    >
      {/* Note input — command bar style. Never disabled: rapid capture is
          the point (inbox audit P1-4); the ring is the focus state (P2-7). */}
      <div className="flex h-10 items-center gap-2 surface-inset border border-transparent px-3 transition-colors focus-within:border-ring">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <HighlightField
          fieldRef={inputRef}
          value={inputValue}
          highlight={capDate.highlight}
          wrapperClassName="flex-1"
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (capDate.onKeyDown(e)) return
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
            if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() }
          }}
          placeholder="Write a note… (/i idea, /q quote, /t task)"
          aria-label="Capture a note"
          className="text-body outline-none placeholder:text-muted-foreground"
        />
        {parsedRoute.route && parsedRoute.content && <RoutePill route={parsedRoute.route} />}
        {capDate.date && <DateChip label={capDate.date.label} />}
        {inputValue.trim() ? (
          <button
            type="button"
            onClick={handleSubmit}
            className="relative rounded px-1 text-meta text-muted-foreground hover:text-foreground transition-colors after:absolute after:-inset-2 after:content-['']"
          >
            Save
          </button>
        ) : (
          <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-label text-muted-foreground">C</kbd>
        )}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-2 ml-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        // Inbox zero is the good state (§1.1, inbox audit P2-5): one calm
        // line, no button — Import stays in the header.
        <EmptyState icon={InboxIcon}>
          Inbox zero. New thoughts land here — ⌘K or the capture strip.
        </EmptyState>
      ) : (
        <div>
          {items.map((item) => {
            const id = rowId(item)
            return item.kind === 'task' ? (
              <LocalTaskRow
                key={id}
                task={item.data}
                isSubtask={item.isSubtask}
                subtaskStats={item.subtaskStats}
                onDelete={noop}
                showGrip={false}
                navId={id}
                focused={focusedId === id}
                onFocusRow={() => focusRow(id)}
              />
            ) : (
              <InboxNoteRow
                key={id}
                capture={item.data}
                navId={id}
                focused={focusedId === id}
                onFocusRow={() => focusRow(id)}
                onConvert={() => handleConvert(item.data)}
                onDismiss={() => handleDismiss(item.data)}
                pickerOpen={pickerFor === item.data.id}
                onPickerOpenChange={(open) => setPickerFor(open ? item.data.id : null)}
                onMoved={() => handleMovedToDoc(item.data)}
                onMoveFailed={() => handleMoveFailed(item.data)}
              />
            )
          })}
        </div>
      )}
    </PageFrame>
  )
}

// ── Note row ──
//
// Same chrome as TaskItem (tasks list) so the two lists read as one object
// (inbox audit P2-6): 36px row, hover cluster hanging outside the column,
// content offset by margin so the hairline starts at the icon.

function InboxNoteRow({
  capture,
  navId,
  focused,
  onFocusRow,
  onConvert,
  onDismiss,
  pickerOpen,
  onPickerOpenChange,
  onMoved,
  onMoveFailed,
}: {
  capture: Capture
  navId: string
  focused: boolean
  onFocusRow: () => void
  onConvert: () => void
  onDismiss: () => void
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  onMoved: () => void
  onMoveFailed: () => void
}) {
  const isSelected = useSelectionStore((s) => s.selectedIds.has(capture.id))
  const rowRef = useRef<HTMLDivElement>(null)
  const open = () => useDetailStore.getState().openCapture(capture.id)

  // DOM focus moves via useRowNavigation on j/k only (review C1); `focused`
  // is just the tint. Closing the picker hands focus back to the row (its
  // `finalFocus`), not the trigger, so j/k keep working.

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      data-nav-row={navId}
      onClick={open}
      onFocus={(e) => { if (e.target === e.currentTarget) onFocusRow() }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        // Enter and Space open, like any role="button" (review I2); Space
        // pauses a running focus session instead (Dashboard).
        if (e.key === 'Enter' || (e.key === ' ' && !focusSpaceAction())) {
          e.preventDefault()
          open()
        }
      }}
      className={cn(
        'group relative flex h-9 items-center min-w-0 transition-colors hover:bg-hover cursor-default',
        'focus-visible:-outline-offset-2',
        focused && 'bg-accent/10',
        isSelected && 'bg-accent-blue/10',
      )}
    >
      <div className="absolute right-full top-0 flex h-9 items-center gap-1 pr-2">
        <SelectionCheckbox id={capture.id} type="capture" />
      </div>

      <div className="flex flex-1 h-9 items-center gap-3 min-w-0 ml-4 border-b border-secondary">
        <PenLine className="size-4 shrink-0 text-muted-foreground" />

        <span className="flex-1 min-w-0 truncate text-body">{capture.content}</span>

        {/* Source app (selection captures) */}
        {capture.context && (
          <span className="shrink-0 text-meta text-muted-foreground">
            from {capture.context}
          </span>
        )}

        {/* Actions — revealed on hover AND on keyboard focus anywhere in the
            row (P1-2); each carries its single-key hint. Out of the layout
            until then (not just transparent), so in the 640px page column
            the note text gets the row's full width (C1). Kept mounted while
            the picker is open — the popover anchors to its trigger. */}
        <div
          className={cn(
            'hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex',
            pickerOpen && 'flex',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
            <PopoverTrigger className={ROW_ACTION}>
              <FileText className="size-3" />
              Move to doc
              <RowKbd>M</RowKbd>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              sideOffset={4}
              className="w-72 gap-0 rounded-xl p-2"
              finalFocus={rowRef}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // Keep j/k/t/m/d typed inside the picker from reaching the
                // row list; Escape and Tab stay with the popover.
                if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation()
              }}
            >
              {pickerOpen && <MoveToDocPicker capture={capture} onMoved={onMoved} onFailed={onMoveFailed} />}
            </PopoverContent>
          </Popover>
          <button type="button" onClick={onConvert} className={ROW_ACTION}>
            <ArrowRight className="size-3" />
            Convert to task
            <RowKbd>T</RowKbd>
          </button>
          <button type="button" onClick={onDismiss} className={ROW_ACTION} aria-label="Dismiss note">
            <X className="size-3" />
            Dismiss
            <RowKbd>D</RowKbd>
          </button>
        </div>
      </div>
    </div>
  )
}

// 18px-tall text buttons get a 32px+ target via ::after (inbox audit P3-2).
const ROW_ACTION =
  "relative flex items-center gap-1 rounded-md px-1.5 py-0.5 text-label text-muted-foreground transition-colors hover:text-foreground hover:bg-hover after:absolute after:-inset-2 after:content-['']"

function RowKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-muted/60 px-1 font-mono text-label text-muted-foreground">{children}</kbd>
  )
}

// ── Move to doc picker (inside the row's Popover — Escape, focus and
// dismissal come from the primitive; inbox audit P1-1) ──

function MoveToDocPicker({ capture, onMoved, onFailed }: { capture: Capture; onMoved: () => void; onFailed: () => void }) {
  const dp = useDataProvider()
  const [folders, setFolders] = useState<DocFolder[]>([])
  const [docs, setDocs] = useState<Document[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    dp.docs.getFolders().then(setFolders).catch(() => {})
    dp.docs.getDocuments().then((d) => { setDocs(d); setLoading(false) }).catch(() => setLoading(false))
  }, [dp])

  const filteredDocs = selectedFolderId
    ? docs.filter((d) => d.folder_id === selectedFolderId)
    : docs

  const handleSelect = async (docId: string) => {
    const doc = docs.find((d) => d.id === docId)
    onMoved()
    try {
      await dp.docs.createNote(docId, capture.content)
    } catch (e) {
      onFailed()
      toast.error(`Failed to move: ${e}`)
      return
    }
    try {
      await dp.captures.delete(capture.id)
      toast.success(`Moved to "${doc?.title || 'doc'}"`)
    } catch {
      // The note is in the doc; only the inbox copy stayed. Say so rather
      // than restoring a row that would read as "not moved".
      toast.error(`Saved to "${doc?.title || 'doc'}", but the note is still in your inbox`)
      emitTasksChanged()
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-meta text-muted-foreground">Move to doc</span>
        <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-label text-muted-foreground">Esc</kbd>
      </div>

      {/* Folder filter */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setSelectedFolderId(null)}
          className={cn('rounded-sm px-2 py-0.5 text-label transition-colors', !selectedFolderId ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-hover')}
        >
          All
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSelectedFolderId(f.id)}
            className={cn('rounded-sm px-2 py-0.5 text-label transition-colors', selectedFolderId === f.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-hover')}
          >
            {f.name}
          </button>
        ))}
      </div>

      {/* Doc list — skeleton rows while loading (P1-5), never a spinner or
          "Loading..." string. */}
      <div className="max-h-48 space-y-0.5 overflow-y-auto [scrollbar-gutter:stable]">
        {loading ? (
          <>
            <Skeleton className="h-8 rounded-sm" />
            <Skeleton className="h-8 rounded-sm" />
            <Skeleton className="h-8 rounded-sm" />
          </>
        ) : filteredDocs.length === 0 ? (
          <p className="py-2 text-center text-meta text-muted-foreground">No docs yet</p>
        ) : (
          filteredDocs.map((doc, i) => (
            <button
              key={doc.id}
              type="button"
              autoFocus={i === 0}
              onClick={() => handleSelect(doc.id)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-body transition-colors hover:bg-hover"
            >
              <FileText className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{doc.title || 'Untitled'}</span>
            </button>
          ))
        )}
      </div>

      {/* Note preview */}
      <div className="mt-2 border-t border-border/20 pt-2">
        <p className="truncate text-label text-muted-foreground">"{capture.content}"</p>
      </div>
    </div>
  )
}
