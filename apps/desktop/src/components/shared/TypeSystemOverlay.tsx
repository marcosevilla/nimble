import { useEffect, useRef, useState } from 'react'
import { TYPO_TOKENS } from '@/lib/typography-tokens'
import { cn } from '@/lib/utils'
import { Crosshair, GripHorizontal, X } from 'lucide-react'

/* Draggable dev overlay that renders every design-system type token at
 * actual scale with its token name and numeric values. Mount this behind
 * a DEV gate in App.tsx; keyboard shortcut ⌘⇧U toggles it. Position
 * persists across reloads via localStorage.
 *
 * Each row shows:
 *   text-<name>   <size>·<weight>·<tracking>
 *   <preview-rendered-with-the-actual-token-class>
 *
 * Reads TYPO_TOKENS so the panel is always in sync with the tuner's data
 * source — if the token list changes, this panel picks it up automatically.
 *
 * Also ships an "inspect" mode: click the crosshair button (or press I while
 * the panel is open), then hover any text in the app to see which token is
 * applied + its computed styles in a floating tooltip. Clicking or pressing
 * Escape exits inspect mode. */

const STORAGE_KEY = 'type-system-overlay:pos'
const INITIAL_POS = { x: 24, y: 80 }
const OVERLAY_DATA_ATTR = 'data-type-overlay'

const TOKEN_CLASSES = TYPO_TOKENS.map((t) => `text-${t.name}`)

type InspectInfo = {
  token: string | null
  size: string
  weight: string
  lineHeight: string
  letterSpacing: string
  family: string
  cursorX: number
  cursorY: number
  rect: { x: number; y: number; width: number; height: number }
}

export function TypeSystemOverlay({ onClose }: { onClose: () => void }) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved) as { x: number; y: number }
    } catch {
      /* ignore parse/storage errors, fall back to default */
    }
    return INITIAL_POS
  })
  const [dragging, setDragging] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [hovered, setHovered] = useState<InspectInfo | null>(null)
  const offset = useRef({ x: 0, y: 0 })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
    } catch {
      /* storage full or disabled — panel still works, just won't persist */
    }
  }, [pos])

  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      setPos({
        x: e.clientX - offset.current.x,
        y: e.clientY - offset.current.y,
      })
    }
    function onUp() {
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  /* Inspect mode — on hover, resolve which text-* token (if any) wraps the
   * element under the cursor + grab computed styles. Ignores anything inside
   * the overlay itself so pick-mode doesn't self-reference. */
  useEffect(() => {
    if (!inspecting) return

    document.body.style.cursor = 'crosshair'

    function onMove(e: MouseEvent) {
      const target = document.elementFromPoint(e.clientX, e.clientY)
      if (!target || !(target instanceof HTMLElement)) {
        setHovered(null)
        return
      }
      if (target.closest(`[${OVERLAY_DATA_ATTR}]`)) {
        setHovered(null)
        return
      }

      const style = window.getComputedStyle(target)
      const rect = target.getBoundingClientRect()
      setHovered({
        token: findTokenClass(target),
        size: style.fontSize,
        weight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        family: style.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        cursorX: e.clientX,
        cursorY: e.clientY,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      })
    }

    function onClick(e: MouseEvent) {
      /* Clicking outside the overlay exits inspect mode and swallows the
       * click so we don't accidentally navigate or trigger app handlers. */
      const t = e.target
      if (t instanceof HTMLElement && t.closest(`[${OVERLAY_DATA_ATTR}]`)) return
      e.preventDefault()
      e.stopPropagation()
      setInspecting(false)
      setHovered(null)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setInspecting(false)
        setHovered(null)
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [inspecting])

  function startDrag(e: React.MouseEvent) {
    offset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    }
    setDragging(true)
  }

  return (
    <>
      <div
        {...{ [OVERLAY_DATA_ATTR]: '' }}
        className={cn(
          'fixed z-[9999] w-[360px] max-h-[min(640px,calc(100vh-48px))]',
          'flex flex-col overflow-hidden select-none',
          'rounded-lg border border-border/40 bg-background/95 backdrop-blur-sm shadow-2xl',
          dragging && 'shadow-[0_30px_60px_-15px_oklch(0_0_0/0.35)]',
        )}
        style={{ left: pos.x, top: pos.y }}
      >
        <div
          onMouseDown={startDrag}
          className={cn(
            'flex items-center justify-between px-3 py-2 border-b border-border/20',
            'bg-muted/40',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <GripHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-label text-foreground">Type system</span>
            <span className="text-label text-muted-foreground truncate">
              {inspecting ? 'Hover text to inspect · esc to exit' : '⌘⇧U · drag to move'}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setInspecting((v) => !v)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 text-label transition-colors',
                inspecting
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/30',
              )}
              aria-pressed={inspecting}
              aria-label={inspecting ? 'Exit inspect mode' : 'Enter inspect mode'}
            >
              <Crosshair className="size-3" />
              {inspecting ? 'Picking' : 'Inspect'}
            </button>
            <button
              onClick={onClose}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
              aria-label="Close type system overlay"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto divide-y divide-border/20">
          {TYPO_TOKENS.map((t) => (
            <div key={t.name} className="flex flex-col gap-1.5 px-3 py-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-mono text-label text-accent-blue">
                  text-{t.name}
                </span>
                <span className="font-mono text-label text-muted-foreground truncate">
                  {t.size}px · {t.weight} · {formatTracking(t.tracking)}
                </span>
              </div>
              {/* No cn()/text-foreground here: tailwind-merge treats text-foreground
                  (custom color) and text-<size> as the same group and drops the size.
                  Body color inherits from <body>; template literal keeps the size. */}
              <span className={`text-${t.name} block truncate`}>
                {t.preview}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Highlight rectangle over the hovered element */}
      {inspecting && hovered && hovered.rect.width > 0 && (
        <div
          {...{ [OVERLAY_DATA_ATTR]: '' }}
          className="fixed pointer-events-none z-[9998] rounded-sm"
          style={{
            left: hovered.rect.x - 2,
            top: hovered.rect.y - 2,
            width: hovered.rect.width + 4,
            height: hovered.rect.height + 4,
            boxShadow:
              '0 0 0 2px oklch(from var(--accent-blue) l c h / 0.7), 0 0 0 6px oklch(from var(--accent-blue) l c h / 0.15)',
          }}
        />
      )}

      {/* Floating info tooltip near the cursor */}
      {inspecting && hovered && (
        <div
          {...{ [OVERLAY_DATA_ATTR]: '' }}
          className={cn(
            'fixed pointer-events-none z-[10000]',
            'rounded-md border border-border/40 bg-background/95 backdrop-blur-sm shadow-xl',
            'px-2.5 py-2 min-w-[200px]',
          )}
          style={{
            left: clamp(hovered.cursorX + 14, 8, window.innerWidth - 260),
            top: clamp(hovered.cursorY + 14, 8, window.innerHeight - 90),
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'font-mono text-label',
                hovered.token ? 'text-accent-blue' : 'text-muted-foreground italic',
              )}
            >
              {hovered.token ?? 'no token'}
            </span>
          </div>
          <div className="mt-1 font-mono text-label text-foreground/80">
            {formatPx(hovered.size)} · {hovered.weight} · LH{' '}
            {formatLineHeight(hovered.lineHeight, hovered.size)}
          </div>
          <div className="font-mono text-label text-muted-foreground truncate">
            {hovered.letterSpacing === 'normal' ? 'tr 0' : `tr ${hovered.letterSpacing}`} ·{' '}
            {hovered.family}
          </div>
        </div>
      )}
    </>
  )
}

function findTokenClass(el: HTMLElement): string | null {
  let node: HTMLElement | null = el
  while (node && node !== document.body) {
    for (const cls of TOKEN_CLASSES) {
      if (node.classList.contains(cls)) return cls
    }
    node = node.parentElement
  }
  return null
}

function formatTracking(em: number): string {
  if (em === 0) return '0 tr'
  const sign = em > 0 ? '+' : ''
  return `${sign}${em}em`
}

function formatPx(size: string): string {
  /* getComputedStyle returns "14px"; keep as-is */
  return size
}

function formatLineHeight(lh: string, size: string): string {
  if (lh === 'normal') return 'normal'
  /* Convert computed px leading to a unitless multiplier relative to size */
  const lhPx = parseFloat(lh)
  const sizePx = parseFloat(size)
  if (!isFinite(lhPx) || !isFinite(sizePx) || sizePx === 0) return lh
  return (lhPx / sizePx).toFixed(2)
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max))
}
