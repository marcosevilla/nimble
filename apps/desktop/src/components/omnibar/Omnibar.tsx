import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CaptureRoute, LocalTask } from '@nimble/types'
import { cn } from '@/lib/utils'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged, useProjects } from '@/hooks/useLocalTasks'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { useCaptureDate } from '@/hooks/useCaptureDate'
import { useOmnibarResults } from '@/hooks/useOmnibarResults'
import { rememberRowFocus } from '@/hooks/useTaskNavigation'
import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { useDocsStore } from '@/stores/docsStore'
import { useHelpPanelStore } from '@/stores/helpPanelStore'
import { useTasksNavStore } from '@/stores/tasksNavStore'
import { navigateTo } from '@/stores/settingsNavStore'
import { toggleFocusQueue, toggleHabits } from '@/lib/rightRail'
import { hasOpenOverlay } from '@/lib/rowNav'
import { taskToast } from '@/lib/taskToast'
import { parseMode } from '@/lib/commandBarMode'
import { routeWithDate, routedToastMessage } from '@/lib/captureActions'
import { loadRecent, pushRecent, safeStorage } from '@/lib/recentSearches'
import { searchTokens } from '@/lib/taskSearch'
import { acceptSuggestion, removeLastPill, removePill, suggestFilters, type FilterSuggestion, type Pill } from '@/lib/omnibarQuery'
import { matchActions, type OmnibarActionId } from '@/lib/omnibarActions'
import { CREATE_NAME, createKinds, createdMessage, runCreate, type CreateKind } from '@/lib/omnibarCreate'
import { planSearch, type DocHit, type GroupKey } from '@/lib/omnibarSearch'
import {
  buildSections, flattenRows, freshRow, isFetchedRow, moveSelection, OMNIBAR_LISTBOX_ID, optionId, selectedIndex, type OmnibarRow,
} from '@/lib/omnibarRows'
import { DateChip, RouteIcon, RoutePill } from '@/components/capture/CaptureTokens'
import { OmnibarField } from './OmnibarField'
import { OmnibarResults } from './OmnibarResults'
import { BreakdownPanel } from './OmnibarRows'

const CLOSE_MS = 200

function runAction(id: OmnibarActionId): void {
  switch (id) {
    case 'go-today': navigateTo('today'); return
    case 'go-tasks': navigateTo('tasks'); return
    case 'go-inbox': navigateTo('inbox'); return
    case 'go-docs': navigateTo('docs'); return
    case 'go-goals': navigateTo('goals'); return
    case 'go-settings': navigateTo('settings'); return
    case 'go-activity': navigateTo('activity'); return
    case 'toggle-focus': toggleFocusQueue(); return
    case 'toggle-habits': toggleHabits(); return
    case 'shortcuts': useHelpPanelStore.getState().toggle(); return
    case 'refresh': emitTasksChanged(); return
  }
}

/** Native docs open in the editor; vault notes open in the read-only viewer. */
function openDocHit(hit: DocHit): void {
  if (hit.backend === 'native') void useDocsStore.getState().selectDoc(hit.doc.id)
  else void useDocsStore.getState().selectVaultNote(hit.note.path)
  useAppStore.getState().setCurrentPage('docs')
}

/** ⌘K / ⌘F — one bar that searches, filters, creates and runs app actions
 *  (spec 2026-09-25). Mounted once in Dashboard. */
export function Omnibar() {
  const dp = useDataProvider()
  const capability = dp.omnibar
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [rawQuery, setRawQuery] = useState('')
  const [pills, setPills] = useState<Pill[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<GroupKey>>(() => new Set())
  const [recent, setRecent] = useState<string[]>([])
  const [routes, setRoutes] = useState<CaptureRoute[]>([])
  const [breakdownTask, setBreakdownTask] = useState<LocalTask | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownItems, setBreakdownItems] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  // A double Enter must not create twice inside the close window, and a
  // second Enter must not start a second early search.
  const submittingRef = useRef(false)
  const enterPendingRef = useRef(false)

  const { projects } = useProjects()
  const { labels } = useLabelTaxonomy()

  const { mode, query, route } = useMemo(() => parseMode(rawQuery, routes), [rawQuery, routes])
  // A lone '/' shows the route hint instead of results.
  const isBareSlash = rawQuery.trim() === '/'
  const text = isBareSlash ? '' : query.trim()

  const suggestions = useMemo(
    () => (mode === 'search' && !isBareSlash ? suggestFilters(rawQuery, pills, { labels, projects }) : []),
    [mode, isBareSlash, rawQuery, pills, labels, projects],
  )
  const plan = useMemo(() => planSearch({ text, pills, mode, capability }), [text, pills, mode, capability])
  const { results, settled, searchNow } = useOmnibarResults(plan, open)
  const actions = useMemo(() => (plan.groups.includes('actions') ? matchActions(text) : []), [plan, text])
  const creates = useMemo(
    () => createKinds({ text, mode, pills, capability, labelNames: labels.map((l) => l.name) }),
    [text, mode, pills, capability, labels],
  )
  const showRecent = mode === 'search' && text === '' && pills.length === 0
  const sectionBase = useMemo(
    () => ({ suggestions, recent: showRecent ? recent : [], actions, groups: plan.groups, expanded, creates }),
    [suggestions, showRecent, recent, actions, plan, expanded, creates],
  )
  const sections = useMemo(() => buildSections({ ...sectionBase, results }), [sectionBase, results])
  const rows = useMemo(() => flattenRows(sections), [sections])
  const selected = selectedIndex(rows, picked)
  const selectedRow: OmnibarRow | null = selected >= 0 ? rows[selected] : null
  const selectedKey = selectedRow?.key ?? null
  const selectedTask = selectedRow?.kind === 'task' ? selectedRow.hit.task : null

  // Dates parse only where Enter makes a task (decisions 2026-09-23).
  const taskBound =
    !isBareSlash &&
    (mode === 'task' ||
      (mode === 'route' && route?.target_type === 'task') ||
      (selectedRow?.kind === 'create' && selectedRow.create === 'task'))
  const capDate = useCaptureDate(rawQuery, query, taskBound && text !== '')

  const reset = useCallback(() => {
    setRawQuery('')
    setPills([])
    setPicked(null)
    setExpanded(new Set())
    setBreakdownTask(null)
    setBreakdownItems([])
  }, [])

  const openBar = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    reset()
    setOpen(true)
    setClosing(false)
    submittingRef.current = false
    enterPendingRef.current = false
    setRecent(loadRecent(safeStorage()))
    dp.captureRoutes.list().then(setRoutes).catch(() => setRoutes([]))
    requestAnimationFrame(() => {
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [dp, reset])

  /** Escape, ⌘K and the backdrop return focus to where the bar was opened;
   *  opening an item hands focus onward instead. */
  const closeBar = useCallback((restoreFocus = false) => {
    setClosing(true)
    const opener = openerRef.current
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
      reset()
      if (restoreFocus && opener?.isConnected) opener.focus()
    }, CLOSE_MS)
  }, [reset])

  // ⌘K toggles; ⌘F opens (or re-selects the text when open) and, like C4,
  // stays shut while another menu, popover or dialog is up. One instance —
  // the two can never stack.
  useEffect(() => {
    const showing = open && !closing
    function onOpenEvent() {
      if (!showing) openBar()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        if (showing) closeBar(true)
        else openBar()
      } else if (key === 'f') {
        if (showing) {
          e.preventDefault()
          inputRef.current?.select()
          return
        }
        if (hasOpenOverlay()) return
        e.preventDefault()
        openBar()
      }
    }
    window.addEventListener('open-command-bar', onOpenEvent)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('open-command-bar', onOpenEvent)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, closing, openBar, closeBar])

  useEffect(() => {
    if (!open || !selectedKey) return
    document.querySelector('[data-omnibar-row][data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedKey])

  const remember = useCallback(() => {
    if (text) setRecent(pushRecent(safeStorage(), text))
  }, [text])

  const acceptFilter = useCallback((s: FilterSuggestion) => {
    const next = acceptSuggestion({ pills, text: rawQuery }, s)
    setPills(next.pills)
    setRawQuery(next.text)
    setPicked(null)
    setExpanded(new Set())
    inputRef.current?.focus()
  }, [pills, rawQuery])

  const dropPill = useCallback((index: number) => {
    setPills((prev) => removePill({ pills: prev, text: '' }, index).pills)
    setPicked(null)
    inputRef.current?.focus()
  }, [])

  const openTask = useCallback((task: LocalTask) => {
    remember()
    closeBar()
    useDetailStore.getState().openTask(task.id)
  }, [remember, closeBar])

  /** ⌘Enter (kept from C4 ⌘F): the task's project, with its row focused. */
  const openInProject = useCallback((task: LocalTask) => {
    remember()
    closeBar()
    rememberRowFocus(`tasks:project:${task.project_id}`, task.id)
    useDetailStore.getState().close()
    useTasksNavStore.getState().requestProject(task.project_id)
    navigateTo('tasks')
    // Already showing that project? Its list is mounted: focus the row now.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-nav-row="${window.CSS.escape(task.id)}"]`)?.focus()
    })
  }, [remember, closeBar])

  const handleCreate = useCallback(async (kind: CreateKind) => {
    if (!text || submittingRef.current) return
    submittingRef.current = true
    const date = kind === 'task' ? capDate.date : null
    try {
      const created = await runCreate(dp, kind, text, pills, date, capability)
      const message = createdMessage(created, date?.label ?? null)
      if (created.kind === 'task') {
        emitTasksChanged()
        taskToast(message, created.id)
      } else {
        toast.success(message)
      }
      closeBar()
    } catch (e) {
      submittingRef.current = false
      toast.error(`Couldn't create ${CREATE_NAME[kind].toLowerCase()}: ${e}`)
    }
  }, [text, capDate.date, dp, pills, capability, closeBar])

  const handleRoute = useCallback(async () => {
    if (!route || !text || submittingRef.current) return
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
  }, [route, text, capDate.date, dp, closeBar])

  const completeTask = useCallback(async (task: LocalTask) => {
    try {
      await dp.tasks.complete(task.id, task.due_date ?? null)
      emitTasksChanged()
      taskToast(`Completed: "${task.content}"`, task.id)
      closeBar()
    } catch (e) {
      toast.error(`Failed to complete task: ${e}`)
    }
  }, [dp, closeBar])

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
      setBreakdownItems(await dp.ai.breakDownTask(task.content, task.description ?? undefined))
    } catch (e) {
      toast.error(`Breakdown failed: ${e}`)
      setBreakdownTask(null)
    } finally {
      setBreakdownLoading(false)
    }
  }, [dp])

  const handleBreakdownConfirm = useCallback(async () => {
    if (!breakdownTask) return
    let created = 0
    for (const content of breakdownItems.filter(Boolean)) {
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

  const activate = useCallback((row: OmnibarRow) => {
    switch (row.kind) {
      case 'filter':
        acceptFilter(row.suggestion)
        return
      case 'recent':
        setRawQuery(row.query)
        setPicked(null)
        return
      case 'task':
        openTask(row.hit.task)
        return
      case 'note':
        remember()
        closeBar()
        useDetailStore.getState().openCapture(row.capture.id)
        return
      case 'doc':
        remember()
        closeBar()
        openDocHit(row.doc)
        return
      case 'goal':
        remember()
        closeBar()
        useDetailStore.getState().openGoal(row.goal.id)
        return
      case 'action':
        closeBar()
        runAction(row.action.id)
        return
      case 'more':
        setExpanded((prev) => new Set(prev).add(row.group))
        setPicked(row.next)
        return
      case 'create':
        void handleCreate(row.create)
        return
    }
  }, [acceptFilter, openTask, remember, closeBar, handleCreate])

  /** Results on screen belong to an older query (`!settled`): search now and
   *  act on the fresh row with this key — the default row for `null` — and
   *  do nothing if it vanished. Never acts on a stale row (review focus 1). */
  const withFresh = useCallback((key: string | null, act: (row: OmnibarRow) => void) => {
    if (enterPendingRef.current) return
    enterPendingRef.current = true
    void searchNow().then((fresh) => {
      enterPendingRef.current = false
      const row = freshRow(flattenRows(buildSections({ ...sectionBase, results: fresh })), key)
      if (row) act(row)
    })
  }, [searchNow, sectionBase])

  /** Clicks go through the same guard as Enter. */
  const activateClicked = useCallback((row: OmnibarRow) => {
    if (!settled && isFetchedRow(row)) withFresh(row.key, activate)
    else activate(row)
  }, [settled, withFresh, activate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (capDate.onKeyDown(e)) return

    if (breakdownTask && !breakdownLoading) {
      if (e.key === 'Escape') { e.preventDefault(); setBreakdownTask(null); setBreakdownItems([]); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleBreakdownConfirm(); return }
      return
    }

    if (e.key === 'Escape') { e.preventDefault(); closeBar(true); return }

    // Tab accepts the top filter suggestion; focus never leaves the field.
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!e.shiftKey && suggestions.length > 0) acceptFilter(suggestions[0])
      return
    }

    if (e.key === 'Backspace' && rawQuery === '' && pills.length > 0) {
      e.preventDefault()
      setPills(removeLastPill({ pills, text: '' }).pills)
      setPicked(null)
      return
    }

    if (isBareSlash) {
      if (e.key === 'Enter') e.preventDefault()
      return
    }

    if (mode === 'route') {
      if (e.key === 'Enter') { e.preventDefault(); void handleRoute() }
      return
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setPicked(moveSelection(rows, selected, e.key === 'ArrowDown' ? 1 : -1))
      return
    }

    // ⌥C / ⌥B / ⌥M on the highlighted open task. e.code as well as e.key: on
    // macOS they produce ç / ∫ / µ as e.key.
    if (selectedTask && e.altKey && selectedTask.status !== 'complete') {
      const isC = e.key === 'c' || e.code === 'KeyC'
      const isB = e.key === 'b' || e.code === 'KeyB'
      const isM = e.key === 'm' || e.code === 'KeyM'
      if (!settled && (isC || isB || isM)) {
        // Stale row: act on the same task only if the fresh results still hold it.
        e.preventDefault()
        if (isM) return
        withFresh(selectedKey, (row) => {
          if (row.kind !== 'task') return
          if (isC) void completeTask(row.hit.task)
          else void handleBreakDown(row.hit.task)
        })
        return
      }
      if (isC) { e.preventDefault(); void completeTask(selectedTask); return }
      if (isB) { e.preventDefault(); void handleBreakDown(selectedTask); return }
      if (isM) {
        // The move trigger renders only on the highlighted row: exactly one in the DOM.
        e.preventDefault()
        document.querySelector<HTMLElement>('[data-move-trigger]')?.click()
        return
      }
    }

    if (e.key !== 'Enter') return
    e.preventDefault()
    if (selectedTask && (e.metaKey || e.ctrlKey)) { openInProject(selectedTask); return }
    if (!settled && (picked === null || (selectedRow !== null && isFetchedRow(selectedRow)))) {
      // Typed faster than the debounce, or the highlighted result is stale:
      // search now and act on the fresh row for exactly this text — never a
      // stale row (review focus 1).
      withFresh(picked, activate)
      return
    }
    if (selectedRow) activate(selectedRow)
  }, [
    capDate, breakdownTask, breakdownLoading, handleBreakdownConfirm, closeBar, suggestions, acceptFilter,
    rawQuery, pills, isBareSlash, mode, handleRoute, rows, selected, selectedTask, selectedKey, completeTask,
    handleBreakDown, openInProject, settled, picked, withFresh, activate, selectedRow,
  ])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRawQuery(e.target.value)
    setPicked(null)
    setExpanded(new Set())
  }, [])

  if (!open) return null

  const showRoute = !isBareSlash && mode === 'route' && route !== null && text !== ''
  const showList = !isBareSlash && mode !== 'route' && (breakdownTask !== null || sections.length > 0)
  const listboxShown = showList && breakdownTask === null

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn('fixed inset-0 z-40', closing ? 'command-bar-backdrop-out' : 'command-bar-backdrop')}
        onClick={() => closeBar(true)}
      />

      {/* `data-ending-style` while fading out: hasOpenOverlay() then ignores
          this bar, so ⌘F right after Escape reopens it. */}
      <div
        role="dialog"
        aria-label="Command bar"
        data-ending-style={closing || undefined}
        className={cn('fixed inset-x-0 top-[28%] z-50 mx-auto w-full max-w-xl px-4', closing ? 'command-bar-flyout-out' : 'command-bar-flyout')}
      >
        <OmnibarField
          pills={pills}
          value={rawQuery}
          highlight={capDate.highlight}
          inputRef={inputRef}
          listboxId={listboxShown ? OMNIBAR_LISTBOX_ID : null}
          activeOptionId={listboxShown && selected >= 0 ? optionId(selected) : null}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onRemovePill={dropPill}
          trailing={
            <>
              {mode === 'route' && route && <RoutePill route={route} />}
              {capDate.date && mode !== 'search' && <DateChip label={capDate.date.label} compact />}
            </>
          }
        />

        {isBareSlash && (
          <div className="mt-1 animate-in fade-in slide-in-from-top-1 duration-(--transition-fast)">
            <div className="overflow-hidden rounded-xl border border-border/50 bg-popover shadow-lg">
              <div className="px-2 py-1.5 text-meta text-muted-foreground">
                {[...routes.map((r) => `${r.prefix} ${r.label}`), '/task', '/note', '/doc'].join(' · ')}
              </div>
            </div>
          </div>
        )}

        {showRoute && route && (
          <div className="mt-1 animate-in fade-in slide-in-from-top-1 duration-(--transition-fast)">
            <div className="overflow-hidden rounded-xl border border-border/50 bg-popover shadow-lg">
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => void handleRoute()}
                  className="flex w-full items-center gap-2 rounded-md bg-hover px-2 py-1.5 text-left text-body"
                >
                  <RouteIcon name={route.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Save to {route.label}</span>
                  <span className="min-w-0 flex-1 truncate text-body-strong">"{capDate.date ? capDate.date.title : text}"</span>
                  <kbd className="rounded-sm bg-muted px-1 py-0.5 text-label text-muted-foreground">Enter</kbd>
                </button>
              </div>
            </div>
          </div>
        )}

        {showList && (
          <div className="mt-1 animate-in fade-in slide-in-from-top-1 duration-(--transition-fast)">
            {breakdownTask ? (
              <BreakdownPanel
                task={breakdownTask}
                loading={breakdownLoading}
                items={breakdownItems}
                onEdit={(i, v) => setBreakdownItems((prev) => prev.map((item, idx) => (idx === i ? v : item)))}
                onRemove={(i) => setBreakdownItems((prev) => prev.filter((_, idx) => idx !== i))}
                onConfirm={() => void handleBreakdownConfirm()}
                onCancel={() => { setBreakdownTask(null); setBreakdownItems([]) }}
              />
            ) : (
              <OmnibarResults
                sections={sections}
                selectedKey={selectedKey}
                busy={!settled}
                tokens={searchTokens(text)}
                projects={projects}
                createText={text}
                createTaskTitle={capDate.date?.title ?? text}
                createDateLabel={capDate.date?.label ?? null}
                onHover={setPicked}
                onActivate={activateClicked}
                onComplete={(task) => void completeTask(task)}
                onBreakDown={(task) => void handleBreakDown(task)}
                onMove={(task, projectId) => void handleMove(task.id, projectId)}
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}
