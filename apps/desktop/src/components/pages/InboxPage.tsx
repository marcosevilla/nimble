import { useEffect, useCallback, useMemo, useState, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useLocalTasks } from '@/hooks/useLocalTasks'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { useDetailStore } from '@/stores/detailStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { SelectionCheckbox } from '@/components/shared/SelectionCheckbox'
import { useDataProvider } from '@/services/provider-context'
import type { CaptureRoute } from '@daily-triage/types'
import { parseRoutePrefix } from '@/lib/captureRoutes'
import { cn } from '@/lib/utils'
import { StatusDropdown } from '@/components/tasks/StatusDropdown'
import { SubtaskBadge, SubtaskSummary } from '@/components/tasks/TaskItem'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { taskToast } from '@/lib/taskToast'
import { PenLine, ArrowRight, FileText, Download, Search, Lightbulb, Quote, CheckSquare } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import type { LocalTask, Capture, DocFolder, Document } from '@daily-triage/types'

// ── Route icon map ──

const ROUTE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Lightbulb,
  Quote,
  CheckSquare,
  FileText,
}

function RouteIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ROUTE_ICONS[name] ?? FileText
  return <Icon className={className} />
}

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

// ── Main page ──

export function InboxPage() {
  const dp = useDataProvider()
  const captureRequested = useAppStore((s) => s.captureRequested)
  const setCaptureRequested = useAppStore((s) => s.setCaptureRequested)

  const { tasks, loading: tasksLoading } = useLocalTasks({ projectId: 'inbox' })
  const [moveToDocCapture, setMoveToDocCapture] = useState<Capture | null>(null)

  const [captures, setCaptures] = useState<Capture[]>([])
  const [capturesLoading, setCapturesLoading] = useState(true)
  const [inputValue, setInputValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
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

  // Listen for task changes to also refresh captures
  useEffect(() => {
    const handler = () => refreshCaptures()
    window.addEventListener('tasks-changed', handler)
    return () => window.removeEventListener('tasks-changed', handler)
  }, [refreshCaptures])

  // Auto-focus
  useEffect(() => {
    if (captureRequested) {
      requestAnimationFrame(() => inputRef.current?.focus())
      const timer = setTimeout(() => setCaptureRequested(false), 100)
      return () => clearTimeout(timer)
    }
  }, [captureRequested, setCaptureRequested])

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

    const noteItems: InboxItem[] = captures
      .filter((c) => !c.converted_to_task_id)
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

  // Handlers
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || submitting) return
    setSubmitting(true)
    try {
      const { route, content } = parseRoutePrefix(text, routes)
      if (route && content) {
        // Route to target (doc or task)
        const result = await dp.captureRoutes.route(route.prefix, content)
        if (result.target_type === 'task') {
          emitTasksChanged()
        }
        setInputValue('')
        toast.success(`Saved to ${result.label}`)
        refreshCaptures()
      } else {
        // Default: create a plain capture
        const capture = await dp.captures.create(text, 'inbox')
        setCaptures((prev) => [capture, ...prev])
        setInputValue('')
        toast.success('Note saved')
      }
    } catch (e) {
      toast.error(`Failed: ${e}`)
    } finally {
      setSubmitting(false)
      inputRef.current?.focus()
    }
  }, [inputValue, submitting, routes, refreshCaptures, dp])

  const handleConvert = useCallback(async (capture: Capture) => {
    try {
      const task = await dp.captures.convertToTask(capture.id)
      taskToast(`Converted to task: "${capture.content}"`, task.id)
      emitTasksChanged()
      refreshCaptures()
    } catch (e) {
      toast.error(`Failed to convert: ${e}`)
    }
  }, [refreshCaptures, dp])

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

  return (
    <>
      <PageHeader
        title="Inbox"
        meta={items.length > 0 ? `${items.length} item${items.length !== 1 ? 's' : ''}` : undefined}
        actions={
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground disabled:opacity-50"
            title="Import from Obsidian"
          >
            <Download className="size-3" />
            {importing ? 'Importing…' : 'Import'}
          </button>
        }
      />
      <div className="px-5 py-6 space-y-4 w-full">
      {/* Note input — command bar style */}
      <div className="flex h-10 items-center gap-2 rounded-xl border border-border/30 bg-muted/30 px-3">
        <Search className="size-3.5 shrink-0 text-muted-foreground/30" />
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
          placeholder="Write a note... (/i idea, /q quote, /t task)"
          disabled={submitting}
          className="flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground/40"
        />
        {parsedRoute.route && parsedRoute.content && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-label text-white"
            style={{ backgroundColor: parsedRoute.route.color }}
          >
            <RouteIcon name={parsedRoute.route.icon} className="size-3" />
            {parsedRoute.route.label}
          </span>
        )}
        {inputValue.trim() && (
          <button
            onClick={handleSubmit}
            className="text-meta text-muted-foreground hover:text-foreground transition-colors"
          >
            {submitting ? '...' : 'Save'}
          </button>
        )}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-3 py-4">
          <p className="text-body text-muted-foreground text-center">
            Inbox is empty — nothing to process.
          </p>
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={handleImport} disabled={importing} className="gap-1.5 text-meta">
              <Download className="size-3" />
              {importing ? 'Importing...' : 'Import from Obsidian'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {items.map((item) => {
            return (
              <div
                key={item.kind === 'task' ? `task-${item.data.id}` : `note-${item.data.id}`}
              >
                {item.kind === 'task' ? (
                  <InboxTaskRow
                    task={item.data as LocalTask}
                    isSubtask={item.isSubtask}
                    subtaskStats={item.subtaskStats}
                  />
                ) : (
                  <InboxNoteRow
                    capture={item.data as Capture}
                    onConvert={() => handleConvert(item.data as Capture)}
                    onMoveToDoc={(c) => setMoveToDocCapture(c)}
                  />
                )}
              </div>
            )
          })}

        </div>
      )}

      {/* Move to doc picker */}
      {moveToDocCapture && (
        <MoveToDocPicker
          capture={moveToDocCapture}
          onClose={() => setMoveToDocCapture(null)}
          onDone={refreshCaptures}
        />
      )}
      </div>
    </>
  )
}

// ── Task row ──

function InboxTaskRow({
  task,
  isSubtask,
  subtaskStats,
}: {
  task: LocalTask
  isSubtask?: boolean
  subtaskStats?: { done: number; total: number }
}) {
  const isSelected = useSelectionStore((s) => s.selectedIds.has(task.id))

  return (
    <div className={cn(
      'group flex items-center gap-2 h-9 min-w-0 px-2 rounded-md transition-all duration-150 hover:bg-accent/30',
      isSelected && 'bg-accent-blue/10',
    )}>
      <SelectionCheckbox id={task.id} type="task" />

      <StatusDropdown taskId={task.id} status={task.status ?? 'todo'} />

      {isSubtask && <SubtaskBadge />}

      <button
        onClick={() => useDetailStore.getState().openTask(task.id)}
        className="flex-1 min-w-0 truncate text-body text-left bg-transparent border-none cursor-pointer hover:text-foreground"
      >
        {task.content}
      </button>

      {subtaskStats && subtaskStats.total > 0 && (
        <SubtaskSummary done={subtaskStats.done} total={subtaskStats.total} />
      )}
    </div>
  )
}

// ── Note row ──

function InboxNoteRow({
  capture,
  onConvert,
  onMoveToDoc,
}: {
  capture: Capture
  onConvert: () => void
  onMoveToDoc: (capture: Capture) => void
}) {
  const isSelected = useSelectionStore((s) => s.selectedIds.has(capture.id))

  return (
    <div className={cn(
      'group flex items-center gap-2 h-9 min-w-0 px-2 rounded-md transition-all duration-150 hover:bg-accent/30',
      isSelected && 'bg-accent-blue/10',
    )}>
      <SelectionCheckbox id={capture.id} type="capture" />

      {/* Note icon */}
      <PenLine className="size-4 shrink-0 text-amber-500/60" />

      {/* Content */}
      <button
        onClick={() => useDetailStore.getState().openCapture(capture.id)}
        className="flex-1 min-w-0 truncate text-body text-left bg-transparent border-none cursor-pointer hover:text-foreground"
      >
        {capture.content}
      </button>

      {/* Routed badge */}
      {capture.routed_to && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
          {capture.routed_to}
        </span>
      )}

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => onMoveToDoc(capture)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-label text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/20"
        >
          <FileText className="size-3" />
          Move to doc
        </button>
        <button
          onClick={onConvert}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-label text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/20"
        >
          <ArrowRight className="size-3" />
          Convert to task
        </button>
      </div>
    </div>
  )
}

// ── Move to Doc Picker ──

function MoveToDocPicker({
  capture,
  onClose,
  onDone,
}: {
  capture: Capture
  onClose: () => void
  onDone: () => void
}) {
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
    try {
      await dp.docs.createNote(docId, capture.content)
      await dp.captures.delete(capture.id)
      const doc = docs.find((d) => d.id === docId)
      toast.success(`Moved to "${doc?.title || 'doc'}"`)
      onDone()
      onClose()
    } catch (e) {
      toast.error(`Failed to move: ${e}`)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="w-72 rounded-xl border border-border/30 bg-popover p-3 shadow-xl animate-in fade-in slide-in-from-bottom-3 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-meta text-muted-foreground">Move to doc</span>
          <button onClick={onClose} className="text-muted-foreground/40 hover:text-muted-foreground text-meta">Esc</button>
        </div>

        {/* Folder filter */}
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <button
            onClick={() => setSelectedFolderId(null)}
            className={cn('rounded-md px-2 py-0.5 text-label transition-colors', !selectedFolderId ? 'bg-foreground text-background' : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/20')}
          >
            All
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedFolderId(f.id)}
              className={cn('rounded-md px-2 py-0.5 text-label transition-colors', selectedFolderId === f.id ? 'bg-foreground text-background' : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/20')}
            >
              {f.name}
            </button>
          ))}
        </div>

        {/* Doc list */}
        <div className="max-h-48 overflow-y-auto space-y-0.5 [scrollbar-gutter:stable]">
          {loading ? (
            <p className="text-meta text-muted-foreground/40 py-2 text-center">Loading...</p>
          ) : filteredDocs.length === 0 ? (
            <p className="text-meta text-muted-foreground/40 py-2 text-center">No docs yet</p>
          ) : (
            filteredDocs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => handleSelect(doc.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-accent/20 transition-colors"
              >
                <FileText className="size-3 shrink-0 text-muted-foreground/40" />
                <span className="truncate">{doc.title || 'Untitled'}</span>
              </button>
            ))
          )}
        </div>

        {/* Note preview */}
        <div className="mt-2 pt-2 border-t border-border/20">
          <p className="text-label text-muted-foreground/40 truncate">"{capture.content}"</p>
        </div>
      </div>
    </div>
  )
}
