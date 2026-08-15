/**
 * Browser stub for `@tauri-apps/api/window`.
 *
 * The only window API the frontend touches is in `CaptureStrip.tsx`:
 *
 *   getCurrentWindow()
 *     .setSize(new LogicalSize(STRIP_WIDTH, card.offsetHeight + WINDOW_PADDING))
 *     .catch(() => {})
 *
 * A web page can't resize its own window, so `setSize` resolves and does
 * nothing. `LogicalSize` is a plain value object here (no parameter
 * properties — `erasableSyntaxOnly` is on in tsconfig.app.json).
 */

export class LogicalSize {
  readonly type = 'Logical'
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
}

export class PhysicalSize {
  readonly type = 'Physical'
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
}

export interface StubWindow {
  label: string
  setSize(size: LogicalSize | PhysicalSize): Promise<void>
  close(): Promise<void>
  hide(): Promise<void>
  show(): Promise<void>
  setFocus(): Promise<void>
}

const noopWindow: StubWindow = {
  label: 'main',
  async setSize(_size: LogicalSize | PhysicalSize): Promise<void> {},
  async close(): Promise<void> {},
  async hide(): Promise<void> {},
  async show(): Promise<void> {},
  async setFocus(): Promise<void> {},
}

export function getCurrentWindow(): StubWindow {
  return noopWindow
}
