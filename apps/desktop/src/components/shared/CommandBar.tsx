import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { useDocsStore } from '@/stores/docsStore'
import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { CommandBarResults, type BarMode } from './CommandBarResults'
import { toast } from 'sonner'
import { taskToast } from '@/lib/taskToast'
import type { LocalTask, Document, Capture } from '@daily-triage/types'

const MAX_RESULTS = 8

const ACTION_VERBS = new Set([
  'buy', 'send', 'call', 'fix', 'do', 'make', 'write', 'schedule',
  'check', 'review', 'update', 'finish', 'create', 'build', 'clean',
  'read', 'watch', 'book', 'plan', 'prepare', 'set', 'get', 'move',
])

const CAPTURE_PREFIXES = ['note:', 'idea:', 'remember']

function parseMode(raw: string): { mode: BarMode; query: string } {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('/task ')) return { mode: 'task', query: trimmed.slice(6) }
  if (trimmed.startsWith('/capture ')) return { mode: 'capture', query: trimmed.slice(9) }
  if (trimmed.startsWith('/note ')) return { mode: 'capture', query: trimmed.slice(6) }
  if (trimmed.startsWith('/doc ')) return { mode: 'doc', query: trimmed.slice(5) }
  if (trimmed.startsWith('/search ')) return { mode: 'search', query: trimmed.slice(8) }
  return { mode: 'search', query: trimmed }
}

function inferDefaultIndex(query: string, matchCount: number): number {
  const createIndex = matchCount
  const q = query.toLowerCase().trim()
  for (const prefix of CAPTURE_PREFIXES) {
    if (q.startsWith(prefix)) return matchCount + 1
  }
  const firstWord = q.split(/\s+/)[0]
  if (firstWord && ACTION_VERBS.has(firstWord)) return createIndex
  return matchCount > 0 ? 0 : createIndex
}

export function CommandBar() {
  const dp = useDataProvider()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [rawQuery, setRawQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Breakdown state
  const [breakdownTask, setBreakdownTask] = useState<LocalTask | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownItems, setBreakdownItems] = useState<string[]>([])

  const { tasks, addTask, complete, refresh } = useLocalTasks()
  const { projects } = useProjects()
  const [docResults, setDocResults] = useState<Document[]>([])
  const [captureResults, setCaptureResults] = useState<Capture[]>([])

  const { mode, query } = useMemo(() => parseMode(rawQuery), [rawQuery])

  const filteredTasks = useMemo(() => {
    if (!query.trim() || mode === 'doc') return []
    const q = query.toLowerCase()
    return tasks
      .filter((t) => !t.completed && t.content.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS)
  }, [query, tasks, mode])

  // Search docs when query changes
  useEffect(() => {
    if (!query.trim() || (mode !== 'search' && mode !== 'doc')) {
      setDocResults([])
      return
    }
    const timeout = setTimeout(() => {
      dp.docs.searchDocuments(query.trim()).then((docs) => setDocResults(docs.slice(0, 5))).catch(() => setDocResults([]))
    }, 200)
    return () => clearTimeout(timeout)
  }, [query, mode, dp])

  // Search captures when query changes (client-side filter — no search backend)
  useEffect(() => {
    if (!query.trim() || mode !== 'search') {
      setCaptureResults([])
      return
    }
    const timeout = setTimeout(() => {
      const q = query.trim().toLowerCase()
      dp.captures.list(200, false)
        .then((caps) => setCaptureResults(caps.filter((c) => c.content.toLowerCase().includes(q)).slice(0, 5)))
        .catch(() => setCaptureResults([]))
    }, 200)
    return () => clearTimeout(timeout)
  }, [query, mode, dp])

  // Result index layout: tasks, docs, captures, then the two create actions
  const docStartIndex = filteredTasks.length
  const captureStartIndex = docStartIndex + docResults.length
  const createIndex = captureStartIndex + captureResults.length
  const captureActionIndex = createIndex + 1
  const totalItems = captureActionIndex + 1

  // Open/close
  const openBar = useCallback(() => {
    setOpen(true)
    refresh()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [refresh])

  const closeBar = useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      setOpen(false)
      setClosing(false)
      setRawQuery('')
      setSelectedIndex(0)
      setBreakdownTask(null)
      setBreakdownItems([])
    }, 200)
  }, [])

  // Listen for open events (from nav icon + Cmd+K)
  useEffect(() => {
    function handleOpen() { openBar() }
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) closeBar()
        else openBar()
      }
    }
    window.addEventListener('open-command-bar', handleOpen)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('open-command-bar', handleOpen)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, openBar, closeBar])

  const handleCreateTask = useCallback(async () => {
    const text = query.trim()
    if (!text) return
    const task = await addTask(text)
    if (task) {
      taskToast(`Task created: "${text}"`, task.id)
      closeBar()
    }
  }, [query, addTask, closeBar])

  const handleCapture = useCallback(async () => {
    const text = query.trim()
    if (!text) return
    try {
      await dp.captures.create(text, 'command_bar')
      toast.success(`Note saved: "${text}"`)
      closeBar()
    } catch (e) {
      toast.error(`Failed to save note: ${e}`)
    }
  }, [query, closeBar, dp])

  const handleOpenDoc = useCallback((docId: string) => {
    useDocsStore.getState().selectDoc(docId)
    useAppStore.getState().setCurrentPage('docs')
    closeBar()
  }, [closeBar])

  const handleOpenCapture = useCallback((captureId: string) => {
    useDetailStore.getState().openCapture(captureId)
    closeBar()
  }, [closeBar])

  const handleComplete = useCallback(async (id: string) => {
    const task = tasks.find((t) => t.id === id)
    await complete(id)
    if (task) taskToast(`Completed: "${task.content}"`, task.id)
    closeBar()
  }, [tasks, complete, closeBar])

  const handleMove = useCallback(async (id: string, projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    try {
      await dp.tasks.update({ id, projectId })
      taskToast(`Moved to ${project?.name ?? 'project'}`, id)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to move: ${e}`)
    }
  }, [projects, dp])

  const handleBreakDown = useCallback(async (task: LocalTask) => {
    setBreakdownTask(task)
    setBreakdownLoading(true)
    try {
      const subtasks = await dp.ai.breakDownTask(task.content, task.description ?? undefined)
      setBreakdownItems(subtasks)
    } catch (e) {
      toast.error(`Breakdown failed: ${e}`)
      setBreakdownTask(null)
    } finally {
      setBreakdownLoading(false)
    }
  }, [dp])

  const handleBreakdownConfirm = useCallback(async () => {
    if (!breakdownTask) return
    const items = breakdownItems.filter(Boolean)
    let created = 0
    for (const content of items) {
      try {
        await dp.tasks.create({ content, parentId: breakdownTask.id, projectId: breakdownTask.project_id })
        created++
      } catch { /* skip */ }
    }
    dp.activity.log('task_breakdown_applied', breakdownTask.id, { subtask_count: created }).catch(() => {})
    taskToast(`Created ${created} subtasks`, breakdownTask.id)
    emitTasksChanged()
    closeBar()
  }, [breakdownTask, breakdownItems, closeBar, dp])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (breakdownTask && !breakdownLoading) {
        if (e.key === 'Escape') { e.preventDefault(); setBreakdownTask(null); setBreakdownItems([]); return }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleBreakdownConfirm(); return }
        return
      }

      if (e.key === 'Escape') { e.preventDefault(); closeBar(); return }

      if (!query.trim()) {
        if (e.key === 'Enter') e.preventDefault()
        return
      }

      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((prev) => (prev + 1) % totalItems); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems); return }

      // Action shortcuts (Option + key)
      if (selectedIndex < filteredTasks.length && e.altKey) {
        const task = filteredTasks[selectedIndex]
        if (e.key === 'c') { e.preventDefault(); handleComplete(task.id); return }
        if (e.key === 'b') { e.preventDefault(); handleBreakDown(task); return }
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (mode === 'capture') { handleCapture(); return }
        if (mode === 'task') { handleCreateTask(); return }
        if (selectedIndex < filteredTasks.length) handleComplete(filteredTasks[selectedIndex].id)
        else if (selectedIndex < captureStartIndex) handleOpenDoc(docResults[selectedIndex - docStartIndex].id)
        else if (selectedIndex < createIndex) handleOpenCapture(captureResults[selectedIndex - captureStartIndex].id)
        else if (selectedIndex === createIndex) handleCreateTask()
        else if (selectedIndex === captureActionIndex) handleCapture()
      }
    },
    [query, mode, totalItems, selectedIndex, filteredTasks, docResults, captureResults, docStartIndex, captureStartIndex, createIndex, captureActionIndex, breakdownTask, breakdownLoading, handleComplete, handleBreakDown, handleBreakdownConfirm, handleCreateTask, handleCapture, handleOpenDoc, handleOpenCapture, closeBar],
  )

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRawQuery(e.target.value)
    const { mode: m, query: q } = parseMode(e.target.value)
    const q2 = q.trim()
    if (q2) {
      const matches = tasks.filter((t) => !t.completed && t.content.toLowerCase().includes(q2.toLowerCase())).slice(0, MAX_RESULTS)
      if (m === 'task') setSelectedIndex(matches.length)
      else if (m === 'capture') setSelectedIndex(matches.length + 1)
      else setSelectedIndex(inferDefaultIndex(q2, matches.length))
    } else {
      setSelectedIndex(0)
    }
  }, [tasks])

  if (!open) return null

  let placeholder = 'What do you need?'
  if (rawQuery.startsWith('/task ')) placeholder = 'Create a task...'
  else if (rawQuery.startsWith('/capture ') || rawQuery.startsWith('/note ')) placeholder = 'Save a note...'
  else if (rawQuery.startsWith('/doc ')) placeholder = 'Search docs...'
  else if (rawQuery.startsWith('/search ')) placeholder = 'Search tasks...'
  else if (rawQuery === '/') placeholder = 'task, capture, doc, search...'

  const showResults = query.trim().length > 0

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn('fixed inset-0 z-40', closing ? 'command-bar-backdrop-out' : 'command-bar-backdrop')}
        onClick={closeBar}
      />

      {/* Centered command bar */}
      <div className={cn('fixed inset-x-0 top-[28%] z-50 mx-auto w-full max-w-lg px-4', closing ? 'command-bar-flyout-out' : 'command-bar-flyout')}>
        <div className="flex h-11 items-center gap-2 px-4 rounded-xl border border-border/50 bg-popover shadow-lg shadow-black/10">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={rawQuery}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border/30 px-1.5 py-0.5 text-label font-mono text-muted-foreground">
            Esc
          </kbd>
        </div>

        {showResults && (
          <div className="mt-1">
            <CommandBarResults
              query={query.trim()}
              mode={mode}
              tasks={filteredTasks}
              docResults={docResults}
              captureResults={captureResults}
              projects={projects}
              selectedIndex={selectedIndex}
              onComplete={handleComplete}
              onMove={handleMove}
              onBreakDown={handleBreakDown}
              onOpenDoc={handleOpenDoc}
              onOpenCapture={handleOpenCapture}
              onCreateTask={handleCreateTask}
              onCapture={handleCapture}
              onSelect={setSelectedIndex}
              breakdownTask={breakdownTask}
              breakdownLoading={breakdownLoading}
              breakdownItems={breakdownItems}
              onBreakdownEdit={(i, v) => setBreakdownItems((prev) => prev.map((item, idx) => idx === i ? v : item))}
              onBreakdownRemove={(i) => setBreakdownItems((prev) => prev.filter((_, idx) => idx !== i))}
              onBreakdownConfirm={handleBreakdownConfirm}
              onBreakdownCancel={() => { setBreakdownTask(null); setBreakdownItems([]) }}
            />
          </div>
        )}
      </div>
    </>
  )
}
