/**
 * Desktop-only native seam for the focus companion window (`?window=focus`).
 *
 * `FocusCompanion` receives this as a prop from `main.tsx`, so the component
 * itself never imports Tauri (see the components lint rule). Everything here
 * is presentation: reading the monitor work area, observing user resizes and
 * applying geometry computed by `lib/focusWindow.ts`. Nothing touches
 * timing; the Rust command accepts geometry only from the companion window.
 */
import { invoke } from '@tauri-apps/api/core'
import { currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window'
import type { Point, Size, WorkAreaRect } from '@/lib/focusWindow'

export interface CompanionGeometry extends Size {
  min_width: number
  max_width: number
  min_height: number
  max_height: number
  x: number | null
  y: number | null
}

export interface CompanionWindowApi {
  /** Current monitor work area in logical px, or null if unknown. */
  workArea(): Promise<WorkAreaRect | null>
  /** Outer position in logical px. */
  position(): Promise<Point | null>
  /** Inner (content) size in logical px. */
  innerSize(): Promise<Size | null>
  /** User/window resizes, in logical inner px. Returns unsubscribe. */
  onResized(callback: (size: Size) => void): () => void
  apply(geometry: CompanionGeometry): Promise<void>
  /** Show main and open a task's details there (the companion has no detail page). */
  openTaskInMain(taskId: string): Promise<void>
}

export function createCompanionWindow(): CompanionWindowApi {
  const win = getCurrentWindow()
  return {
    async workArea() {
      // A window stranded on a removed display has no current monitor.
      const monitor = (await currentMonitor().catch(() => null)) ?? (await primaryMonitor().catch(() => null))
      if (!monitor) return null
      const f = monitor.scaleFactor || 1
      return {
        x: monitor.workArea.position.x / f,
        y: monitor.workArea.position.y / f,
        width: monitor.workArea.size.width / f,
        height: monitor.workArea.size.height / f,
      }
    },
    async position() {
      try {
        const [p, f] = await Promise.all([win.outerPosition(), win.scaleFactor()])
        return { x: p.x / f, y: p.y / f }
      } catch {
        return null
      }
    },
    async innerSize() {
      try {
        const [s, f] = await Promise.all([win.innerSize(), win.scaleFactor()])
        return { width: s.width / f, height: s.height / f }
      } catch {
        return null
      }
    },
    onResized(callback) {
      let closed = false
      const pending = win.onResized(({ payload }) => {
        void win.scaleFactor().then((f) => {
          if (!closed) callback({ width: payload.width / f, height: payload.height / f })
        }, () => {})
      })
      return () => {
        closed = true
        pending.then((unlisten) => unlisten(), () => {})
      }
    },
    apply: (geometry) => invoke<void>('focus_companion_apply_geometry', { geometry }),
    openTaskInMain: (taskId) => invoke<void>('focus_open_task_in_main', { taskId }),
  }
}
