/* Row-focus index math for j/k list navigation (tasks audit P1-1, inbox
   P1-2). Pure so `tests/rowNav.test.mjs` can import it directly; the React
   hooks (`useTaskNavigation`, InboxPage's row list) call these and own the
   DOM side (focus(), scrollIntoView).

   `-1` means "no row focused". */

/** Move focus by `direction` (+1 = j/↓, -1 = k/↑), clamped to the list.
 * From no focus, j lands on the first row and k on the last. */
export function stepIndex(current: number, direction: 1 | -1, length: number): number {
  if (length <= 0) return -1
  if (current < 0) return direction > 0 ? 0 : length - 1
  return Math.min(Math.max(current + direction, 0), length - 1)
}

/** Keep focus in range after the list changes (a dismissed row, a filter).
 * An in-range index is kept; one past the end moves to the new last row. */
export function clampIndex(current: number, length: number): number {
  if (current < 0 || length <= 0) return -1
  return Math.min(current, length - 1)
}

// ── Row focus by id (review C1, I3) ──
//
// The list tracks the focused row by id, not index: inserting a row above
// (an optimistic capture) keeps focus on the same row instead of sliding it
// onto the newcomer. The index is kept only as the fallback for when the
// focused row leaves (dismiss, convert, delete): focus lands on whatever
// now sits at that position.

export interface RowFocus {
  id: string | null
  index: number
}

export const NO_ROW_FOCUS: RowFocus = { id: null, index: -1 }

/** Where focus is now, given the last focus and the current row ids. While
 * `ids` is empty (a list still loading) nothing is focused but the caller
 * keeps `prev`, so a restored id applies once rows arrive. */
export function resolveRowFocus(prev: RowFocus, ids: readonly string[]): RowFocus {
  if (prev.id === null || ids.length === 0) return NO_ROW_FOCUS
  const at = ids.indexOf(prev.id)
  if (at >= 0) return { id: prev.id, index: at }
  const index = clampIndex(prev.index, ids.length)
  return index < 0 ? NO_ROW_FOCUS : { id: ids[index], index }
}

// ── Key target guard (review C2) ──
//
// The row list listens on `window`, so it also hears keys aimed at controls
// nested in a row (the status menu trigger, "Convert to task") and at
// fields and open menus. Those keep their native meaning: the list only
// acts when the key came from a row itself or from nothing in particular.

/** Rows carry `data-nav-row="<id>"`. */
export const NAV_ROW_SELECTOR = '[data-nav-row]'

/** Controls that own their keys (Enter/Space activate them). */
export const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="switch"], [role="tab"], [contenteditable]:not([contenteditable="false"])'

/** Anything open on top of the list — keys typed there are not row keys. */
export const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]'

export type RowKeyTarget = 'row' | 'free' | 'yield'

interface ElementLike {
  isContentEditable?: boolean
  matches?: (selector: string) => boolean
  closest?: (selector: string) => ElementLike | null
}

/** Classify a keydown target for the window-level row handler:
 * `row` — a list row itself; `free` — the page (body) or a non-interactive
 * element; `yield` — a nested control, a field or an open overlay, which
 * the row handler must leave alone (no preventDefault, no row action). */
export function classifyRowKeyTarget(target: unknown): RowKeyTarget {
  const el = target as ElementLike | null
  if (!el || typeof el.closest !== 'function' || typeof el.matches !== 'function') return 'free'
  if (el.closest(OVERLAY_SELECTOR)) return 'yield'
  if (el.isContentEditable) return 'yield'
  if (el.matches(NAV_ROW_SELECTOR)) return 'row'
  if (el.closest(INTERACTIVE_SELECTOR)) return 'yield'
  return 'free'
}
