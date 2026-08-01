import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Check, Plus } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'

// Mirror the main window's theme — localStorage is shared across windows,
// and this window never mounts useTheme()
function applyThemeFromStorage() {
  const root = document.documentElement
  const mode = localStorage.getItem('theme') || 'system'
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  root.classList.toggle('dark', mode === 'dark' || (mode === 'system' && prefersDark))
  root.classList.add(`theme-${localStorage.getItem('accent_theme') || 'warm'}`)
}

export function CaptureStrip() {
  const dp = useDataProvider()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  // Set while flashing confirmation of a double-tap-Shift selection capture
  const [flash, setFlash] = useState<{ content: string; context: string | null } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    applyThemeFromStorage()
    // The window itself is transparent — only the strip card paints
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  // Reset transient state and refocus each time the strip is summoned.
  // Draft text is intentionally kept — an accidental dismiss shouldn't lose a thought.
  useEffect(() => {
    let focusCheck: ReturnType<typeof setTimeout>
    const unlisten = listen('capture-strip-opened', () => {
      applyThemeFromStorage()
      setSaved(false)
      setError(false)
      setFlash(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
      // If macOS denied activation (window shown but never focused), don't
      // linger as an untouchable ghost — bow out
      clearTimeout(focusCheck)
      focusCheck = setTimeout(() => {
        if (!document.hasFocus()) getCurrentWindow().hide()
      }, 800)
    })
    return () => {
      clearTimeout(focusCheck)
      unlisten.then((fn) => fn())
    }
  }, [])

  // Selection captured via double-tap Shift: Rust already saved it and showed
  // this window unfocused — just flash what was grabbed, then slip away
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const unlisten = listen<{ content: string; context: string | null }>(
      'selection-captured',
      (event) => {
        applyThemeFromStorage()
        setFlash(event.payload)
        clearTimeout(timer)
        timer = setTimeout(() => {
          setFlash(null)
          getCurrentWindow().hide()
        }, 1200)
      },
    )
    return () => {
      clearTimeout(timer)
      unlisten.then((fn) => fn())
    }
  }, [])

  const submit = useCallback(async () => {
    const text = value.trim()
    if (!text) return
    try {
      await dp.captures.create(text, 'quick_capture')
      setError(false)
      setSaved(true)
      setValue('')
      emit('captures-changed')
      setTimeout(() => {
        setSaved(false)
        getCurrentWindow().hide()
      }, 350)
    } catch {
      setError(true)
    }
  }, [value, dp])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      getCurrentWindow().hide()
    }
  }

  if (flash) {
    return (
      <div className="flex h-screen w-screen items-start justify-center p-3">
        <div className="flex w-full items-center gap-2.5 rounded-xl border border-border/50 bg-popover px-4 py-3 shadow-lg shadow-black/20">
          <Check className="size-3.5 shrink-0 text-primary" />
          <span className="flex-1 truncate text-body text-muted-foreground">{flash.content}</span>
          {flash.context && (
            <span className="shrink-0 text-meta text-muted-foreground/50">from {flash.context}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center p-3">
      <div className="flex w-full items-start gap-2.5 rounded-xl border border-border/50 bg-popover px-4 py-3 shadow-lg shadow-black/20">
        {saved ? (
          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
        ) : (
          <Plus className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <textarea
          ref={textareaRef}
          autoFocus
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture anything…"
          spellCheck={false}
          className="flex-1 resize-none bg-transparent text-body outline-none placeholder:text-muted-foreground/40"
        />
        {error ? (
          <span className="mt-0.5 shrink-0 text-meta text-destructive">
            Couldn't save — ⏎ to retry
          </span>
        ) : (
          <kbd className="mt-0.5 shrink-0 rounded border border-border/30 px-1.5 py-0.5 text-label font-mono text-muted-foreground/50">
            ⏎
          </kbd>
        )}
      </div>
    </div>
  )
}
