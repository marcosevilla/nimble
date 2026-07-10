import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { NavSidebar } from './NavSidebar'
import { RightSidebar } from './RightSidebar'
import { CommandBar } from '@/components/shared/CommandBar'
import { HelpPanel } from '@/components/shared/HelpPanel'
import { BulkActionBar } from '@/components/shared/BulkActionBar'
import { useSelectionStore } from '@/stores/selectionStore'
import { QuickCreateDialog } from '@/components/tasks/QuickCreateDialog'
import { TodayPage } from '@/components/pages/TodayPage'
import { TasksPage } from '@/components/pages/TasksPage'
import { InboxPage } from '@/components/pages/InboxPage'
import { SessionPage } from '@/components/pages/SessionPage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { DocsPage } from '@/components/pages/DocsPage'
import { GoalsPage } from '@/components/pages/GoalsPage'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { useFocusTimer } from '@/hooks/useFocusTimer'
import { useFocusStore } from '@/stores/focusStore'
import { FocusView } from '@/components/focus/FocusView'
import { FocusBanner } from '@/components/focus/FocusBanner'
import { FocusCelebration } from '@/components/focus/FocusCelebration'
import { FocusResumeDialog } from '@/components/focus/FocusResumeDialog'
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
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)

  // Load nav order from SQLite on mount
  const loadNavOrder = useLayoutStore((s) => s.loadNavOrder)
  useEffect(() => {
    loadNavOrder()
  }, [loadNavOrder])

  // Focus mode
  useFocusTimer()
  const focusActive = useFocusStore((s) => s.isActive)
  const focusCompact = useFocusStore((s) => s.isCompact)
  const showCelebration = useFocusStore((s) => s.showCelebration)

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

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

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

      // Space — pause/resume focus (only when focus active and not in input)
      if (e.key === ' ' && !isInput && !meta && focusActive) {
        e.preventDefault()
        const store = useFocusStore.getState()
        if (store.pausedAt) store.resumeFocus()
        else store.pauseFocus()
        return
      }

      // Q — open quick create dialog (only when not typing in an input)
      if (e.key === 'q' && !isInput && !meta) {
        e.preventDefault()
        setQuickCreateOpen(true)
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
  }, [setCurrentPage, detailTarget, closeDetail, focusActive])

  const hideSidebar = currentPage === 'settings' || currentPage === 'session'
  const contentMaxW = hideSidebar ? 'max-w-3xl' : 'max-w-2xl'

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Left: Nav sidebar */}
      <NavSidebar />

      {/* Center: Main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Focus banner (compact mode) */}
        {focusActive && focusCompact && <FocusBanner />}

        {/* Page content / Focus view / Detail view.
            Each page now renders its own <PageHeader> — there's no longer
            a separate Dashboard title bar. The PageHeader provides the
            Tauri drag region for every page. */}
        <div ref={scrollRef} className="flex flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
          {focusActive && !focusCompact ? (
            <FocusView />
          ) : detailTarget && detailMode === 'body' ? (
            <main key={`detail-${detailTarget.id}`} className="flex-1 min-w-0 p-6">
              <div className={cn('mx-auto w-full', contentMaxW)}>
                {detailTarget.type === 'task' ? <TaskDetailPage /> : detailTarget.type === 'goal' ? <GoalDetailPage /> : <CaptureDetailPage />}
              </div>
            </main>
          ) : (
            <main
              key={currentPage}
              className="flex-1 min-w-0 flex flex-col"
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

      {/* Quick create task dialog */}
      <QuickCreateDialog
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
      />

      {/* Bulk action bar */}
      <BulkActionBar />

      {/* Help panel (shortcuts + roadmap) */}
      <HelpPanel />

      {/* Command bar overlay */}
      <CommandBar />

      {/* Focus mode overlays */}
      {showCelebration && <FocusCelebration />}
      <FocusResumeDialog />
    </div>
  )
}
