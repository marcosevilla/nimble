import { create } from 'zustand'
import type { CalendarEvent } from '@nimble/types'
import type { Page } from '@/lib/navTargets'

export type { Page }

interface AppState {
  // Navigation
  currentPage: Page
  setCurrentPage: (page: Page) => void

  // Data
  calendarEvents: CalendarEvent[]
  setCalendarEvents: (events: CalendarEvent[]) => void

  // Quick capture trigger (from tray)
  captureRequested: boolean
  setCaptureRequested: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'today',
  setCurrentPage: (page) => set({ currentPage: page }),

  calendarEvents: [],
  setCalendarEvents: (events) => set({ calendarEvents: events }),

  captureRequested: false,
  setCaptureRequested: (v) => set({ captureRequested: v }),
}))
