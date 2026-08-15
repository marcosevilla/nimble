/**
 * Browser stub for `@tauri-apps/api/event`.
 *
 * Aliased in by `vite.web.config.ts` so the web build never pulls in Tauri's
 * IPC layer. Cross-window events are a desktop-only concern: on the web there
 * is exactly one window, so listening is a no-op and emitting has no receiver.
 *
 * Signatures mirror the real module closely enough that every call site
 * type-checks and behaves sanely (`listen(...)` resolves to an unlisten
 * function, so the standard `unlisten.then((fn) => fn())` cleanup still works).
 */

export interface Event<T> {
  /** Event name */
  event: string
  /** Event identifier used to unlisten */
  id: number
  /** Event payload */
  payload: T
}

export type EventCallback<T> = (event: Event<T>) => void
export type UnlistenFn = () => void

/** No-op listener. Resolves to an unlisten function that does nothing. */
export async function listen<T>(
  _event: string,
  _handler: EventCallback<T>,
  _options?: unknown,
): Promise<UnlistenFn> {
  return () => {}
}

/** No-op one-shot listener. Same contract as {@link listen}. */
export async function once<T>(
  _event: string,
  _handler: EventCallback<T>,
  _options?: unknown,
): Promise<UnlistenFn> {
  return () => {}
}

/** No-op emit — nothing else is listening in a single-window browser tab. */
export async function emit(_event: string, _payload?: unknown): Promise<void> {}

/** No-op targeted emit. */
export async function emitTo(
  _target: unknown,
  _event: string,
  _payload?: unknown,
): Promise<void> {}
