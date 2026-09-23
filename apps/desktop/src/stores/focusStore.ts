import { create } from 'zustand'
import { getDataProvider } from '@/services/provider-context'
import {
  createFocusSnapshotGate,
  FocusRequestError,
  subscribeFocusChanges,
  trackFocusSnapshots,
  type FocusSnapshotSource,
} from '@/services/focus-events'
import type {
  FocusAction,
  FocusCapabilities,
  FocusCommand,
  FocusReply,
  FocusSnapshot,
  FocusSource,
} from '@nimble/types'
import { enqueueSelectionAction, focusNowPlan, spaceKeyAction, startActionFor } from '@/lib/focusFlows'

// ── Provider-backed focus cache (the authority is the Rust FocusService) ──
//
// This store is a render cache: the last accepted snapshot, capabilities,
// loading/error and the in-flight action for optimistic presentation. It
// never runs its own elapsed clock — every total comes from a snapshot.

interface FocusCacheState {
  snapshot: FocusSnapshot | null
  capabilities: FocusCapabilities | null
  loading: boolean
  error: FocusRequestError | null
  /** The action awaiting its committed reply; nothing is shown as done before commit. */
  pending: FocusAction | null
}

const EMPTY_CACHE: FocusCacheState = { snapshot: null, capabilities: null, loading: false, error: null, pending: null }

export const useFocusCache = create<FocusCacheState>(() => ({ ...EMPTY_CACHE }))

/** One ordering gate for every snapshot this window sees (reads and replies). */
const gate = createFocusSnapshotGate()

function applySnapshot(snapshot: FocusSnapshot, source: FocusSnapshotSource): boolean {
  if (!gate.accept(snapshot, source)) return false
  useFocusCache.setState({ snapshot: gate.current() })
  return true
}

/** Test/reset hook: forget the cached snapshot and ordering. */
export function resetFocusCache(): void {
  gate.reset()
  useFocusCache.setState({ ...EMPTY_CACHE })
}

/** Full read: capabilities plus a snapshot (the only way to adopt a new owner epoch). */
export function refreshFocus(): Promise<void> {
  return readFull(true)
}

/** `clearError: false` keeps a failed action's error visible across the follow-up read. */
async function readFull(clearError: boolean): Promise<void> {
  const dp = getDataProvider()
  useFocusCache.setState({ loading: true })
  try {
    const [capabilities, snapshot] = await Promise.all([dp.focus.capabilities(), dp.focus.snapshot()])
    useFocusCache.setState(clearError ? { capabilities, error: null } : { capabilities })
    applySnapshot(snapshot, 'snapshot')
  } catch (error) {
    useFocusCache.setState({ error: FocusRequestError.from(error) })
  } finally {
    useFocusCache.setState({ loading: false })
  }
}

/**
 * Keep the cache live: subscribes to focus invalidations BEFORE the first
 * read, so an event racing that read triggers its own read and the older
 * answer is dropped. Returns the unsubscribe function.
 */
export function connectFocusCache(subscribe: (callback: () => void) => () => void = subscribeFocusChanges): () => void {
  const dp = getDataProvider()
  useFocusCache.setState({ loading: true })
  const stop = trackFocusSnapshots({
    read: () => dp.focus.snapshot(),
    subscribe,
    onSnapshot: (snapshot) => {
      applySnapshot(snapshot, 'snapshot')
      useFocusCache.setState({ loading: false, error: null })
    },
    onError: (error) => useFocusCache.setState({ loading: false, error }),
  })
  dp.focus.capabilities().then(
    (capabilities) => useFocusCache.setState({ capabilities }),
    (error: unknown) => useFocusCache.setState({ error: FocusRequestError.from(error) }),
  )
  return stop
}

/** Actions that open a live work/break segment need the heartbeat (Task 9). */
const NEEDS_LIVE_TIMING: ReadonlySet<FocusAction['kind']> = new Set(['start', 'resume', 'start_break'])

/** Typed rejections are certain; only a storage/transport failure may or may not have committed. */
const isUncertain = (error: FocusRequestError) => error.code === 'storage'

const PENDING_MESSAGE = 'Still saving the previous focus change.'

/** True for a repeat that was dropped because an action was still in flight (nothing was sent). */
export function isDroppedRepeat(error: unknown): boolean {
  return error instanceof FocusRequestError && error.code === 'conflict' && error.message === PENDING_MESSAGE
}

function newCommandId(): string {
  return globalThis.crypto.randomUUID()
}

/** Build the envelope once from the latest snapshot; retries reuse it unchanged. */
function buildCommand(snapshot: FocusSnapshot, action: FocusAction): FocusCommand {
  return {
    command_id: newCommandId(),
    expected_engine_revision: snapshot.engine_revision,
    expected_queue_revision: snapshot.queue_revision,
    owner_epoch: snapshot.owner_epoch,
    process_generation: snapshot.process_generation,
    session_id: snapshot.session?.id ?? null,
    action,
  }
}

function unsupported(capabilities: FocusCapabilities, action: FocusAction): FocusRequestError | null {
  const reason = capabilities.reason ?? 'This focus action is not available here.'
  if (!capabilities.queue_write) return new FocusRequestError('unsupported', reason)
  if (NEEDS_LIVE_TIMING.has(action.kind) && !capabilities.live_timing) return new FocusRequestError('unsupported', reason)
  return null
}

/**
 * Send one focus action through the provider. The envelope is built once
 * from the latest snapshot; capability gating happens before any call.
 */
export async function sendFocusAction(action: FocusAction): Promise<FocusReply> {
  // One action at a time: a repeat click while the last one is in flight is
  // dropped (typed, but not surfaced) instead of sent as a second intent.
  if (useFocusCache.getState().pending) throw new FocusRequestError('conflict', PENDING_MESSAGE)
  if (!useFocusCache.getState().snapshot || !useFocusCache.getState().capabilities) await refreshFocus()
  const { snapshot, capabilities, error: loadError } = useFocusCache.getState()
  if (!snapshot || !capabilities) {
    throw loadError ?? new FocusRequestError('not_found', 'Focus is not loaded yet.')
  }
  const blocked = unsupported(capabilities, action)
  if (blocked) {
    useFocusCache.setState({ error: blocked })
    throw blocked
  }
  return submit(buildCommand(snapshot, action), true)
}

/**
 * "Try again" after an uncertain failure: resubmits the failed envelope
 * unchanged (`error.command`, same command_id), so the service replays a
 * committed result instead of running a second intent. Never mint a new
 * command for a retry — that would be a new skip/complete/enqueue.
 */
export function retryFocusCommand(command: FocusCommand): Promise<FocusReply> {
  return submit(command, false)
}

/**
 * Execute one envelope. An uncertain failure (storage/transport) may have
 * committed, so it is retried with the SAME envelope when `autoRetry`.
 * A reply is applied only if not older than what this window shows; a reply
 * from a new owner epoch forces a full read. Any failure except a local
 * `unsupported`/`invalid` is followed by a full read that keeps the error
 * visible, so the cache catches up with a command that did commit and a
 * storage failure's `recovery_reason` surfaces.
 */
async function submit(command: FocusCommand, autoRetry: boolean): Promise<FocusReply> {
  const dp = getDataProvider()
  const { action } = command
  useFocusCache.setState({ pending: action, error: null })
  try {
    let reply: FocusReply
    try {
      reply = await dp.focus.execute(command)
    } catch (first) {
      const error = FocusRequestError.from(first, command)
      if (!autoRetry || !isUncertain(error)) throw error
      reply = await dp.focus.execute(command)
    }
    const current = useFocusCache.getState().snapshot
    if (!applySnapshot(reply.snapshot, 'reply') && current && current.owner_epoch !== reply.snapshot.owner_epoch) {
      void refreshFocus()
    }
    return reply
  } catch (raw) {
    const error = FocusRequestError.from(raw, command)
    useFocusCache.setState({ error })
    if (error.code !== 'unsupported' && error.code !== 'invalid') void readFull(false)
    throw error
  } finally {
    if (useFocusCache.getState().pending === action) useFocusCache.setState({ pending: null })
  }
}

// ── Entry points (task rows, multi-select, command bar, shortcuts) ──

/** Multi-select default: append the tasks in selection order; nothing starts. */
export async function enqueueTasks(taskIds: string[], source: FocusSource): Promise<FocusReply | null> {
  const action = enqueueSelectionAction(taskIds, source)
  return action ? sendFocusAction(action) : null
}

/** Whether "Focus now" can run here; null = allowed, else the visible reason. */
export function focusNowBlockedReason(capabilities: FocusCapabilities | null): string | null {
  if (!capabilities) return 'Focus is still loading.'
  return unsupported(capabilities, { kind: 'start', occurrence_id: '' })?.message ?? null
}

/**
 * "Focus now": one explicit user gesture that appends the task when needed
 * and starts it (the engine settles any running task and moves this one
 * first). Refused before any write when live timing is unavailable, so a
 * blocked Focus now never leaves a half-done queue change behind.
 */
export async function focusNow(taskId: string, source: FocusSource): Promise<FocusReply> {
  if (!useFocusCache.getState().snapshot || !useFocusCache.getState().capabilities) await refreshFocus()
  const { snapshot, capabilities } = useFocusCache.getState()
  const reason = focusNowBlockedReason(capabilities)
  if (reason || !snapshot) throw new FocusRequestError('unsupported', reason ?? 'Focus is not loaded yet.')
  const plan = focusNowPlan(snapshot, taskId, source)
  let start = plan.start
  if (plan.enqueue) {
    const reply = await sendFocusAction(plan.enqueue)
    start = startActionFor(reply.snapshot, taskId)
    if (!start) throw new FocusRequestError('not_found', 'That task could not be added to the focus queue.')
  }
  return sendFocusAction(start as FocusAction)
}

/** What Space does right now: pause a running session, else null — Space never starts or resumes. */
export function focusSpaceAction(): FocusAction | null {
  return spaceKeyAction(useFocusCache.getState().snapshot)
}
