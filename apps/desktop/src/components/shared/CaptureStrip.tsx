import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// The capture strip is a separate always-on-top Tauri window: the event bus
// and window sizing below are desktop shell machinery with no web equivalent,
// so they deliberately sit outside the DataProvider seam.
// eslint-disable-next-line no-restricted-imports
import { emit, listen } from '@tauri-apps/api/event'
// eslint-disable-next-line no-restricted-imports
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, CornerDownLeft } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'
// Likewise desktop-only: hides the strip window itself. Intentionally NOT on
// DataProvider — there is no window to dismiss on the web.
// eslint-disable-next-line no-restricted-imports
import { dismissCaptureStrip } from '@/services/tauri'
import type { CaptureRoute } from '@nimble/types'
import { parseRoutePrefix } from '@/lib/captureRoutes'
import { routeWithDate } from '@/lib/captureActions'
import { HighlightField } from '@/components/capture/HighlightField'
import { RoutePill, DateChip } from '@/components/capture/CaptureTokens'
import { useCaptureDate } from '@/hooks/useCaptureDate'
import { cn } from '@/lib/utils'
import { motionMs } from '@/lib/motion'

// Mirror the main window's theme — localStorage is shared across windows,
// and this window never mounts useTheme()
function applyThemeFromStorage() {
  const root = document.documentElement
  const mode = localStorage.getItem('theme') || 'system'
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  root.classList.toggle('dark', mode === 'dark' || (mode === 'system' && prefersDark))
  root.classList.add(`theme-${localStorage.getItem('accent_theme') || 'warm'}`)
}

const STRIP_WIDTH = 760
/// Window chrome around the card: pt-6 (24) + pb-16 (64) + card border (2).
/// The generous bottom/side margins are shadow bleed room — the CSS shadow
/// clips with a hard edge wherever it crosses the window bounds.
const WINDOW_PADDING = 90

/** The ⏎ ↔ ✓ swap on the save button. Reduced motion: an opacity cut, no
 *  scale / blur / spring (loop 4 P2-18). */
const ICON_SWAP = {
  initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
  transition: { type: 'spring', duration: 0.3, bounce: 0 },
} as const
const ICON_SWAP_REDUCED = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0 },
} as const

export function CaptureStrip() {
  const dp = useDataProvider()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  // Set when a task route saved but its date didn't stick (the update after
  // routing threw) — the save itself worked, so this isn't `error`: no ✓,
  // no auto-dismiss, but the field still clears and Escape still dismisses.
  const [dateNote, setDateNote] = useState<string | null>(null)
  // Bumped on every summon so the entrance animation replays
  const [openCount, setOpenCount] = useState(0)
  // Set when the strip was summoned with a grabbed selection — the name of
  // the app the text came from. Cleared once the user edits the prefill.
  const [prefillContext, setPrefillContext] = useState<string | null>(null)
  const prefillRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [routes, setRoutes] = useState<CaptureRoute[]>([])
  const reduceMotion = useReducedMotion() ?? false
  const iconSwap = reduceMotion ? ICON_SWAP_REDUCED : ICON_SWAP
  // Escape / a save play `.panel-out`, then hide the window (loop 4 P2-18:
  // it used to vanish mid-frame). The ghost guard still hides at once.
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const leave = useCallback((reason: string) => {
    setLeaving(true)
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => dismissCaptureStrip(reason), motionMs('--transition-base'))
  }, [])
  useEffect(() => () => clearTimeout(leaveTimer.current), [])

  const parsed = useMemo(() => parseRoutePrefix(value, routes), [value, routes])
  const taskBound = parsed.route?.target_type === 'task' && parsed.content.trim() !== ''
  const capDate = useCaptureDate(value, parsed.content, taskBound)

  useEffect(() => {
    applyThemeFromStorage()
    // The window itself is transparent — only the strip card paints
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  // Load capture routes on mount and refresh on every summon, so a route
  // added/edited in Settings while the strip was closed shows up next open.
  useEffect(() => {
    dp.captureRoutes.list().then(setRoutes).catch(() => setRoutes([]))
  }, [dp])

  // Grow the textarea with its content, then size the window to hug the card
  // so the transparent dead zone below the strip never eats clicks
  const autoGrow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    requestAnimationFrame(() => {
      const card = cardRef.current
      if (!card) return
      getCurrentWindow()
        .setSize(new LogicalSize(STRIP_WIDTH, card.offsetHeight + WINDOW_PADDING))
        .catch(() => {})
    })
  }, [])

  useEffect(() => {
    autoGrow()
  }, [value, autoGrow])

  // Reset transient state and refocus each time the strip is summoned.
  // Draft text is intentionally kept — an accidental dismiss shouldn't lose
  // a thought. A grabbed selection lands ~200ms later via the prefill event.
  useEffect(() => {
    let focusCheck: ReturnType<typeof setTimeout>
    const unlisten = listen('capture-strip-opened', () => {
      applyThemeFromStorage()
      // Summoned again mid-exit: stay up.
      clearTimeout(leaveTimer.current)
      setLeaving(false)
      setSaved(false)
      setError(false)
      setDateNote(null)
      setOpenCount((c) => c + 1)
      setPrefillContext(null)
      prefillRef.current = null
      dp.captureRoutes.list().then(setRoutes).catch(() => setRoutes([]))
      requestAnimationFrame(() => textareaRef.current?.focus())
      // If macOS denied activation (window shown but never focused), don't
      // linger as an untouchable ghost — bow out
      clearTimeout(focusCheck)
      focusCheck = setTimeout(() => {
        if (!document.hasFocus()) dismissCaptureStrip('ghost-guard: document never focused')
      }, 800)
    })
    return () => {
      clearTimeout(focusCheck)
      unlisten.then((fn) => fn())
    }
  }, [dp])

  // A selection grabbed from the previous app — arrives shortly after open
  useEffect(() => {
    const unlisten = listen<{ text: string; context: string | null }>(
      'capture-strip-prefill',
      (event) => {
        setValue(event.payload.text)
        setPrefillContext(event.payload.context)
        prefillRef.current = event.payload.text
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (!el) return
          el.focus()
          // Caret at the end, ready to append
          el.setSelectionRange(el.value.length, el.value.length)
        })
      },
    )
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const submit = useCallback(async () => {
    const text = value.trim()
    if (!text) return
    try {
      const { route, content } = parseRoutePrefix(text, routes)
      let dateFailed = false
      if (route && content) {
        const date = route.target_type === 'task' ? capDate.date : null
        const out = await routeWithDate(dp, route, content, date)
        dateFailed = out.dateFailed
      } else if (prefillRef.current) {
        // A capture born from a grabbed selection keeps its source-app tag
        // even if the user edited the text before saving
        await dp.captures.create(text, 'selection', prefillContext ?? undefined)
      } else {
        await dp.captures.create(text, 'quick_capture')
      }
      setError(false)
      setValue('')
      setPrefillContext(null)
      prefillRef.current = null
      emit('captures-changed')
      if (dateFailed) {
        // The save worked — only the date didn't stick. No ✓, no
        // auto-dismiss; the note stays up until Escape (see handleKeyDown).
        setDateNote("Saved. The date didn't stick. Set it on the task.")
      } else {
        setDateNote(null)
        setSaved(true)
        setTimeout(() => leave('saved'), 450)
      }
    } catch {
      setDateNote(null)
      setError(true)
    }
  }, [value, dp, prefillContext, routes, capDate.date, leave])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (capDate.onKeyDown(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      leave('esc')
    }
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center px-10 pb-16 pt-6">
      <div
        ref={cardRef}
        key={openCount}
        inert={leaving || undefined}
        className={cn(leaving ? 'panel-out' : 'capture-strip-in', 'flex w-full items-end gap-3 rounded-2xl border border-border bg-popover py-3 pl-5 pr-3 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.18),0_20px_40px_rgba(0,0,0,0.10)]')}
      >
        <HighlightField
          multiline
          fieldRef={textareaRef}
          autoFocus
          rows={1}
          value={value}
          highlight={capDate.highlight}
          wrapperClassName="flex-1 self-center"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture anything… (/t task, /i idea)"
          spellCheck={false}
          className="max-h-28 resize-none py-1 text-[15px] leading-normal text-foreground outline-none placeholder:text-muted-foreground/80"
        />
        {parsed.route && parsed.content && (
          <span className="mb-1.5 flex">
            <RoutePill route={parsed.route} />
          </span>
        )}
        {capDate.date && (
          <span className="mb-1.5 flex">
            <DateChip label={capDate.date.label} compact />
          </span>
        )}
        {error ? (
          <span className="mb-1.5 shrink-0 text-meta text-destructive">
            Couldn't save — ⏎ to retry
          </span>
        ) : dateNote ? (
          <span className="mb-1.5 shrink-0 text-meta text-muted-foreground">
            {dateNote}
          </span>
        ) : (
          prefillContext && (
            <span className="mb-1.5 shrink-0 text-meta text-muted-foreground">
              from {prefillContext}
            </span>
          )
        )}
        <button
          type="button"
          onClick={submit}
          aria-label="Save capture"
          className="relative shrink-0 rounded-lg border border-foreground/25 bg-background/60 p-2 text-foreground/80 transition-[scale,border-color,color] duration-(--transition-fast) ease-out after:absolute after:-inset-1.5 hover:border-foreground/40 hover:text-foreground active:scale-[0.96]"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {saved ? (
              <motion.span
                key="check"
                className="flex"
                {...iconSwap}
              >
                <Check className="size-4 text-primary" />
              </motion.span>
            ) : (
              <motion.span
                key="enter"
                className="flex"
                {...iconSwap}
              >
                <CornerDownLeft className="size-4" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  )
}
