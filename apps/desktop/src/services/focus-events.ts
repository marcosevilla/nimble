/**
 * Provider-neutral focus invalidation and ordering.
 *
 * Every window (main, capture strip, the future companion) receives focus
 * changes through this one seam; the platform bridge in `provider-events.ts`
 * feeds it. A change signal carries only IDs and revisions — never task
 * content — so a consumer always re-reads the full snapshot from its
 * DataProvider and orders results with `createFocusSnapshotGate`.
 *
 * Kept dependency-free (type imports only) so node:test can load it directly.
 */
import type { FocusErrorCode, FocusSnapshot } from '@nimble/types'

/** Desktop `nimble-focus-changed` payload. IDs/revisions only. */
export interface FocusChangeSignal {
  version: 1
  engine_revision: number
  queue_revision: number
  owner_epoch: string
  process_generation: number
  command_id: string | null
}

/** Revision order inside ONE owner epoch: equal is a harmless re-read. */
export function shouldApplyFocusRevision(current: number, incoming: number): boolean {
  return incoming >= current
}

const safe = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** Validate an untrusted event payload; anything malformed is dropped. */
export function parseFocusChangeSignal(payload: unknown): FocusChangeSignal | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (p.version !== 1 || !safe(p.engine_revision) || !safe(p.queue_revision)
    || !safe(p.process_generation) || typeof p.owner_epoch !== 'string') return null
  const command = p.command_id
  if (command != null && typeof command !== 'string') return null
  return {
    version: 1,
    engine_revision: p.engine_revision,
    queue_revision: p.queue_revision,
    owner_epoch: p.owner_epoch,
    process_generation: p.process_generation,
    command_id: command ?? null,
  }
}

type Listener = (signal: FocusChangeSignal | null) => void
const listeners = new Set<Listener>()

/**
 * Subscribe to focus invalidations. The callback means "re-read the full
 * snapshot"; it receives no content. Returns an unsubscribe function.
 */
export function subscribeFocusChanges(callback: () => void): () => void {
  const listener: Listener = () => callback()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Called by the platform bridge. `null`/omitted means a gap: reconnect,
 * visibility regained, or an unparseable event — consumers re-read fully.
 */
export function notifyFocusChanged(signal: FocusChangeSignal | null = null): void {
  for (const listener of [...listeners]) {
    try { listener(signal) } catch { /* one stale view must not block the others */ }
  }
}

/** Where a snapshot came from: a full owner read, or a command reply. */
export type FocusSnapshotSource = 'snapshot' | 'reply'

/**
 * Orders snapshots. Revisions compare only within the same owner epoch; a
 * different epoch (restore, ownership change) is accepted only from a full
 * snapshot read, never from a reply or a racing response.
 */
export function createFocusSnapshotGate() {
  let latest: FocusSnapshot | null = null
  return {
    accept(snapshot: FocusSnapshot, source: FocusSnapshotSource): boolean {
      if (latest && latest.owner_epoch === snapshot.owner_epoch) {
        if (!shouldApplyFocusRevision(latest.engine_revision, snapshot.engine_revision)) return false
      } else if (latest && source !== 'snapshot') {
        return false
      }
      latest = snapshot
      return true
    },
    current(): FocusSnapshot | null { return latest },
    reset(): void { latest = null },
  }
}

/**
 * Subscribe first, then load — so an event that lands during the initial
 * read triggers its own read, and whichever reply is older is ignored.
 */
export function trackFocusSnapshots(opts: {
  read: () => Promise<FocusSnapshot>
  subscribe?: (callback: () => void) => () => void
  onSnapshot: (snapshot: FocusSnapshot) => void
  onError?: (error: FocusRequestError) => void
}): () => void {
  const gate = createFocusSnapshotGate()
  let stopped = false
  const load = () => {
    opts.read().then((snapshot) => {
      if (!stopped && gate.accept(snapshot, 'snapshot')) opts.onSnapshot(snapshot)
    }, (error: unknown) => {
      if (!stopped) opts.onError?.(FocusRequestError.from(error))
    })
  }
  const unsubscribe = (opts.subscribe ?? subscribeFocusChanges)(load)
  load()
  return () => { stopped = true; unsubscribe() }
}

const CODES: readonly FocusErrorCode[] = [
  'conflict', 'wrong_owner', 'stale_occurrence', 'not_found', 'invalid', 'unsupported', 'storage', 'needs_review',
]

/**
 * A typed focus failure. `command` retains the client's intent so a caller
 * can retry an uncertain request with the SAME command_id, never a new one.
 */
export class FocusRequestError extends Error {
  readonly code: FocusErrorCode
  readonly command: unknown

  constructor(code: FocusErrorCode, message: string, command?: unknown) {
    super(message)
    this.name = 'FocusRequestError'
    this.code = code
    this.command = command
  }

  static from(error: unknown, command?: unknown): FocusRequestError {
    if (error instanceof FocusRequestError) {
      return command === undefined || error.command !== undefined
        ? error : new FocusRequestError(error.code, error.message, command)
    }
    if (error && typeof error === 'object' && 'code' in error) {
      const raw = error as { code: unknown; message?: unknown }
      const code = CODES.includes(raw.code as FocusErrorCode) ? raw.code as FocusErrorCode : 'invalid'
      return new FocusRequestError(code, typeof raw.message === 'string' ? raw.message : 'Focus request failed', command)
    }
    return new FocusRequestError('storage', error instanceof Error ? error.message : String(error), command)
  }
}

/** A typed rejection for a capability this provider does not have. */
export function focusUnsupported(message: string, command?: unknown): Promise<never> {
  return Promise.reject(new FocusRequestError('unsupported', message, command))
}
