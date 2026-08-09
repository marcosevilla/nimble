import { create } from 'zustand'
import { getDataProvider } from '@/services/provider-context'
import type { LocalTask, TaskStatus } from '@nimble/types'

export type TimerMode = 'up' | 'down'

export interface FocusConfig {
  timerMode: TimerMode
  targetMinutes: number
  breakMinutes: number
  totalPomodoros: number
}

const DEFAULT_CONFIG: FocusConfig = {
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
  dismissCelebration: () => void
  reset: () => void
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  isActive: false,
  isPendingSetup: false,
  taskId: null,
  task: null,
  config: DEFAULT_CONFIG,
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
      config: DEFAULT_CONFIG,
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
    const { taskId, elapsed, queue } = get()
    if (taskId) {
      dp.tasks.updateStatus(taskId, 'complete').catch(() => {})
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

  reset: () => {
    set({
      isActive: false,
      isPendingSetup: false,
      taskId: null,
      task: null,
      config: DEFAULT_CONFIG,
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
