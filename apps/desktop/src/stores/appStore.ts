import { create } from 'zustand'
import type { CalendarEvent } from '@daily-triage/types'

export type Page = 'today' | 'tasks' | 'inbox' | 'docs' | 'goals' | 'session' | 'settings'

interface AppState {
  // Setup
  setupComplete: boolean | null
  setSetupComplete: (v: boolean) => void

  // Navigation
  currentPage: Page
  setCurrentPage: (page: Page) => void

  // Data
  calendarEvents: CalendarEvent[]
  setCalendarEvents: (events: CalendarEvent[]) => void

  obsidianToday: string | null
  setObsidianToday: (content: string | null) => void

  // Quick capture trigger (from tray)
  captureRequested: boolean
  setCaptureRequested: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  setupComplete: null,
  setSetupComplete: (v) => set({ setupComplete: v }),

  currentPage: 'today',
  setCurrentPage: (page) => set({ currentPage: page }),

  calendarEvents: [],
  setCalendarEvents: (events) => set({ calendarEvents: events }),

  obsidianToday: null,
  setObsidianToday: (content) => set({ obsidianToday: content }),

  captureRequested: false,
  setCaptureRequested: (v) => set({ captureRequested: v }),
}))
