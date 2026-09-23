/**
 * Small per-window rules shared by the main window, the capture strip and
 * the focus companion (all load the same bundle; `?window=` picks the root).
 */

/**
 * Only the main window schedules the debounced Todoist push. Every task
 * write is announced to all windows as `nimble-data-changed`, so letting
 * each window push would fire one sync per open window for a single edit.
 */
export function ownsTodoistPush(search: string): boolean {
  return !new URLSearchParams(search).get('window')
}

interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}
interface FocusSource {
  addEventListener(type: 'focus', listener: () => void): void
  removeEventListener(type: 'focus', listener: () => void): void
}

/**
 * Calls `callback` when the window becomes visible or regains focus — a
 * backstop for any change that happened while it was hidden (a window
 * mounted hidden at launch can miss earlier writes). Returns the unsubscribe.
 */
export function onWindowReturn(doc: VisibilitySource, win: FocusSource, callback: () => void): () => void {
  const onVisible = () => { if (doc.visibilityState === 'visible') callback() }
  doc.addEventListener('visibilitychange', onVisible)
  win.addEventListener('focus', onVisible)
  return () => {
    doc.removeEventListener('visibilitychange', onVisible)
    win.removeEventListener('focus', onVisible)
  }
}
