import { create } from 'zustand'
import type { Page } from './appStore'

export type DetailMode = 'body' | 'sidebar'
export type DetailType = 'task' | 'capture' | 'doc' | 'goal'

export interface DetailTarget {
  type: DetailType
  id: string
}

interface PageDetailState {
  target: DetailTarget | null
  mode: DetailMode
  breadcrumbs: DetailTarget[]
}

function emptyPageState(): PageDetailState {
  return { target: null, mode: 'body', breadcrumbs: [] }
}

interface DetailStore {
  // Per-page detail states
  pageDetails: Record<Page, PageDetailState>

  // Which page is "current" (updated via syncToPage)
  currentPage: Page

  // Convenience: current page's detail state (derived from pageDetails + currentPage)
  target: DetailTarget | null
  mode: DetailMode
  breadcrumbs: DetailTarget[]

  // Actions — operate on current page
  openTask: (taskId: string, mode?: DetailMode) => void
  openCapture: (captureId: string, mode?: DetailMode) => void
  openDoc: (docId: string, mode?: DetailMode) => void
  openGoal: (goalId: string, mode?: DetailMode) => void
  switchMode: (mode: DetailMode) => void
  drillDown: (target: DetailTarget) => void
  navigateUp: (index?: number) => void
  close: () => void

  // Called by Dashboard when page changes — updates the "current" view
  syncToPage: (page: Page) => void
}

const ALL_PAGES: Page[] = ['today', 'tasks', 'inbox', 'docs', 'goals', 'session', 'settings']

function buildInitialPageDetails(): Record<Page, PageDetailState> {
  const details = {} as Record<Page, PageDetailState>
  for (const page of ALL_PAGES) {
    details[page] = emptyPageState()
  }
  return details
}

// Helper to update the current page's state and sync convenience fields
function updateCurrentPage(
  get: () => DetailStore,
  set: (partial: Partial<DetailStore>) => void,
  updater: (state: PageDetailState) => PageDetailState,
) {
  const { currentPage, pageDetails } = get()
  const updated = updater(pageDetails[currentPage])
  set({
    pageDetails: { ...pageDetails, [currentPage]: updated },
    target: updated.target,
    mode: updated.mode,
    breadcrumbs: updated.breadcrumbs,
  })
}

export const useDetailStore = create<DetailStore>((set, get) => ({
  pageDetails: buildInitialPageDetails(),
  currentPage: 'today',

  target: null,
  mode: 'body',
  breadcrumbs: [],

  openTask: (taskId, mode = 'body') => {
    updateCurrentPage(get, set, () => ({
      target: { type: 'task', id: taskId },
      mode,
      breadcrumbs: [],
    }))
  },

  openCapture: (captureId, mode = 'body') => {
    updateCurrentPage(get, set, () => ({
      target: { type: 'capture', id: captureId },
      mode,
      breadcrumbs: [],
    }))
  },

  openDoc: (docId, mode = 'body') => {
    updateCurrentPage(get, set, () => ({
      target: { type: 'doc', id: docId },
      mode,
      breadcrumbs: [],
    }))
  },

  openGoal: (goalId, mode = 'body') => {
    updateCurrentPage(get, set, () => ({
      target: { type: 'goal', id: goalId },
      mode,
      breadcrumbs: [],
    }))
  },

  switchMode: (mode) => {
    updateCurrentPage(get, set, (state) => ({ ...state, mode }))
  },

  drillDown: (newTarget) => {
    updateCurrentPage(get, set, (state) => {
      if (!state.target) return state
      return {
        ...state,
        breadcrumbs: [...state.breadcrumbs, state.target],
        target: newTarget,
      }
    })
  },

  navigateUp: (index) => {
    updateCurrentPage(get, set, (state) => {
      if (state.breadcrumbs.length === 0) {
        return emptyPageState()
      }
      if (index !== undefined && index >= 0 && index < state.breadcrumbs.length) {
        return {
          ...state,
          target: state.breadcrumbs[index],
          breadcrumbs: state.breadcrumbs.slice(0, index),
        }
      }
      const parent = state.breadcrumbs[state.breadcrumbs.length - 1]
      return {
        ...state,
        target: parent,
        breadcrumbs: state.breadcrumbs.slice(0, -1),
      }
    })
  },

  close: () => {
    updateCurrentPage(get, set, () => emptyPageState())
  },

  syncToPage: (page) => {
    const { pageDetails } = get()
    const pageState = pageDetails[page]
    set({
      currentPage: page,
      target: pageState.target,
      mode: pageState.mode,
      breadcrumbs: pageState.breadcrumbs,
    })
  },
}))
