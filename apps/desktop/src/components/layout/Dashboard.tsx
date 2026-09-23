import { useEffect, useLayoutEffect, useRef } from 'react'
// Window-to-window event bus, not data access — the web build aliases
// '@tauri-apps/api/event' to a no-op stub (src/platform/), so this stays
// portable. Not part of the DataProvider seam.
// eslint-disable-next-line no-restricted-imports
import { listen } from '@tauri-apps/api/event'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAppStore } from '@/stores/appStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { NavSidebar } from './NavSidebar'
import { RightSidebar } from './RightSidebar'
import { CommandBar } from '@/components/shared/CommandBar'
import { HelpPanel } from '@/components/shared/HelpPanel'
import { useHelpPanelStore } from '@/stores/helpPanelStore'
import { G_PREFIX_PAGES, G_PREFIX_TIMEOUT_MS, isHabitsShortcut, isModifierOnlyKey } from '@/lib/shortcuts'
import { BulkActionBar } from '@/components/shared/BulkActionBar'
import { useSelectionStore } from '@/stores/selectionStore'
import { QuickCreateDialog } from '@/components/tasks/QuickCreateDialog'
import { useQuickCreateStore } from '@/stores/quickCreateStore'
import { TodayPage } from '@/components/pages/TodayPage'
import { TasksPage } from '@/components/pages/TasksPage'
import { InboxPage } from '@/components/pages/InboxPage'
import { SessionPage } from '@/components/pages/SessionPage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { DocsPage } from '@/components/pages/DocsPage'
import { GoalsPage } from '@/components/pages/GoalsPage'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { connectFocusCache, focusSpaceAction, isDroppedRepeat, sendFocusAction, useFocusCache } from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import { isFocusTrayShortcut } from '@/lib/focusFlows'
import { pageHidesRightRail, toggleFocusQueue, toggleHabits } from '@/lib/rightRail'
import { FocusView } from '@/components/focus/FocusView'
import { FocusBanner } from '@/components/focus/FocusBanner'
import { FocusResumeDialog } from '@/components/focus/FocusResumeDialog'
import { SyncHealthBanner } from '@/components/shared/SyncHealthBanner'
import { useDetailStore } from '@/stores/detailStore'
import { TaskDetailPage } from '@/components/detail/TaskDetailPage'
import { CaptureDetailPage } from '@/components/detail/CaptureDetailPage'
import { GoalDetailPage } from '@/components/detail/GoalDetailPage'
import { DetailSidebar } from '@/components/detail/DetailSidebar'

// Page titles live on each page's own <PageHeader> now. No central map.
// PAGES is no longer hardcoded — keyboard shortcuts read from layoutStore.navOrder

function PageContent({ page }: { page: string }) {
  switch (page) {
    case 'today':
      return <TodayPage />
    case 'tasks':
      return <TasksPage />
    case 'inbox':
      return <InboxPage />
    case 'docs':
      return <DocsPage />
    case 'goals':
      return <GoalsPage />
    case 'session':
      return <SessionPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <TodayPage />
  }
}

export function Dashboard() {
  const currentPage = useAppStore((s) => s.currentPage)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)

  // Load nav order from SQLite on mount
  const loadNavOrder = useLayoutStore((s) => s.loadNavOrder)
  useEffect(() => {
    loadNavOrder()
  }, [loadNavOrder])

  // Focus: a render cache of the engine's snapshots. Subscribes before the
  // first read; no interval or clock runs here.
  useEffect(() => connectFocusCache(), [])
  const focusQueued = useFocusCache((s) => (s.snapshot?.queue.length ?? 0) > 0)
  const focusExpanded = useFocusSurface((s) => s.expanded)

  // Detail view
  const detailTarget = useDetailStore((s) => s.target)
  const detailMode = useDetailStore((s) => s.mode)
  const closeDetail = useDetailStore((s) => s.close)

  const setCaptureRequested = useAppStore((s) => s.setCaptureRequested)

  // Scroll position restoration
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef<Record<string, number>>({})
  const previousPageRef = useRef(currentPage)

  // Clear selection and sync detail store on page change.
  // useLayoutEffect so scroll restoration runs before the browser paints
  // the new page — otherwise the entrance animation competes with a
  // post-paint scrollTop set and the final frame jumps.
  useLayoutEffect(() => {
    useSelectionStore.getState().clear()

    // Changing page while a session is expanded collapses it to the banner
    // instead of leaving the timer over a page the nav says has changed
    // (session P2-1, §2.4 "doesn't lock navigation").
    const surface = useFocusSurface.getState()
    if (surface.expanded && previousPageRef.current !== currentPage) {
      surface.setExpanded(false)
    }

    if (scrollRef.current && previousPageRef.current !== currentPage) {
      scrollPositions.current[previousPageRef.current] = scrollRef.current.scrollTop
    }

    useDetailStore.getState().syncToPage(currentPage)

    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollPositions.current[currentPage] ?? 0
    }

    previousPageRef.current = currentPage
  }, [currentPage])

  // Listen for tray "Quick Capture" event
  useEffect(() => {
    const unlisten = listen('open-quick-capture', () => {
      setCurrentPage('inbox')
      setCaptureRequested(true)
    })
    return () => { unlisten.then(fn => fn()) }
  }, [setCurrentPage, setCaptureRequested])

  // The focus companion's "Open details": Rust shows this window and sends
  // only the task ID; the detail page reads the task itself.
  useEffect(() => {
    const unlisten = listen<{ version?: number; task_id?: unknown }>('nimble-focus-open-task', ({ payload }) => {
      if (payload?.version !== 1 || typeof payload.task_id !== 'string') return
      useFocusSurface.getState().setExpanded(false)
      useDetailStore.getState().openTask(payload.task_id)
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      // ? — toggle the keyboard-shortcuts panel (shell P1-1, §1.5)
      if (e.key === '?' && !isInput && !meta && !e.altKey) {
        e.preventDefault()
        useHelpPanelStore.getState().toggle()
        return
      }

      // Cmd+, — open settings
      if (meta && e.key === ',') {
        e.preventDefault()
        setCurrentPage('settings')
        return
      }

      // Cmd+R — refresh all data
      if (meta && e.key === 'r') {
        e.preventDefault()
        emitTasksChanged()
        return
      }

      // Cmd+A — select all (handled by individual pages, but prevent default browser behavior)
      // Escape — clear selection (if any selected, before closing detail)
      if (e.key === 'Escape' && !isInput && useSelectionStore.getState().hasSelection) {
        e.preventDefault()
        useSelectionStore.getState().clear()
        return
      }


      // Escape — close detail view (when not in input)
      if (e.key === 'Escape' && !isInput && detailTarget) {
        e.preventDefault()
        closeDetail()
        return
      }

      // ⇧F — open/close the focus queue in the right column (presentation
      // only; works with an empty queue)
      if (!isInput && isFocusTrayShortcut(e)) {
        e.preventDefault()
        toggleFocusQueue()
        return
      }

      // ⇧H — open/close habits in the right column (re-score goals N-P1-1)
      if (!isInput && isHabitsShortcut(e)) {
        e.preventDefault()
        toggleHabits()
        return
      }

      // Space — pause a running focus session (never starts or resumes one)
      const spaceAction = e.key === ' ' && !isInput && !meta ? focusSpaceAction() : null
      if (spaceAction) {
        e.preventDefault()
        if (!e.repeat) {
          sendFocusAction(spaceAction).catch((error: unknown) => {
            if (!isDroppedRepeat(error)) toast(error instanceof Error ? error.message : String(error))
          })
        }
        return
      }

      // Q — open quick create dialog (only when not typing in an input)
      if (e.key === 'q' && !isInput && !meta) {
        e.preventDefault()
        useQuickCreateStore.getState().openCreate()
        return
      }

      // Number keys for navigation — follows user's custom nav order
      const pages = useLayoutStore.getState().navOrder
      if (!isInput) {
        const num = parseInt(e.key, 10)
        if (num >= 1 && num <= pages.length) {
          e.preventDefault()
          setCurrentPage(pages[num - 1] as typeof currentPage)
          return
        }
      }

      // Cmd+1-6 for navigation (works even in inputs)
      if (meta && e.key >= '1' && e.key <= String(pages.length)) {
        e.preventDefault()
        const idx = parseInt(e.key, 10) - 1
        if (idx < pages.length) setCurrentPage(pages[idx] as typeof currentPage)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCurrentPage, detailTarget, closeDetail])

  // G-prefix navigation (§1.5, shell P1-5): `g` then t/k/i/d/g/s/, within
  // 600ms. Registered in the capture phase so the second key never reaches
  // the page-level handlers (`k` = previous task, `s` = snooze, `t` =
  // calendar today). Number keys and ⌘1–6 are untouched — this is additive.
  const pendingGRef = useRef<number | null>(null)
  useEffect(() => {
    function handleChord(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (isInput || e.metaKey || e.ctrlKey || e.altKey) return
      // Reaching for Shift (or any modifier) must not cancel a pending `g`.
      if (isModifierOnlyKey(e.key)) return

      const pending = pendingGRef.current
      if (pending !== null) {
        pendingGRef.current = null
        if (Date.now() - pending <= G_PREFIX_TIMEOUT_MS) {
          const page = G_PREFIX_PAGES[e.key]
          if (page) {
            e.preventDefault()
            e.stopPropagation()
            setCurrentPage(page)
            return
          }
        }
      }
      if (e.key === 'g') {
        e.preventDefault()
        e.stopPropagation()
        pendingGRef.current = Date.now()
      }
    }
    window.addEventListener('keydown', handleChord, true)
    return () => window.removeEventListener('keydown', handleChord, true)
  }, [setCurrentPage])

  const hideSidebar = pageHidesRightRail(currentPage)
  const contentMaxW = hideSidebar ? 'max-w-3xl' : 'max-w-2xl'
  const pageOwnsScroll = currentPage === 'tasks' || currentPage === 'docs'

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Left: Nav sidebar */}
      <NavSidebar />

      {/* Center: Main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Sync health: mounted once for every page, renders nothing while
            Todoist sync is off or healthy (Task 5). */}
        <SyncHealthBanner />

        {/* Focus banner: coexists with shell navigation while anything is queued */}
        {focusQueued && !focusExpanded && <FocusBanner />}

        {/* Page content / Focus view / Detail view.
            Each page now renders its own <PageHeader> — there's no longer
            a separate Dashboard title bar. The PageHeader provides the
            Tauri drag region for every page. */}
        {/* flex-col so a page's <main> is content-height and PageHeader's
            `sticky top-0` holds for the whole scroll (settings P2-3). Tasks
            and Docs own an inner scroller, so their <main> is pinned to the
            viewport height instead (min-h-0). */}
        <div ref={scrollRef} data-page-scroller className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
          {focusExpanded ? (
            <FocusView />
          ) : detailTarget && detailMode === 'body' && !(currentPage === 'tasks' && detailTarget.type === 'task') ? (
            // Task details opened while ON the Tasks page render INSIDE
            // TasksPage instead (see its `showingDetail` branch) so the
            // project sidebar stays mounted and interactive (Marco QA
            // round 3, item 4). Every other body-mode detail — including
            // task details opened from other pages — keeps this full-width
            // replacement behavior.
            <main key={`detail-${detailTarget.id}`} className="flex-1 min-w-0 p-6">
              <div className={cn('mx-auto w-full', contentMaxW)}>
                {detailTarget.type === 'task' ? <TaskDetailPage /> : detailTarget.type === 'goal' ? <GoalDetailPage /> : <CaptureDetailPage />}
              </div>
            </main>
          ) : (
            <main
              key={currentPage}
              // One entrance per navigation (cross-cutting move 4): a 4px
              // settle on --transition-base / --ease-entrance; reduced
              // motion switches it off in index.css.
              className={cn('page-enter flex-1 min-w-0 flex flex-col', pageOwnsScroll && 'min-h-0')}
            >
              <PageContent page={currentPage} />
            </main>
          )}
        </div>
      </div>

      {/* Right: Sidebar — detail view replaces Schedule/Habits when in sidebar mode */}
      {!hideSidebar && (
        detailTarget && detailMode === 'sidebar' ? (
          <DetailSidebar />
        ) : (
          <RightSidebar />
        )
      )}

      {/* Quick create task dialog — self-contained via useQuickCreateStore */}
      <QuickCreateDialog />

      {/* Bulk action bar — Tasks page has its own in-list SelectionActionBar
          (Task 10, Figma decision 5b) for task selection there; this global,
          viewport-fixed bar stays mounted for every other surface that still
          drives selectionStore (e.g. Inbox's task + capture checkboxes). */}
      {currentPage !== 'tasks' && <BulkActionBar />}

      {/* Help panel (shortcuts + roadmap) */}
      <HelpPanel />

      {/* Command bar overlay */}
      <CommandBar />

      {/* Focus recovery notice (shows a paused total; never starts) */}
      <FocusResumeDialog />
    </div>
  )
}
