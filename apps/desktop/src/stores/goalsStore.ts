import { create } from 'zustand'
import { getDataProvider } from '@/services/provider-context'
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
    set({ habitsLoading: true })
    try {
      const dp = getDataProvider()
      const habits = await dp.habits.list()
      set({ habits, habitsLoading: false })
    } catch {
      set({ habitsLoading: false })
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
