import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '@/stores/appStore'
import { SetupDialog } from '@/components/setup/SetupDialog'
import { Dashboard } from '@/components/layout/Dashboard'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTheme } from '@/hooks/useTheme'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { Agentation } from 'agentation'
import { DialRoot } from 'dialkit'
import { TypographyTuner } from '@/components/shared/TypographyTuner'
import { TypeSystemOverlay } from '@/components/shared/TypeSystemOverlay'
import { toast } from 'sonner'

function App() {
  useTheme() // Initialize theme system
  const dp = useDataProvider()

  const setupComplete = useAppStore((s) => s.setupComplete)
  const setSetupComplete = useAppStore((s) => s.setSetupComplete)

  useEffect(() => {
    dp.settings.checkSetupComplete().then(setSetupComplete).catch(() => setSetupComplete(false))
  }, [dp, setSetupComplete])

  // Log app_opened once on mount
  const loggedOpen = useRef(false)
  useEffect(() => {
    if (!loggedOpen.current) {
      loggedOpen.current = true
      dp.activity.log('app_opened').catch(() => {})
    }
  }, [dp])

  // Auto-sync on launch: push then pull if Turso is configured
  const syncedOnLaunch = useRef(false)
  useEffect(() => {
    if (syncedOnLaunch.current) return
    syncedOnLaunch.current = true

    dp.sync.getStatus().then((status) => {
      if (status.turso_configured && status.remote_initialized) {
        // Non-blocking: fire and forget
        dp.sync.push()
          .then(() => dp.sync.pull())
          .catch((e) => {
            console.warn('Auto-sync on launch failed:', e)
          })
      }
    }).catch(() => {
      // Sync not available yet, skip
    })
  }, [dp])

  // Refresh task lists whenever a background/focus-triggered Todoist sync
  // applies a remote change. Note: this re-triggers emitTasksChanged's
  // debounced push, but that push finds an empty outbox and is a cheap
  // no-op — not worth guarding against unless it proves chatty in practice.
  useEffect(() => {
    const unlisten = listen('todoist-sync-applied', () => emitTasksChanged())
    return () => {
      unlisten.then((f) => f())
    }
  }, [])

  /* Typography tuner — ⌘⇧Y toggles the live tuning panel. DEV-only; the
   * gate in the render block below prevents shipping the panel or its
   * keyboard shortcut to production users. */
  const [tunerOpen, setTunerOpen] = useState(false)
  /* Type-system overlay — ⌘⇧U toggles a draggable reference panel with
   * every token rendered at actual scale. DEV-only, same gating as the
   * tuner above. Complements the tuner: tuner edits values, overlay
   * shows the spec. Letter chosen to dodge Marco's global shortcuts —
   * avoid T (WebKit reopen-tab), K (Notion launcher), J (conflict). */
  const [typeOverlayOpen, setTypeOverlayOpen] = useState(false)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    function onKey(e: KeyboardEvent) {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        setTunerOpen((v) => {
          toast.message(v ? 'Typography tuner closed' : 'Typography tuner opened', {
            description: v ? undefined : 'Panel is at top-right · ⌘⇧Y to close',
          })
          return !v
        })
      }
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        setTypeOverlayOpen((v) => {
          toast.message(v ? 'Type system overlay closed' : 'Type system overlay opened', {
            description: v ? undefined : 'Drag the header to move · ⌘⇧U to close',
          })
          return !v
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-hide scrollbars after 2s of inactivity
  useEffect(() => {
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
    function handleScroll(e: Event) {
      const el = e.target as Element
      if (!(el instanceof HTMLElement)) return
      el.classList.add('is-scrolling')
      const prev = timers.get(el)
      if (prev) clearTimeout(prev)
      timers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 2000))
    }
    document.addEventListener('scroll', handleScroll, true)
    return () => document.removeEventListener('scroll', handleScroll, true)
  }, [])

  // Log page changes
  const prevPage = useRef(useAppStore.getState().currentPage)
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      if (state.currentPage !== prevPage.current) {
        prevPage.current = state.currentPage
        dp.activity.log('page_viewed', undefined, { page: state.currentPage }).catch(() => {})
      }
    })
    return unsub
  }, [dp])

  // Still checking
  if (setupComplete === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-body text-muted-foreground">Loading...</p>
      </div>
    )
  }

  // Needs setup
  if (!setupComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <SetupDialog open onComplete={() => setSetupComplete(true)} />
      </div>
    )
  }

  // Main app
  return (
    <TooltipProvider>
      <Dashboard />
      <Toaster position="bottom-right" />
      {import.meta.env.DEV && <Agentation />}
      {import.meta.env.DEV && tunerOpen && (
        <>
          <DialRoot position="top-right" defaultOpen theme="system" />
          <TypographyTuner />
        </>
      )}
      {import.meta.env.DEV && typeOverlayOpen && (
        <TypeSystemOverlay onClose={() => setTypeOverlayOpen(false)} />
      )}
    </TooltipProvider>
  )
}

export default App
