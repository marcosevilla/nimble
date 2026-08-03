import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { AnimatePresence, motion } from 'motion/react'
import { Check, CornerDownLeft } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'
import { dismissCaptureStrip } from '@/services/tauri'

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

export function CaptureStrip() {
  const dp = useDataProvider()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  // Bumped on every summon so the entrance animation replays
  const [openCount, setOpenCount] = useState(0)
  // Set when the strip was summoned with a grabbed selection — the name of
  // the app the text came from. Cleared once the user edits the prefill.
  const [prefillContext, setPrefillContext] = useState<string | null>(null)
  const prefillRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    applyThemeFromStorage()
    // The window itself is transparent — only the strip card paints
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

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
      setSaved(false)
      setError(false)
      setOpenCount((c) => c + 1)
      setPrefillContext(null)
      prefillRef.current = null
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
  }, [])

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
      // A capture born from a grabbed selection keeps its source-app tag
      // even if the user edited the text before saving
      if (prefillRef.current) {
        await dp.captures.create(text, 'selection', prefillContext ?? undefined)
      } else {
        await dp.captures.create(text, 'quick_capture')
      }
      setError(false)
      setSaved(true)
      setValue('')
      setPrefillContext(null)
      prefillRef.current = null
      emit('captures-changed')
      setTimeout(() => {
        setSaved(false)
        dismissCaptureStrip('saved')
      }, 450)
    } catch {
      setError(true)
    }
  }, [value, dp, prefillContext])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      dismissCaptureStrip('esc')
    }
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center px-10 pb-16 pt-6">
      <div
        ref={cardRef}
        key={openCount}
        className="capture-strip-in flex w-full items-end gap-3 rounded-2xl border border-border bg-popover py-3 pl-5 pr-3 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.18),0_20px_40px_rgba(0,0,0,0.10)]"
      >
        <textarea
          ref={textareaRef}
          autoFocus
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture anything…"
          spellCheck={false}
          className="max-h-28 flex-1 resize-none self-center bg-transparent py-1 text-[15px] leading-normal text-foreground outline-none placeholder:text-muted-foreground/80"
        />
        {error ? (
          <span className="mb-1.5 shrink-0 text-meta text-destructive">
            Couldn't save — ⏎ to retry
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
          className="relative shrink-0 rounded-lg border border-foreground/25 bg-background/60 p-2 text-foreground/80 transition-[scale,border-color,color] duration-150 ease-out after:absolute after:-inset-1.5 hover:border-foreground/40 hover:text-foreground active:scale-[0.96]"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {saved ? (
              <motion.span
                key="check"
                className="flex"
                initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              >
                <Check className="size-4 text-primary" />
              </motion.span>
            ) : (
              <motion.span
                key="enter"
                className="flex"
                initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
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
