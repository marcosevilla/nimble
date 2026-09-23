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
  LocalTask,
  TaskStatus,
} from '@nimble/types'

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
 * Send one focus action through the provider. The reply is applied only if
 * it is not older than what this window already shows; a reply from a new
 * owner epoch forces a full read. An uncertain failure is retried once with
 * the SAME envelope (same command_id) — never a new intent. A definite
 * rejection refreshes so the UI can ask the user to repeat the action.
 */
export async function sendFocusAction(action: FocusAction): Promise<FocusReply> {
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

  const dp = getDataProvider()
  const command = buildCommand(snapshot, action)
  useFocusCache.setState({ pending: action, error: null })
  const clearPending = () => {
    if (useFocusCache.getState().pending === action) useFocusCache.setState({ pending: null })
  }
  try {
    let reply: FocusReply
    try {
      reply = await dp.focus.execute(command)
    } catch (first) {
      const error = FocusRequestError.from(first, command)
      if (!isUncertain(error)) throw error
      reply = await dp.focus.execute((error.command as FocusCommand | undefined) ?? command)
    }
    const current = useFocusCache.getState().snapshot
    if (!applySnapshot(reply.snapshot, 'reply') && current && current.owner_epoch !== reply.snapshot.owner_epoch) {
      void refreshFocus()
    }
    return reply
  } catch (raw) {
    const error = FocusRequestError.from(raw, command)
    useFocusCache.setState({ error })
    if (!isUncertain(error) && error.code !== 'unsupported' && error.code !== 'invalid') void readFull(false)
    throw error
  } finally {
    clearPending()
  }
}

// ── Legacy single-task timer (compatibility only) ──
//
// @deprecated Kept compiling for the existing FocusView/FocusBanner/entry
// points until Tasks 7–8 move them onto `useFocusCache`; Task 8 deletes it.
// It is NOT focus authority: new code must use the cache above.

export type TimerMode = 'up' | 'down'

export interface FocusConfig {
  timerMode: TimerMode
  targetMinutes: number
  breakMinutes: number
  totalPomodoros: number
}

/** Exported for the `f` row shortcut (tasks audit P1-1), which starts a
 * session without the setup screen. */
export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  timerMode: 'down',
  targetMinutes: 25,
  breakMinutes: 5,
  totalPomodoros: 1,
}

interface FocusStore {
  // State
  isActive: boolean
  isPendingSetup: boolean // show setup screen
  taskId: string | null
  task: LocalTask | null
  config: FocusConfig
  startedAt: number | null // ms timestamp
  pausedAt: number | null // ms timestamp
  pausedElapsed: number // seconds accumulated before pause
  elapsed: number // total seconds
  isCompact: boolean
  isOnBreak: boolean
  breakStartedAt: number | null
  breakElapsed: number
  currentPomodoro: number
  showCelebration: boolean
  completedDuration: number | null
  nextTask: LocalTask | null
  queue: LocalTask[] // tasks lined up after the current one

  // Actions
  beginSetup: (task: LocalTask) => void
  startFocus: (task: LocalTask, config: FocusConfig, queue?: LocalTask[]) => void
  pauseFocus: () => void
  resumeFocus: () => void
  completeFocus: (nextTask?: LocalTask | null) => void
  abandonFocus: () => void
  skipFocus: () => void
  setCompact: (compact: boolean) => void
  tick: () => void
  startBreak: () => void
  endBreak: () => void
  /** Enter: start the next queued task now (or end if there is none). */
  dismissCelebration: () => void
  /** Escape / click: end the session; never starts anything (session P1-2). */
  endCelebration: () => void
  reset: () => void
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  isActive: false,
  isPendingSetup: false,
  taskId: null,
  task: null,
  config: DEFAULT_FOCUS_CONFIG,
  startedAt: null,
  pausedAt: null,
  pausedElapsed: 0,
  elapsed: 0,
  isCompact: false,
  isOnBreak: false,
  breakStartedAt: null,
  breakElapsed: 0,
  currentPomodoro: 1,
  showCelebration: false,
  completedDuration: null,
  nextTask: null,
  queue: [],

  beginSetup: (task) => {
    set({
      isPendingSetup: true,
      task,
      taskId: task.id,
      config: DEFAULT_FOCUS_CONFIG,
    })
  },

  startFocus: (task, config, queue = []) => {
    const dp = getDataProvider()
    dp.focus.startSession(task.id, task.content).catch(() => {})
    dp.tasks.updateStatus(task.id, 'in_progress').catch(() => {})
    set({
      isActive: true,
      isPendingSetup: false,
      taskId: task.id,
      task,
      config,
      startedAt: Date.now(),
      pausedAt: null,
      pausedElapsed: 0,
      elapsed: 0,
      isCompact: false,
      isOnBreak: false,
      breakStartedAt: null,
      breakElapsed: 0,
      currentPomodoro: 1,
      showCelebration: false,
      completedDuration: null,
      nextTask: null,
      queue,
    })
  },

  pauseFocus: () => {
    const { startedAt, pausedElapsed } = get()
    if (!startedAt) return
    const now = Date.now()
    const currentElapsed = pausedElapsed + Math.floor((now - startedAt) / 1000)
    set({ pausedAt: now, pausedElapsed: currentElapsed })
  },

  resumeFocus: () => {
    set({ startedAt: Date.now(), pausedAt: null })
  },

  completeFocus: (nextTask) => {
    const dp = getDataProvider()
    const { taskId, task, elapsed, queue } = get()
    if (taskId) {
      dp.tasks.updateStatus(taskId, 'complete', undefined, task?.id === taskId ? task.due_date : undefined).catch(() => {})
      dp.focus.endSession(taskId, 'focus_completed', elapsed).catch(() => {})
    }
    // If no explicit next task was passed, pull the next one from the queue.
    let resolvedNext: LocalTask | null = nextTask ?? null
    let newQueue = queue
    if (!resolvedNext && queue.length > 0) {
      resolvedNext = queue[0]
      newQueue = queue.slice(1)
    }
    set({
      showCelebration: true,
      completedDuration: elapsed,
      nextTask: resolvedNext,
      queue: newQueue,
    })
  },

  abandonFocus: async () => {
    const dp = getDataProvider()
    const { taskId, elapsed } = get()
    if (taskId) {
      dp.focus.endSession(taskId, 'focus_abandoned', elapsed).catch(() => {})
      // Set status based on setting (default: todo)
      const abandonStatus = await dp.settings.get('focus_abandon_status').catch(() => null)
      const status: TaskStatus = (abandonStatus === 'in_progress' ? 'in_progress' : 'todo')
      dp.tasks.updateStatus(taskId, status).catch(() => {})
    }
    get().reset()
  },

  skipFocus: () => {
    const dp = getDataProvider()
    const { taskId, elapsed } = get()
    if (taskId) {
      dp.focus.endSession(taskId, 'focus_skipped', elapsed).catch(() => {})
    }
    get().reset()
  },

  setCompact: (compact) => set({ isCompact: compact }),

  tick: () => {
    const { startedAt, pausedAt, pausedElapsed, isOnBreak, breakStartedAt } = get()
    if (isOnBreak && breakStartedAt) {
      set({ breakElapsed: Math.floor((Date.now() - breakStartedAt) / 1000) })
      return
    }
    if (!startedAt || pausedAt) return
    set({ elapsed: pausedElapsed + Math.floor((Date.now() - startedAt) / 1000) })
  },

  startBreak: () => {
    set({ isOnBreak: true, breakStartedAt: Date.now(), breakElapsed: 0 })
  },

  endBreak: () => {
    const { currentPomodoro } = get()
    set({
      isOnBreak: false,
      breakStartedAt: null,
      breakElapsed: 0,
      currentPomodoro: currentPomodoro + 1,
      startedAt: Date.now(),
      pausedAt: null,
      pausedElapsed: 0,
      elapsed: 0,
    })
  },

  dismissCelebration: () => {
    const { nextTask, config, queue } = get()
    if (nextTask) {
      // Start the next queued task immediately with the same config —
      // don't send the user back through the setup screen mid-queue.
      set({ showCelebration: false, completedDuration: null, nextTask: null })
      get().startFocus(nextTask, config, queue)
    } else {
      get().reset()
    }
  },

  endCelebration: () => {
    get().reset()
  },

  reset: () => {
    set({
      isActive: false,
      isPendingSetup: false,
      taskId: null,
      task: null,
      config: DEFAULT_FOCUS_CONFIG,
      startedAt: null,
      pausedAt: null,
      pausedElapsed: 0,
      elapsed: 0,
      isCompact: false,
      isOnBreak: false,
      breakStartedAt: null,
      breakElapsed: 0,
      currentPomodoro: 1,
      showCelebration: false,
      completedDuration: null,
      nextTask: null,
      queue: [],
    })
  },
}))
