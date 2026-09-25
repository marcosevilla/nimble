import { useDataVersion } from '@/hooks/useDataVersion'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { Icon } from '@/components/shared/Icon'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { useDocsStore } from '@/stores/docsStore'
import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { CommandBarResults } from './CommandBarResults'
import { toast } from 'sonner'
import { taskToast } from '@/lib/taskToast'
import { parseMode, searchHandoff } from '@/lib/commandBarMode'
import { useTaskSearchStore } from '@/stores/taskSearchStore'
import { routeWithDate, routedToastMessage } from '@/lib/captureActions'
import { HighlightField } from '@/components/capture/HighlightField'
import { RoutePill, DateChip, RouteIcon } from '@/components/capture/CaptureTokens'
import { useCaptureDate } from '@/hooks/useCaptureDate'
import type { LocalTask, Document, Capture, CaptureRoute } from '@nimble/types'

const MAX_RESULTS = 8

const ACTION_VERBS = new Set([
  'buy', 'send', 'call', 'fix', 'do', 'make', 'write', 'schedule',
  'check', 'review', 'update', 'finish', 'create', 'build', 'clean',
  'read', 'watch', 'book', 'plan', 'prepare', 'set', 'get', 'move',
])

const CAPTURE_PREFIXES = ['note:', 'idea:', 'remember']

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
  const captureVersion = useDataVersion('captures')
  const dp = useDataProvider()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [rawQuery, setRawQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // Breakdown state
  const [breakdownTask, setBreakdownTask] = useState<LocalTask | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownItems, setBreakdownItems] = useState<string[]>([])

  const { tasks, addTask, complete, refresh } = useLocalTasks()
  const { projects } = useProjects()
  const [docResults, setDocResults] = useState<Document[]>([])
  const [captureResults, setCaptureResults] = useState<Capture[]>([])
  const [routes, setRoutes] = useState<CaptureRoute[]>([])

  const { mode, query, route } = useMemo(() => parseMode(rawQuery, routes), [rawQuery, routes])
  // A lone '/' never shows its placeholder (the field already has a value),
  // so it gets its own hint row instead of running through search mode.
  const isBareSlash = rawQuery.trim() === '/'

  const filteredTasks = useMemo(() => {
    if (!query.trim() || mode === 'doc' || mode === 'route') return []
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
  }, [query, mode, dp, captureVersion])

  // Result index layout: tasks, docs, captures, then the two create actions
  const docStartIndex = filteredTasks.length
  const captureStartIndex = docStartIndex + docResults.length
  const createIndex = captureStartIndex + captureResults.length
  const captureActionIndex = createIndex + 1
  const totalItems = captureActionIndex + 1

  // Dates parse only where Enter makes a task (decisions 2026-09-23).
  const taskBound =
    !isBareSlash &&
    (mode === 'task' ||
      (mode === 'route' && route?.target_type === 'task') ||
      (mode === 'search' && selectedIndex === createIndex))
  const capDate = useCaptureDate(rawQuery, query, taskBound && query.trim() !== '')

  // Guards a double Enter (route/create) from firing twice inside closeBar's
  // 200ms close window — reset whenever the bar reopens.
  const submittingRef = useRef(false)

  // Open/close
  const openBar = useCallback((opener?: HTMLElement | null) => {
    openerRef.current = opener !== undefined ? opener : document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
    submittingRef.current = false
    refresh()
    dp.captureRoutes.list().then(setRoutes).catch(() => setRoutes([]))
    requestAnimationFrame(() => {
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [refresh, dp])

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

  // `/search ` belongs to ⌘F now (C4): close at once (no fade — two dialogs
  // must never overlap) and open search with the text, focus returning to
  // whatever ⌘K was opened from.
  const handOffToSearch = useCallback((q: string) => {
    setOpen(false)
    setClosing(false)
    setRawQuery('')
    setSelectedIndex(0)
    setBreakdownTask(null)
    setBreakdownItems([])
    useTaskSearchStore.getState().openSearch(q, openerRef.current)
  }, [])

  // Listen for open events (from nav icon + Cmd+K)
  useEffect(() => {
    function handleOpen() { openBar() }
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) closeBar()
        else if (useTaskSearchStore.getState().open) {
          // Never stack ⌘K on ⌘F: search closes (carrying nothing over) and
          // ⌘K opens with search's own opener as the place to return to.
          openBar(useTaskSearchStore.getState().closeForHandoff())
        } else openBar()
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
    if (!text || submittingRef.current) return
    submittingRef.current = true
    const date = capDate.date
    const task = await addTask(date ? date.title : text, date ? { dueDate: date.dueDate, dueTime: date.dueTime ?? undefined } : undefined)
    if (task) {
      taskToast(date ? `Task created: "${date.title}" · due ${date.label}` : `Task created: "${text}"`, task.id)
      closeBar()
    } else {
      submittingRef.current = false
    }
  }, [query, addTask, closeBar, capDate.date])

  const handleRoute = useCallback(async () => {
    if (!route || submittingRef.current) return
    const text = query.trim()
    if (!text) return
    submittingRef.current = true
    try {
      const date = route.target_type === 'task' ? capDate.date : null
      const { result, dateSet, dateFailed } = await routeWithDate(dp, route, text, date)
      if (result.target_type === 'task') emitTasksChanged()
      const msg = routedToastMessage(result.label, { dateSet, dateFailed }, date)
      if (msg.kind === 'success') toast.success(msg.text)
      else toast(msg.text)
      closeBar()
    } catch (e) {
      submittingRef.current = false
      toast.error(`Couldn't save to ${route.label}: ${e}`)
    }
  }, [route, query, capDate.date, dp, closeBar])

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
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (capDate.onKeyDown(e)) return

      if (breakdownTask && !breakdownLoading) {
        if (e.key === 'Escape') { e.preventDefault(); setBreakdownTask(null); setBreakdownItems([]); return }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleBreakdownConfirm(); return }
        return
      }

      if (e.key === 'Escape') { e.preventDefault(); closeBar(); return }

      // A lone '/' shows the route hint row instead of a results list —
      // nothing here to select or submit.
      if (isBareSlash) {
        if (e.key === 'Enter') e.preventDefault()
        return
      }

      if (!query.trim()) {
        if (e.key === 'Enter') e.preventDefault()
        return
      }

      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((prev) => (prev + 1) % totalItems); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems); return }

      // Action shortcuts (Option + key)
      // e.code as well as e.key: on macOS ⌥C / ⌥B / ⌥M produce ç / ∫ / µ as
      // e.key, which is why the letter checks alone never fired in the webview.
      if (selectedIndex < filteredTasks.length && e.altKey) {
        const task = filteredTasks[selectedIndex]
        if (e.key === 'c' || e.code === 'KeyC') { e.preventDefault(); handleComplete(task.id); return }
        if (e.key === 'b' || e.code === 'KeyB') { e.preventDefault(); handleBreakDown(task); return }
        if (e.key === 'm' || e.code === 'KeyM') {
          // Open the selected row's move menu — the trigger only renders on
          // the selected row, so there is exactly one in the DOM.
          e.preventDefault()
          document.querySelector<HTMLElement>('[data-move-trigger]')?.click()
          return
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (mode === 'route') { handleRoute(); return }
        if (mode === 'capture') { handleCapture(); return }
        if (mode === 'task') { handleCreateTask(); return }
        if (selectedIndex < filteredTasks.length) handleComplete(filteredTasks[selectedIndex].id)
        else if (selectedIndex < captureStartIndex) handleOpenDoc(docResults[selectedIndex - docStartIndex].id)
        else if (selectedIndex < createIndex) handleOpenCapture(captureResults[selectedIndex - captureStartIndex].id)
        else if (selectedIndex === createIndex) handleCreateTask()
        else if (selectedIndex === captureActionIndex) handleCapture()
      }
    },
    [query, mode, totalItems, selectedIndex, filteredTasks, docResults, captureResults, docStartIndex, captureStartIndex, createIndex, captureActionIndex, breakdownTask, breakdownLoading, capDate, isBareSlash, handleComplete, handleBreakDown, handleBreakdownConfirm, handleCreateTask, handleRoute, handleCapture, handleOpenDoc, handleOpenCapture, closeBar],
  )

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const handoff = searchHandoff(e.target.value)
    if (handoff !== null) {
      handOffToSearch(handoff)
      return
    }
    setRawQuery(e.target.value)
    const { mode: m, query: q } = parseMode(e.target.value, routes)
    const q2 = q.trim()
    if (q2) {
      // Route mode has no search results — there is nothing to match against.
      const matches = m === 'route' ? [] : tasks.filter((t) => !t.completed && t.content.toLowerCase().includes(q2.toLowerCase())).slice(0, MAX_RESULTS)
      if (m === 'task' || m === 'route') setSelectedIndex(matches.length)
      else if (m === 'capture') setSelectedIndex(matches.length + 1)
      else setSelectedIndex(inferDefaultIndex(q2, matches.length))
    } else {
      setSelectedIndex(0)
    }
  }, [tasks, routes, handOffToSearch])

  if (!open) return null

  let placeholder = 'What do you need?'
  if (rawQuery.startsWith('/task ')) placeholder = 'Create a task...'
  else if (rawQuery.startsWith('/capture ') || rawQuery.startsWith('/note ')) placeholder = 'Save a note...'
  else if (rawQuery.startsWith('/doc ')) placeholder = 'Search docs...'
  else if (rawQuery.startsWith('/search ')) placeholder = 'Search tasks...'

  const showResults = query.trim().length > 0

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn('fixed inset-0 z-40', closing ? 'command-bar-backdrop-out' : 'command-bar-backdrop')}
        onClick={closeBar}
      />

      {/* Centered command bar */}
      <div role="dialog" aria-label="Command bar" className={cn('fixed inset-x-0 top-[28%] z-50 mx-auto w-full max-w-lg px-4', closing ? 'command-bar-flyout-out' : 'command-bar-flyout')}>
        <div className="flex h-11 items-center gap-2 px-4 rounded-xl border border-border/50 bg-popover shadow-lg shadow-black/10">
          <Icon icon={Search} className="text-muted-foreground" />
          <HighlightField
            fieldRef={inputRef}
            type="text"
            value={rawQuery}
            highlight={capDate.highlight}
            wrapperClassName="flex-1"
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="text-body outline-none placeholder:text-muted-foreground"
          />
          {mode === 'route' && route && <RoutePill route={route} />}
          {capDate.date && mode !== 'search' && <DateChip label={capDate.date.label} compact />}
          <kbd className="rounded-sm border border-border/30 px-1.5 py-0.5 text-label font-mono text-muted-foreground">
            Esc
          </kbd>
        </div>

        {showResults && isBareSlash && (
          <div className="mt-1">
            <div className="animate-in fade-in slide-in-from-top-1 duration-(--transition-fast)">
              <div className="rounded-xl border border-border/50 bg-popover shadow-lg overflow-hidden">
                <div className="px-2 py-1.5 text-meta text-muted-foreground">
                  {[...routes.map((r) => `${r.prefix} ${r.label}`), '/task', '/doc', '/search'].join(' · ')}
                </div>
              </div>
            </div>
          </div>
        )}

        {showResults && !isBareSlash && mode === 'route' && route && (
          <div className="mt-1">
            <div className="animate-in fade-in slide-in-from-top-1 duration-(--transition-fast)">
              <div className="rounded-xl border border-border/50 bg-popover shadow-lg overflow-hidden">
                <div className="p-1">
                  <button
                    type="button"
                    onClick={handleRoute}
                    className="flex w-full items-center gap-2 rounded-md bg-hover px-2 py-1.5 text-left text-body"
                  >
                    <RouteIcon name={route.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Save to {route.label}</span>
                    <span className="min-w-0 flex-1 truncate text-body-strong">"{capDate.date ? capDate.date.title : query.trim()}"</span>
                    <kbd className="rounded-sm bg-muted px-1 py-0.5 text-label text-muted-foreground">Enter</kbd>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showResults && !isBareSlash && mode !== 'route' && (
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
              createTitle={capDate.date?.title}
              createDate={mode === 'search' ? capDate.date : null}
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
