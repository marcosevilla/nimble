import { useCallback, useEffect, useRef, useState } from 'react'
import { FocusQueueTray } from '@/components/focus/FocusQueueTray'
import { FocusLoadState } from '@/components/focus/FocusLoadState'
import { Toaster } from '@/components/ui/sonner'
import { useFocusTrayData } from '@/hooks/useFocusTrayData'
import { shouldIgnoreKey } from '@/lib/keyGuard'
import { cn } from '@/lib/utils'
import {
  COMPANION_WIDTH,
  EXPANDED_DEFAULT_HEIGHT,
  MACOS_TITLEBAR,
  clampFocusPosition,
  companionGeometry,
  companionMotionMs,
  defaultFocusPosition,
  parseStoredSize,
  sameGeometry,
  type CompanionPrefs,
  type FocusWindowFit,
  type NativeGeometry,
} from '@/lib/focusWindow'
import { useDataProvider } from '@/services/provider-context'
import type { CompanionWindowApi } from '@/services/focusCompanionWindow'
import { connectFocusCache, focusSpaceAction, refreshFocus, sendFocusAction, useFocusCache } from '@/stores/focusStore'
import type { LocalTask } from '@nimble/types'

/** Remembered separately (spec §4): compact width and expanded height. */
const PREF_KEYS = {
  compact: 'focus_companion_compact',
  compactWidth: 'focus_companion_compact_width',
  expandedHeight: 'focus_companion_expanded_height',
} as const
const SAVE_DELAY_MS = 400

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The always-on-top focus companion (`?window=focus`). It renders the same
 * provider snapshots as the main window through the shared event bridge,
 * with the familiar card/queue; the card-only mode scales proportionally.
 * It owns no clock and starts nothing — closing it only closes a view (the
 * Rust lifecycle decides whether that was the last visible focus surface).
 */
export function FocusCompanion({ windowApi }: { windowApi?: CompanionWindowApi }) {
  const dp = useDataProvider()
  const snapshot = useFocusCache((s) => s.snapshot)
  const capabilities = useFocusCache((s) => s.capabilities)
  const error = useFocusCache((s) => s.error)
  const openDetail = useCallback(
    (task: LocalTask) => {
      void windowApi?.openTaskInMain(task.id).catch(() => {})
    },
    [windowApi],
  )
  const data = useFocusTrayData({ openDetail: windowApi ? openDetail : undefined })
  const [prefs, setPrefs] = useState<CompanionPrefs | null>(null)
  const [cardHeight, setCardHeight] = useState(0)
  const [fit, setFit] = useState<FocusWindowFit | null>(null)
  const [refit, setRefit] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const applied = useRef<NativeGeometry | null>(null)
  /** Frame-to-viewport chrome, measured once before the first fit (never mid-resize). */
  const chromeRef = useRef<number | null>(null)
  const placed = useRef(false)

  useEffect(() => connectFocusCache(), [])

  useEffect(() => {
    let live = true
    const read = (key: string) => dp.settings.get(key).catch(() => null)
    Promise.all([read(PREF_KEYS.compact), read(PREF_KEYS.compactWidth), read(PREF_KEYS.expandedHeight)]).then(
      ([compact, width, height]) => {
        if (!live) return
        setPrefs({
          compact: compact === 'true',
          compactWidth: parseStoredSize(width, COMPANION_WIDTH),
          expandedHeight: parseStoredSize(height, EXPANDED_DEFAULT_HEIGHT),
        })
      },
    )
    return () => {
      live = false
    }
  }, [dp])

  // Persist remembered geometry (debounced; drags fire many resizes).
  useEffect(() => {
    if (!prefs) return
    const id = setTimeout(() => {
      void dp.settings.set(PREF_KEYS.compact, String(prefs.compact)).catch(() => {})
      void dp.settings.set(PREF_KEYS.compactWidth, String(prefs.compactWidth)).catch(() => {})
      void dp.settings.set(PREF_KEYS.expandedHeight, String(prefs.expandedHeight)).catch(() => {})
    }, SAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [dp, prefs])

  // Card-only mode refits to the card's natural (1x) height. The observer's
  // border box is the untransformed, fractional layout height; offsetHeight
  // is an integer that can round the card down and clip its bottom edge.
  const compact = prefs?.compact ?? false
  const hasSnapshot = snapshot != null
  useEffect(() => {
    const el = contentRef.current
    if (!compact || !el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0]?.blockSize
      setCardHeight(typeof box === 'number' && box > 0 ? box : el.offsetHeight)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [compact, hasSnapshot])

  // Returning to the window (monitor/display changes) refits and re-clamps.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRefit((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  // Compute geometry with the pure helpers and apply it natively. The chrome
  // is read once: re-reading it while an apply is still resizing the window
  // would feed a transient value back into the fit.
  useEffect(() => {
    if (!windowApi || !prefs || (prefs.compact && cardHeight <= 0)) return
    let cancelled = false
    void (async () => {
      const [area, chrome] = await Promise.all([
        windowApi.workArea(),
        chromeRef.current != null ? chromeRef.current : windowApi.chromeHeight().catch(() => MACOS_TITLEBAR),
      ])
      if (cancelled || !area) return
      chromeRef.current = chrome
      const next = companionGeometry(prefs, cardHeight, chrome, area)
      const current = await windowApi.position()
      if (cancelled) return
      const target = !placed.current
        ? defaultFocusPosition(next.fit, area)
        : current
          ? clampFocusPosition(current, next.fit, chrome, area)
          : null
      placed.current = true
      const { fit, ...limits } = next
      const geometry = { ...limits, x: target?.x ?? null, y: target?.y ?? null }
      // Focus/visibility refits (e.g. moving across Spaces) usually compute
      // the same geometry: skip the native round trip instead of re-sizing.
      if (!sameGeometry(applied.current, geometry)) {
        applied.current = geometry
        await windowApi.apply(geometry).catch(() => {})
      }
      if (!cancelled) setFit(fit)
    })()
    return () => {
      cancelled = true
    }
  }, [windowApi, prefs, cardHeight, refit])

  // A user resize changes only what that mode remembers.
  useEffect(() => {
    if (!windowApi) return
    return windowApi.onResized((size) => {
      const last = applied.current
      if (last && Math.abs(size.width - last.width) <= 1 && Math.abs(size.height - last.height) <= 1) return
      setPrefs((p) => {
        if (!p) return p
        if (p.compact) {
          if (last && Math.abs(size.width - last.width) <= 1) return p
          return { ...p, compactWidth: Math.round(size.width) }
        }
        return { ...p, expandedHeight: Math.round(size.height) }
      })
    })
  }, [windowApi])

  // Space pauses a running timer (never starts or resumes), as in main.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== ' ' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (shouldIgnoreKey(e.target as HTMLElement)) return
      const action = focusSpaceAction()
      if (!action || useFocusCache.getState().pending) return
      e.preventDefault()
      void sendFocusAction(action).catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onCompactChange = (next: boolean) => {
    setPrefs((p) => (p ? { ...p, compact: next } : p))
    // ~220ms expand/collapse intent via the Nimble token; immediate when reduced.
    const duration = companionMotionMs(reducedMotion())
    if (duration > 0) {
      contentRef.current?.animate?.([{ opacity: 0.35 }, { opacity: 1 }], {
        duration,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      })
    }
  }

  if (!snapshot || !prefs) {
    return (
      <div className="h-screen w-screen bg-background">
        <FocusLoadState error={error} onRetry={() => void refreshFocus()} />
      </div>
    )
  }

  const scale = compact && fit ? fit.scale : 1
  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <div className={cn('h-full w-full', compact && (fit?.overflow ? 'overflow-auto' : 'overflow-hidden'))}>
        <div
          ref={contentRef}
          className={compact ? undefined : 'h-full'}
          style={
            compact
              ? { width: COMPANION_WIDTH, transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: 'top left' }
              : undefined
          }
        >
          <FocusQueueTray
            snapshot={snapshot}
            capabilities={capabilities}
            tasks={data.tasks}
            projects={data.projects}
            sections={data.sections}
            completed={data.completed}
            today={data.today}
            onAction={data.onAction}
            taskOps={data.taskOps}
            initialCompact={prefs.compact}
            onCompactChange={onCompactChange}
            soundMuted={data.soundMuted}
            onSoundMutedChange={data.setSoundMuted}
          />
        </div>
      </div>
      {/* Undo and copy feedback use the app's normal toast here too. The
          companion is under 600px wide, so sonner lays toasts out edge to
          edge with this small inset instead of the main window's offsets. */}
      <Toaster position="bottom-center" offset={8} mobileOffset={8} />
    </div>
  )
}
