/** JS timers that wait out a CSS animation read the SAME token the CSS uses
 *  (index.css `@theme inline` motion tokens), so a timer can never unmount
 *  a surface before its exit finishes, or hold it after (loop 4 P2-18). */

export type MotionToken =
  | '--transition-fast'
  | '--transition-base'
  | '--transition-slow'
  | '--motion-task-complete'

/** Used when there is no DOM (node tests) or the token can't be read. */
const FALLBACK_MS: Record<MotionToken, number> = {
  '--transition-fast': 150,
  '--transition-base': 220,
  '--transition-slow': 320,
  '--motion-task-complete': 600,
}

/** Tokens whose animation deliberately survives reduced motion. The task
 *  completion row still fades in place for its full duration there (index.css
 *  reduced-motion block), so the timer that removes the row must wait too. */
const KEPT_UNDER_REDUCED_MOTION: ReadonlySet<MotionToken> = new Set(['--motion-task-complete'])

/** `"220ms"` / `"0.22s"` / `"0ms"` → milliseconds; null when unparseable. */
export function parseDurationMs(raw: string): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(ms|s)\s*$/i.exec(raw)
  if (!m) return null
  const n = Number(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Milliseconds for a motion token, read from the live CSS — 0 under
 *  `prefers-reduced-motion` (except the tokens kept there on purpose). */
export function motionMs(token: MotionToken): number {
  if (prefersReducedMotion() && !KEPT_UNDER_REDUCED_MOTION.has(token)) return 0
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK_MS[token]
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token)
  return parseDurationMs(raw) ?? FALLBACK_MS[token]
}

/** When a completion mutation fires after `.animate-task-complete` starts:
 *  20ms before the row's exit ends, so the list drops it on the last frame
 *  rather than one frame after (the old literal 580 against a 600ms CSS). */
export function taskCompleteDelayMs(): number {
  return Math.max(0, motionMs('--motion-task-complete') - 20)
}
