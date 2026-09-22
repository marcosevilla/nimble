import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type Page } from '@/stores/appStore'
import {
  stepIndex,
  resolveRowFocus,
  classifyRowKeyTarget,
  NO_ROW_FOCUS,
  type RowFocus,
} from '@/lib/rowNav'

/* Keyboard row navigation for list surfaces (tasks audit P1-1/P1-2, inbox
   P1-2). One window `keydown` listener per mounted list; the pure parts
   (index math, focus-by-id, key-target guard) live in `lib/rowNav.ts` and
   are node-tested.

   Focus is tracked by row id (review C1): a row added above the focused one
   (an optimistic capture) never moves focus. DOM focus only moves when the
   user navigated — j/k/arrows, or coming back to a list whose focused row
   was remembered (review I3) while nothing else holds focus. A list
   mutation never pulls focus out of the capture field.

   Keys are only handled when the event came from a row itself or from the
   page (review C2): nested controls, fields and open menus/popovers keep
   their own Enter/Space. Space is not a list key at all (review I2): a row
   opens on Space like any `role="button"` (TaskItem / InboxNoteRow), and
   Dashboard's Space-pauses-focus wins while a session runs. Rows carry
   `data-nav-row="<id>"` so the hook can find them. */

export type RowKeyHandler = (id: string) => void

export interface RowNavigationOptions {
  enabled?: boolean
  /** Pages this list is active on. */
  pages: Page[]
  /** Single-key actions on the focused row, e.g. `{ x: complete }`. */
  keys?: Record<string, RowKeyHandler>
  /** Remembers the focused row across unmounts (open detail, come back). */
  memoryKey?: string
}

// Focused row per list, kept for the session (review I3). Module state is
// enough: it only needs to outlive the list's unmount while detail is open.
const rememberedFocus = new Map<string, RowFocus>()

function focusRowElement(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-nav-row="${CSS.escape(id)}"]`)
  if (!el) return
  if (document.activeElement !== el) el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest' })
}

function nothingElseFocused() {
  const active = document.activeElement
  return !active || active === document.body
}

export function useRowNavigation(ids: string[], onOpen: RowKeyHandler, options: RowNavigationOptions) {
  const { enabled = true, pages, keys, memoryKey } = options
  const [raw, setRaw] = useState<RowFocus>(() =>
    (memoryKey && rememberedFocus.get(memoryKey)) || NO_ROW_FOCUS,
  )
  const focus = useMemo(() => resolveRowFocus(raw, ids), [raw, ids])
  const currentPage = useAppStore((s) => s.currentPage)
  const isActive = enabled && pages.includes(currentPage)

  // Latest values without re-binding the listener on every render.
  const keysRef = useRef(keys)
  keysRef.current = keys
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const idsRef = useRef(ids)
  idsRef.current = ids
  const focusRef = useRef(focus)
  focusRef.current = focus

  // Set by j/k (and by a remembered focus on mount); consumed once the
  // focused row has rendered. Nothing else moves DOM focus.
  const moveDomFocus = useRef<'nav' | 'restore' | null>(raw.id ? 'restore' : null)

  useEffect(() => {
    if (!isActive) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = classifyRowKeyTarget(e.target)
      if (target === 'yield') return

      const list = idsRef.current
      const { id: focusedId, index } = focusRef.current

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
        case 'k':
        case 'ArrowUp': {
          e.preventDefault()
          const next = stepIndex(index, e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1, list.length)
          if (next < 0) return
          if (list[next] === focusedId) {
            focusRowElement(list[next])
            return
          }
          moveDomFocus.current = 'nav'
          setRaw({ id: list[next], index: next })
          return
        }
        case 'Enter':
          // A row's own handler already opened it when it had focus.
          if (focusedId && !e.defaultPrevented) {
            e.preventDefault()
            onOpenRef.current(focusedId)
          }
          return
        case 'Escape':
          if (focusedId) {
            setRaw(NO_ROW_FOCUS)
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

  // Move DOM focus after a navigation (or a restore) once the row exists.
  useEffect(() => {
    const reason = moveDomFocus.current
    if (!reason || !focus.id) return
    moveDomFocus.current = null
    // A restore never takes focus from something the user is in.
    if (reason === 'restore' && !nothingElseFocused()) return
    focusRowElement(focus.id)
  }, [focus.id])

  // Remember the resolved focus (and fold a fallback back into state) so
  // the next mount of this list starts where the user was.
  useEffect(() => {
    if (ids.length === 0) return
    if (focus.id !== raw.id || focus.index !== raw.index) setRaw(focus)
    if (memoryKey) rememberedFocus.set(memoryKey, focus)
  }, [focus, raw, ids.length, memoryKey])

  /** Rows report DOM focus (Tab, click) here so the ring and j/k agree. */
  const focusRow = useCallback((id: string) => {
    setRaw({ id, index: idsRef.current.indexOf(id) })
  }, [])

  return { focusedIndex: focus.index, focusedId: focus.id, focusRow }
}

interface TaskNavActions {
  onOpen: (taskId: string) => void
  onComplete?: (taskId: string) => void
  onSnooze?: (taskId: string) => void
  onFocusStart?: (taskId: string) => void
}

/** Tasks-flavored wrapper: j/k/Enter plus `x` complete, `s` snooze, `f`
 * start a focus session. Registered in `lib/shortcuts.ts` under Tasks. */
export function useTaskNavigation(
  taskIds: string[],
  actions: TaskNavActions,
  options: { enabled?: boolean; memoryKey?: string } = {},
) {
  const keys: Record<string, RowKeyHandler> = {}
  if (actions.onComplete) keys.x = actions.onComplete
  if (actions.onSnooze) keys.s = actions.onSnooze
  if (actions.onFocusStart) keys.f = actions.onFocusStart

  return useRowNavigation(taskIds, actions.onOpen, {
    enabled: options.enabled ?? true,
    pages: ['today', 'tasks'],
    keys,
    memoryKey: options.memoryKey,
  })
}
