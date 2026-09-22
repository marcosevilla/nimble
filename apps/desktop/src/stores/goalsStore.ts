import { create } from 'zustand'
import { getDataProvider } from '@/services/provider-context'
import { toggleHabitOptimistically, createHabitLoadGate } from '@/lib/habitToggle'

// Orders reloads against optimistic toggles so a stale list never lands
// over a newer flip (goals review minor 1).
const habitGate = createHabitLoadGate()
import type { GoalWithProgress, LifeArea, HabitWithStats } from '@nimble/types'

interface GoalsStore {
  goals: GoalWithProgress[]
  lifeAreas: LifeArea[]
  habits: HabitWithStats[]
  goalsLoading: boolean
  habitsLoading: boolean

  loadGoals: () => Promise<void>
  loadLifeAreas: () => Promise<void>
  loadHabits: () => Promise<void>
  /** Flip today_completed immediately, then log/unlog; rolls back and rethrows on failure (goals P1-3). */
  toggleHabit: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export const useGoalsStore = create<GoalsStore>((set, get) => ({
  goals: [],
  lifeAreas: [],
  habits: [],
  goalsLoading: true,
  habitsLoading: true,

  loadGoals: async () => {
    set({ goalsLoading: true })
    try {
      const dp = getDataProvider()
      const goals = await dp.goals.list()
      set({ goals, goalsLoading: false })
    } catch {
      set({ goalsLoading: false })
    }
  },

  loadLifeAreas: async () => {
    try {
      const dp = getDataProvider()
      const lifeAreas = await dp.goals.getLifeAreas()
      set({ lifeAreas })
    } catch { /* silently fail */ }
  },

  loadHabits: async () => {
    // Skeleton only on the very first load — a reload behind a check-off
    // must not unmount the circles (goals P1-3, §1.6).
    if (get().habits.length === 0) set({ habitsLoading: true })
    const ticket = habitGate.beginLoad()
    try {
      const dp = getDataProvider()
      const habits = await dp.habits.list()
      if (habitGate.canApply(ticket)) set({ habits, habitsLoading: false })
    } catch {
      if (habitGate.canApply(ticket)) set({ habitsLoading: false })
    }
  },

  toggleHabit: async (id) => {
    const dp = getDataProvider()
    const settle = habitGate.beginToggle()
    try {
      await toggleHabitOptimistically({
        habits: get().habits,
        id,
        write: (habits) => set({ habits }),
        read: () => get().habits,
        log: (habitId) => dp.habits.log(habitId),
        unlog: (habitId) => dp.habits.unlog(habitId),
      })
    } finally {
      settle()
      // Momentum and today_intensity come from the backend; the last toggle
      // to settle pulls them quietly (earlier reloads would be dropped anyway).
      if (habitGate.pending === 0) void get().loadHabits()
    }
  },

  refresh: async () => {
    await Promise.all([
      get().loadGoals(),
      get().loadLifeAreas(),
      get().loadHabits(),
    ])
  },
}))
