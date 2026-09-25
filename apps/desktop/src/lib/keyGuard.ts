/* One guard for window-level single-key shortcuts (Docs `n` `/`, the
   expanded focus view, the celebration overlay). A key is left alone —
   no action, no preventDefault — when it was aimed at something else:

   - a text entry (input, textarea, select, contenteditable);
   - anything inside an open popover, menu or dialog;
   - a nested interactive control (button, link, menu item …) that is not
     the page's own row, so Enter/Space keep activating that control.

   `rowSelector` names the row element a page drives itself (the docs tree
   row); `allowInteractive` is for overlays that own every key while they
   are up. Pure and DOM-shape-only so node can test it (tests/keyGuard). */

export const INTERACTIVE_SELECTOR =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="tab"], [role="radio"]'

export const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-popup-open], [data-open][data-side]'

export interface KeyTargetLike {
  tagName?: string
  isContentEditable?: boolean
  matches?: (selector: string) => boolean
  closest?: (selector: string) => unknown
}

export function isTextEntry(target: KeyTargetLike | null | undefined): boolean {
  if (!target) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
}

export function shouldIgnoreKey(
  target: KeyTargetLike | null | undefined,
  opts: { rowSelector?: string; allowInteractive?: boolean } = {},
): boolean {
  if (!target) return false
  if (isTextEntry(target)) return true
  if (target.closest?.(OVERLAY_SELECTOR)) return true
  if (opts.allowInteractive) return false
  if (target.closest?.(INTERACTIVE_SELECTOR)) {
    if (opts.rowSelector && target.matches?.(opts.rowSelector)) return false
    return true
  }
  return false
}

/** A page list row (TaskItem, InboxNoteRow): `role="button"` rows that
 * hand Space to a running focus session (they check `focusSpaceAction`). */
export const ROW_SELECTOR = '[data-nav-row]'

/**
 * Dashboard's single-key shell shortcuts (`?`, ⇧F, ⇧H, `q`, digits and the
 * `g` chord) stand down for any text entry — a SELECT included — and while
 * a menu, popover or dialog is open, whether or not focus is inside it
 * (1b follow-up). `overlayOpen` is `hasOpenOverlay()` from lib/rowNav,
 * passed in so this stays DOM-free. A focused button keeps them: digits
 * still navigate after clicking a nav item.
 */
export function shellKeyBlocked(target: KeyTargetLike | null | undefined, overlayOpen: boolean): boolean {
  if (overlayOpen) return true
  if (!target) return false
  return isTextEntry(target) || !!target.closest?.(OVERLAY_SELECTOR)
}

/**
 * Space-pauses-focus stands down like the shell keys, and also for any
 * focused control but a list row, so Space activates the button it was
 * aimed at (the project delete-confirm's "Keep it") instead of pausing.
 */
export function spaceKeyBlocked(target: KeyTargetLike | null | undefined, overlayOpen: boolean): boolean {
  if (overlayOpen) return true
  return shouldIgnoreKey(target, { rowSelector: ROW_SELECTOR })
}

/** An Up next row (the roving list owns its own keys: Enter promotes it). */
export const QUEUE_ROW_SELECTOR = '[data-focus-entry]'

export interface FocusViewKeyEvent {
  key: string
  target: KeyTargetLike | null | undefined
  defaultPrevented?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  repeat?: boolean
}

/**
 * The expanded focus view's window shortcuts: Escape closes, Enter completes
 * the card's task, `s` stops. Null leaves the key alone. On an Up next row
 * only Escape applies: there Enter means "promote this row", never
 * "complete the card" (native fix 3 review C1).
 */
export function focusViewKey(e: FocusViewKeyEvent): 'close' | 'complete' | 'stop' | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null
  if (shouldIgnoreKey(e.target)) return null
  if (e.key === 'Escape') return 'close'
  // Card shortcuts never fire from a queue row: the row is not the card.
  if (e.target?.closest?.(QUEUE_ROW_SELECTOR)) return null
  if (e.key === 'Enter') return 'complete'
  if (e.key === 's') return 'stop'
  return null
}

export interface CalendarKeyEvent {
  key: string
  target: KeyTargetLike | null | undefined
  defaultPrevented?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * The calendar rail's day keys: ← previous day, → next day, t today. The
 * panel only listens while focus is inside it (re-score inbox N-P1-1);
 * this still leaves text entry, open overlays, chords and keys another
 * handler already took alone. `T` is Shift+t, so it is matched by key,
 * before the shift check.
 */
export function calendarKey(e: CalendarKeyEvent): 'prev' | 'next' | 'today' | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return null
  if (shouldIgnoreKey(e.target, { allowInteractive: true })) return null
  if (e.key === 't' || e.key === 'T') return 'today'
  if (e.shiftKey) return null
  if (e.key === 'ArrowLeft') return 'prev'
  if (e.key === 'ArrowRight') return 'next'
  return null
}

/**
 * Today's page keys: `b` expands / compacts the brief, `[` / `]` step the
 * brief date. Plain keys only; text entry, overlays and chords keep them.
 */
export function todayKey(e: CalendarKeyEvent): 'toggle' | 'prev' | 'next' | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null
  if (shouldIgnoreKey(e.target)) return null
  if (e.key === 'b') return 'toggle'
  if (e.key === '[') return 'prev'
  if (e.key === ']') return 'next'
  return null
}
