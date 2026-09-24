/* Focused-row picker keys (loop 2 chunk 3, T2): p · ⇧D · l · m open the
   focused task row's priority, due-date, label and project picker — the
   same pickers its marks open on click (T1). Pure (no JSX, no `@/`
   imports) so `tests/rowKeys.test.mjs` can import it directly; TaskItem
   owns the DOM side (the row-key guard, `useRowPickerStore.openPicker`).

   Plain `d` is not here on purpose: it is the Inbox note row's dismiss.
   `m` is shared with the note row's "Move to a doc" — note rows aren't
   task rows, so each row kind keeps its own meaning. */

/** Same strings as rowMarks.ts `RowMarkKind`. */
export type RowPickerKind = 'priority' | 'due' | 'label' | 'project'

/** Keyed by `KeyboardEvent.key` (⇧D arrives as 'D'). */
export const ROW_PICKER_KEYS: Readonly<Record<string, RowPickerKind>> = Object.freeze({
  p: 'priority',
  D: 'due',
  l: 'label',
  m: 'project',
})

/** The picker a bare p / ⇧D / l / m opens; null for anything else, any
 * ⌘ / ⌃ / ⌥ combo, and auto-repeat (holding a key never re-opens). */
export function rowPickerKind(e: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  repeat?: boolean
}): RowPickerKind | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return null
  return Object.prototype.hasOwnProperty.call(ROW_PICKER_KEYS, e.key) ? ROW_PICKER_KEYS[e.key] : null
}
