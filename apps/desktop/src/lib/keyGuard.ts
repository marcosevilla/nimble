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
