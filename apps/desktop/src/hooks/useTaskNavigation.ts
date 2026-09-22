import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, type Page } from '@/stores/appStore'
import { stepIndex, clampIndex } from '@/lib/rowNav'

/* Keyboard row navigation for list surfaces (tasks audit P1-1/P1-2, inbox
   P1-2). One window `keydown` listener per mounted list; index math lives in
   `lib/rowNav.ts` (node-tested). The focused row also takes DOM focus (see
   TaskItem / InboxNoteRow `onFocusRow` + their focus effects), so Tab and
   j/k share one notion of "the focused row" and `document.activeElement`
   is always the row the ring is on.

   Keys are only handled when nothing editable has focus, no modifier is
   held, and the event did not originate inside a dialog. `Enter` defers to
   a row's own handler when that already ran (`defaultPrevented`). */

export type RowKeyHandler = (id: string) => void

export interface RowNavigationOptions {
  enabled?: boolean
  /** Pages this list is active on. */
  pages: Page[]
  /** Single-key actions on the focused row, e.g. `{ x: complete }`. */
  keys?: Record<string, RowKeyHandler>
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable ||
    !!el.closest?.('[role="dialog"]')
  )
}

export function useRowNavigation(ids: string[], onOpen: RowKeyHandler, options: RowNavigationOptions) {
  const { enabled = true, pages, keys } = options
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const currentPage = useAppStore((s) => s.currentPage)
  const isActive = enabled && pages.includes(currentPage)

  // Latest handlers without re-binding the listener on every render.
  const keysRef = useRef(keys)
  keysRef.current = keys
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const idsRef = useRef(ids)
  idsRef.current = ids
  const focusedRef = useRef(focusedIndex)
  focusedRef.current = focusedIndex

  useEffect(() => {
    if (!isActive) return

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const list = idsRef.current
      const index = focusedRef.current
      const focusedId = index >= 0 && index < list.length ? list[index] : null

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex(stepIndex(index, 1, list.length))
          return
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex(stepIndex(index, -1, list.length))
          return
        case 'Enter':
          if (focusedId && !e.defaultPrevented) {
            e.preventDefault()
            onOpenRef.current(focusedId)
          }
          return
        case 'Escape':
          if (index >= 0) {
            setFocusedIndex(-1)
            ;(document.activeElement as HTMLElement | null)?.blur?.()
          }
          return
      }

      const handler = keysRef.current?.[e.key]
      if (handler && focusedId) {
        e.preventDefault()
        handler(focusedId)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isActive])

  // Keep focus in range when rows leave (dismiss, convert, filter) instead
  // of dropping it to -1 — the next j/k continues from where the user was.
  useEffect(() => {
    setFocusedIndex((i) => clampIndex(i, ids.length))
  }, [ids.length])

  const focusedId = focusedIndex >= 0 && focusedIndex < ids.length ? ids[focusedIndex] : null

  /** Rows report DOM focus (Tab, click) here so the ring and j/k agree. */
  const focusRow = useCallback((id: string) => {
    const i = idsRef.current.indexOf(id)
    setFocusedIndex(i)
  }, [])

  return { focusedIndex, focusedId, setFocusedIndex, focusRow }
}

interface TaskNavActions {
  onOpen: (taskId: string) => void
  onComplete?: (taskId: string) => void
  onSnooze?: (taskId: string) => void
  onFocusStart?: (taskId: string) => void
}

/** Tasks-flavored wrapper: j/k/Enter plus `x`/Space complete, `s` snooze,
 * `f` start a focus session. Registered in `lib/shortcuts.ts` under Tasks. */
export function useTaskNavigation(taskIds: string[], actions: TaskNavActions, enabled: boolean = true) {
  const keys: Record<string, RowKeyHandler> = {}
  if (actions.onComplete) {
    keys.x = actions.onComplete
    keys[' '] = actions.onComplete
  }
  if (actions.onSnooze) keys.s = actions.onSnooze
  if (actions.onFocusStart) keys.f = actions.onFocusStart

  return useRowNavigation(taskIds, actions.onOpen, {
    enabled,
    pages: ['today', 'tasks'],
    keys,
  })
}
