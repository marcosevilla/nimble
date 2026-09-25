/* Row-focus index math for j/k list navigation (tasks audit P1-1, inbox
   P1-2). Pure so `tests/rowNav.test.mjs` can import it directly; the React
   hooks (`useTaskNavigation`, InboxPage's row list) call these and own the
   DOM side (focus(), scrollIntoView).

   `-1` means "no row focused". */

import { OVERLAY_SELECTOR } from './keyGuard.ts'

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

/** Controls that own Enter/Space (their native activation). Other list
 * keys typed on them act on the row that contains them (fix round 2, N1). */
export const INTERACTIVE_SELECTOR =
  'button, a, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="switch"], [role="tab"]'

/** Text entry — every key belongs to the field. */
export const FIELD_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** Anything open on top of the list — keys typed there are not row keys.
 * One definition, shared with the shell keys (lib/keyGuard). */
export { OVERLAY_SELECTOR }

/** A roving tree (the nav's Docs and project trees) owns every key typed
 * in it: its arrows move tree focus, its letters are not row actions
 * (re-score docs N-P1-1). */
/** True while any popover, menu, listbox or dialog is showing anywhere —
 * not only when focus is already inside it. Base UI moves focus into a popup
 * a frame after it opens, and a key typed in that gap reached the row. */
export function hasOpenOverlay(doc: Document = document): boolean {
  return Array.from(doc.querySelectorAll(OVERLAY_SELECTOR)).some((el) => el.getClientRects().length > 0)
}

export const TREE_SELECTOR = '[role="tree"]'

/** A panel that owns the keys typed inside it (the calendar rail: ← → t).
 * j/k/Enter/x there must not drive the page's row list (1b follow-up). */
export const KEY_REGION_SELECTOR = '[data-key-region]'

export interface RowKeyDecision {
  /** False: leave the event alone (no preventDefault, no row action). */
  handle: boolean
  /** The row the key came from (the row itself or a control inside it);
   * the list acts on this row rather than its remembered focus. */
  rowId: string | null
}

interface ElementLike {
  isContentEditable?: boolean
  matches?: (selector: string) => boolean
  closest?: (selector: string) => ElementLike | null
  getAttribute?: (name: string) => string | null
}

const SKIP: RowKeyDecision = { handle: false, rowId: null }

/** Decide whether the window-level row handler takes `key` from `target`:
 * - open overlay (popover, menu, dialog), a tree, a key region or a field → skip every key;
 * - a nested control (status button, "Convert to task") → skip Enter and
 *   Space so the control activates; other keys act on its row;
 * - a row, the page, or plain content → handle. */
export function decideRowKey(target: unknown, key: string): RowKeyDecision {
  const el = target as ElementLike | null
  if (!el || typeof el.closest !== 'function' || typeof el.matches !== 'function') {
    return { handle: true, rowId: null }
  }
  if (el.closest(OVERLAY_SELECTOR) || el.closest(TREE_SELECTOR) || el.closest(KEY_REGION_SELECTOR)) return SKIP
  if (el.isContentEditable || el.matches(FIELD_SELECTOR)) return SKIP
  const row = el.closest(NAV_ROW_SELECTOR)
  const rowId = row?.getAttribute?.('data-nav-row') ?? null
  if (el.matches(NAV_ROW_SELECTOR)) return { handle: true, rowId }
  if (el.closest(INTERACTIVE_SELECTOR) && (key === 'Enter' || key === ' ')) return SKIP
  return { handle: true, rowId }
}
