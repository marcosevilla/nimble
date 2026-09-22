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
