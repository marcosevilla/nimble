/**
 * Geometry for the always-on-top focus companion (spec §4 "Companion
 * baseline"). Pure math in logical pixels, so it is testable without a
 * native window.
 *
 * Returned `width`/`height` are the INNER (content) size that Tauri sets.
 * `chromeHeight` is the native titlebar: it is not part of the content,
 * but content + chrome must still fit inside the monitor's work area.
 * Nothing here starts, pauses or changes timing — it is presentation only.
 */

export const COMPANION_WIDTH = 340
export const EXPANDED_DEFAULT_HEIGHT = 560
export const EXPANDED_MIN_HEIGHT = 420
export const EXPANDED_MAX_HEIGHT = 640
export const COMPACT_MAX_WIDTH = 1020
export const MAX_SCALE = 3
/** The standard macOS titlebar of the decorated companion window. */
export const MACOS_TITLEBAR = 28
/** Mirrors `--transition-base` in index.css (the ~220ms expand/collapse intent). */
export const COMPANION_MOTION_MS = 220
const EDGE_MARGIN = 16

export interface WorkArea {
  width: number
  height: number
}
export interface WorkAreaRect extends WorkArea {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}
export interface Point {
  x: number
  y: number
}
export interface FocusWindowFit {
  width: number
  height: number
  /** Proportional card scale, 1–3. */
  scale: number
  /** Content is larger than the window at 1x: the surface must scroll, never clip. */
  overflow: boolean
}

const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback)
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)
/** A usable dimension: finite, at least 1 logical pixel. */
const extent = (n: number) => Math.max(1, Math.floor(finite(n, 1)))

/**
 * Compact (card-only) geometry. `width` is the requested/remembered compact
 * width; `cardHeight` is the card's natural content height at 1x (340 wide).
 * The card scales proportionally from 340 up to min(1020, work area), at most
 * 3x. If the scaled card is too tall for the work area the scale drops; at 1x
 * a still-too-tall card keeps the window inside the work area and scrolls.
 */
export function fitFocusWindow(width: number, cardHeight: number, chromeHeight: number, workArea: WorkArea): FocusWindowFit {
  const areaW = extent(workArea.width)
  const chrome = Math.max(0, finite(chromeHeight, 0))
  const availH = Math.max(1, Math.floor(finite(workArea.height, 1) - chrome))
  const card = Math.max(0, finite(cardHeight, 0))

  if (areaW < COMPANION_WIDTH) {
    const height = Math.max(1, Math.min(Math.round(card), availH))
    return { width: areaW, height, scale: 1, overflow: true }
  }

  const maxWidth = Math.min(COMPACT_MAX_WIDTH, areaW)
  let scale = clamp(clamp(finite(width, COMPANION_WIDTH), COMPANION_WIDTH, maxWidth) / COMPANION_WIDTH, 1, MAX_SCALE)
  if (card > 0 && card * scale > availH) scale = Math.max(1, availH / card)
  const outWidth = Math.min(maxWidth, Math.round(COMPANION_WIDTH * scale))
  scale = outWidth / COMPANION_WIDTH
  const natural = Math.round(card * scale)
  const overflow = natural > availH
  return { width: outWidth, height: Math.max(1, Math.min(natural, availH)), scale, overflow }
}

/**
 * Expanded (card + queue) geometry: 340 wide, remembered height clamped to
 * 420–640 (560 by default), then to the work area. The queue scrolls inside.
 */
export function fitExpandedWindow(height: number, chromeHeight: number, workArea: WorkArea): FocusWindowFit {
  const areaW = extent(workArea.width)
  const chrome = Math.max(0, finite(chromeHeight, 0))
  const availH = Math.max(1, Math.floor(finite(workArea.height, 1) - chrome))
  const wanted = Math.round(clamp(finite(height, EXPANDED_DEFAULT_HEIGHT), EXPANDED_MIN_HEIGHT, EXPANDED_MAX_HEIGHT))
  const width = Math.min(COMPANION_WIDTH, areaW)
  return {
    width,
    height: Math.min(wanted, availH),
    scale: 1,
    overflow: width < COMPANION_WIDTH || wanted > availH,
  }
}

/**
 * Keep a (restored) window fully inside the current work area, e.g. after the
 * monitor it was on was removed. On-screen positions are left unchanged; an
 * oversized window pins to the work area's origin.
 */
export function clampFocusPosition(position: Point, size: Size, chromeHeight: number, area: WorkAreaRect): Point {
  const outerH = size.height + Math.max(0, finite(chromeHeight, 0))
  const maxX = area.x + area.width - size.width
  const maxY = area.y + area.height - outerH
  return {
    x: Math.round(Math.max(area.x, Math.min(finite(position.x, area.x), maxX))),
    y: Math.round(Math.max(area.y, Math.min(finite(position.y, area.y), maxY))),
  }
}

/** First open: top-right corner of the work area. */
export function defaultFocusPosition(size: Size, area: WorkAreaRect): Point {
  return {
    x: Math.max(area.x, area.x + area.width - size.width - EDGE_MARGIN),
    y: area.y + EDGE_MARGIN,
  }
}

/** Parse a remembered size from settings; corrupt/absent values use the fallback. */
export function parseStoredSize(raw: string | null | undefined, fallback: number): number {
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
}

/** Expand/collapse duration: the Nimble base motion token, or immediate under reduced motion. */
export function companionMotionMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : COMPANION_MOTION_MS
}
