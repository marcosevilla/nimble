/**
 * Geometry for the always-on-top focus companion (spec §4 "Companion
 * baseline"). Pure math in logical pixels, so it is testable without a
 * native window.
 *
 * `fitFocusWindow`/`fitExpandedWindow` return the CONTENT (web viewport)
 * size. `chromeHeight` is the vertical space between the native frame and
 * that viewport. On macOS Tauri's "Visible" titlebar is an
 * NSFullSizeContentView window: the size Tauri sets is the whole frame and
 * the web viewport is the frame minus the titlebar (measured on macOS 26:
 * frame 190, viewport 158). So the native size to set is content + chrome
 * (`companionGeometry`), and content + chrome must fit the work area.
 * Nothing here starts, pauses or changes timing — it is presentation only.
 */

export const COMPANION_WIDTH = 340
export const EXPANDED_DEFAULT_HEIGHT = 560
export const EXPANDED_MIN_HEIGHT = 420
export const EXPANDED_MAX_HEIGHT = 640
export const COMPACT_MAX_WIDTH = 1020
export const MAX_SCALE = 3
/**
 * Fallback height of the decorated companion's macOS titlebar, used only when
 * the live window cannot be measured (see `chromeHeight`). macOS 26 draws a
 * 32pt titlebar (measured: frame 198 vs content 166); older releases use 28.
 * Taking the larger keeps content + chrome inside the work area on both.
 */
export const MACOS_TITLEBAR = 32
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
 * Whole logical pixels that fully contain a fractional extent. Layout heights
 * are fractional (e.g. 203.23px); rounding to nearest could fit the window
 * up to half a pixel (times the scale) short of the card. A tiny epsilon
 * absorbs float noise so an exact 249.0000001 stays 249.
 */
const cover = (n: number) => Math.ceil(n - 1e-6)

/**
 * Chrome from the live window: its native outer (frame) height minus the web
 * viewport height (`window.innerHeight`), in logical px. Not outer minus
 * Tauri's inner size: with a full-size content view those are equal (the
 * webview spans the frame) while the titlebar still hides the top of it.
 * Anything missing or implausible falls back to `MACOS_TITLEBAR`.
 */
export function chromeHeight(outerHeight: number | null | undefined, viewportHeight: number | null | undefined): number {
  if (outerHeight == null || viewportHeight == null) return MACOS_TITLEBAR
  const chrome = outerHeight - viewportHeight
  return Number.isFinite(chrome) && chrome >= 0 && chrome <= 200 ? chrome : MACOS_TITLEBAR
}

/**
 * Compact (card-only) content geometry. `width` is the requested/remembered
 * compact width; `cardHeight` is the card's natural content height at 1x
 * (340 wide), fractional as laid out. The returned height is the viewport
 * height, rounded UP so it always contains the whole scaled card; the native
 * window adds `chromeHeight` on top (see `companionGeometry`).
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
    const height = Math.max(1, Math.min(cover(card), availH))
    return { width: areaW, height, scale: 1, overflow: true }
  }

  const maxWidth = Math.min(COMPACT_MAX_WIDTH, areaW)
  let scale = clamp(clamp(finite(width, COMPANION_WIDTH), COMPANION_WIDTH, maxWidth) / COMPANION_WIDTH, 1, MAX_SCALE)
  if (card > 0 && card * scale > availH) scale = Math.max(1, availH / card)
  // Floor, so a height-limited scale is never nudged back over the work area.
  const outWidth = Math.min(maxWidth, Math.floor(COMPANION_WIDTH * scale + 1e-6))
  scale = outWidth / COMPANION_WIDTH
  const natural = cover(card * scale)
  const overflow = natural > availH
  return { width: outWidth, height: Math.max(1, Math.min(natural, availH)), scale, overflow }
}

/**
 * Expanded (card + queue) geometry: 340 wide, remembered height clamped to
 * 420–640 (560 by default), then to the work area. The queue scrolls inside
 * the viewport and the footer stays pinned, so this height is the native
 * window height as remembered (not content + chrome).
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

export interface CompanionPrefs {
  compact: boolean
  compactWidth: number
  expandedHeight: number
}

/** Native geometry for `focus_companion_apply_geometry` plus the content fit it came from. */
export interface CompanionGeometry extends Size {
  min_width: number
  max_width: number
  min_height: number
  max_height: number
  fit: FocusWindowFit
}

/**
 * The native size and resize limits to apply for the current mode.
 *
 * Compact: the frame is the scaled card plus `chrome`, so the viewport holds
 * the whole card (H1); the height is locked and only the width is user
 * resizable. Expanded: the remembered height within 420–640. `chrome` must be
 * measured once per window (see `chromeHeight`), never mid-resize, or the fit
 * feeds back into itself.
 */
export function companionGeometry(prefs: CompanionPrefs, cardHeight: number, chrome: number, area: WorkArea): CompanionGeometry {
  const c = Math.max(0, finite(chrome, 0))
  const availH = Math.max(1, Math.floor(finite(area.height, 1) - c))
  if (prefs.compact) {
    const fit = fitFocusWindow(prefs.compactWidth, cardHeight, c, area)
    const height = Math.max(1, Math.min(fit.height + Math.ceil(c), Math.floor(finite(area.height, 1))))
    return {
      fit,
      width: fit.width,
      height,
      min_width: Math.min(COMPANION_WIDTH, fit.width),
      max_width: Math.max(fit.width, Math.min(COMPACT_MAX_WIDTH, Math.floor(finite(area.width, 1)))),
      min_height: height,
      max_height: height,
    }
  }
  const fit = fitExpandedWindow(prefs.expandedHeight, c, area)
  return {
    fit,
    width: fit.width,
    height: fit.height,
    min_width: fit.width,
    max_width: fit.width,
    min_height: Math.min(EXPANDED_MIN_HEIGHT, fit.height),
    max_height: Math.max(fit.height, Math.min(EXPANDED_MAX_HEIGHT, availH)),
  }
}

/** A native geometry as sent to `focus_companion_apply_geometry`. */
export interface NativeGeometry extends Size {
  min_width: number
  max_width: number
  min_height: number
  max_height: number
  x: number | null
  y: number | null
}

/** Same size, limits and position: re-applying it would only churn the window. */
export function sameGeometry(a: NativeGeometry | null, b: NativeGeometry | null): boolean {
  if (a == null || b == null) return false
  const keys: (keyof NativeGeometry)[] = ['width', 'height', 'min_width', 'max_width', 'min_height', 'max_height', 'x', 'y']
  return keys.every((k) => a[k] === b[k])
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
