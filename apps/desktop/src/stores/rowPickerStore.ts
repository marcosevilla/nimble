import { create } from 'zustand'
import type { RowMarkKind } from '@/lib/rowMarks'

/* Which task-row picker is open, if any (loop 2 chunk 3, T1). Lifted out of
   the row marks so something other than a click can open one: T2's row keys
   (p · ⇧D · l · m) call `openPicker(rowId, kind)` for the focused row and
   the mark's picker opens anchored to it. Only one row picker is open at a
   time, app-wide. `rowId` is the row's `data-nav-row` id.

   `anchor` (T2): 'mark' (the default) opens the picker on the row's own
   mark; 'row' opens it on the row's right end, for a row key pressed on a
   row that shows no mark of that kind (Normal priority, no due date, no
   labels, no project). It is fixed for the whole open session, so a label
   ticked in a right-end picker doesn't hop the picker onto the chip that
   just appeared. */
export type RowPickerAnchor = 'mark' | 'row'

export interface RowPickerTarget {
  rowId: string
  kind: RowMarkKind
  anchor?: RowPickerAnchor
}

interface RowPickerState {
  open: RowPickerTarget | null
  openPicker: (rowId: string, kind: RowMarkKind, anchor?: RowPickerAnchor) => void
  /** Close `target` if it is the open one (a stale close from another
   * picker's exit never closes the picker that replaced it). */
  closePicker: (target?: RowPickerTarget) => void
}

export const useRowPickerStore = create<RowPickerState>((set) => ({
  open: null,
  openPicker: (rowId, kind, anchor = 'mark') => set({ open: { rowId, kind, anchor } }),
  closePicker: (target) =>
    set((s) => {
      if (!s.open) return {}
      if (target && (s.open.rowId !== target.rowId || s.open.kind !== target.kind)) return {}
      return { open: null }
    }),
}))

/** Controlled `open` / `onOpenChange` for one row picker: a mark's
 * (`anchor` 'mark') or the row-end fallback's ('row'). */
export function useRowPicker(rowId: string, kind: RowMarkKind, anchor: RowPickerAnchor = 'mark') {
  const open = useRowPickerStore(
    (s) => s.open?.rowId === rowId && s.open.kind === kind && (s.open.anchor ?? 'mark') === anchor,
  )
  const onOpenChange = (next: boolean) => {
    const store = useRowPickerStore.getState()
    if (next) store.openPicker(rowId, kind, anchor)
    else store.closePicker({ rowId, kind })
  }
  return { open, onOpenChange }
}
