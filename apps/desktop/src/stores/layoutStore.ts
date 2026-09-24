import { create } from 'zustand'
import { getDataProvider } from '@/services/provider-context'
import { DEFAULT_NAV_ORDER, normalizeNavOrder } from '@/lib/navTargets'

// Nav sidebar defaults (from NavSidebar.tsx). Labeled by default; the
// Tasks and Docs trees live under their nav buttons (Agentation pass 2).
export const NAV_MIN_WIDTH = 48 // icon-only
export const NAV_DEFAULT_WIDTH = 240
export const NAV_MAX_WIDTH = 360

// Nav trees nested under a nav button
export type NavTreeId = 'tasks' | 'docs'
const NAV_TREES_KEY = 'nimble.navTrees'

function loadNavTrees(): Record<NavTreeId, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(NAV_TREES_KEY) ?? 'null')
    if (saved && typeof saved === 'object') return { tasks: saved.tasks === true, docs: saved.docs === true }
  } catch {
    // Storage unavailable or malformed
  }
  return { tasks: false, docs: false }
}

// Right sidebar defaults (from RightSidebar.tsx)
const RIGHT_DEFAULT_WIDTH = 288 // w-72

// Default nav order — page IDs in display order (lib/navTargets owns it)
export { DEFAULT_NAV_ORDER }
export type NavPageId = (typeof DEFAULT_NAV_ORDER)[number]

// Right column tabs, in display order
export const RIGHT_TABS = ['calendar', 'habits', 'activity', 'focus'] as const
export type RightTab = (typeof RIGHT_TABS)[number]
const RIGHT_TAB_KEY = 'nimble.rightTab'

function loadRightTab(): RightTab {
  try {
    const saved = localStorage.getItem(RIGHT_TAB_KEY)
    if (saved && (RIGHT_TABS as readonly string[]).includes(saved)) return saved as RightTab
  } catch {
    // Storage unavailable — fall back to the calendar
  }
  return 'calendar'
}

interface LayoutState {
  // Left nav sidebar
  navWidth: number
  /** Width to restore when the icon-only nav expands again. */
  navExpandedWidth: number
  setNavWidth: (w: number) => void
  /** Icon-only (true) or labeled at the last expanded width (false). */
  setNavCollapsed: (v: boolean) => void
  navTrees: Record<NavTreeId, boolean>
  setNavTreeOpen: (id: NavTreeId, open: boolean) => void

  // Nav icon ordering
  navOrder: string[]
  setNavOrder: (order: string[]) => void
  loadNavOrder: () => Promise<void>
  saveNavOrder: (order: string[]) => Promise<void>

  // Right sidebar (global, shared across pages)
  rightWidth: number
  rightCollapsed: boolean
  setRightWidth: (w: number) => void
  setRightCollapsed: (v: boolean) => void
  rightTab: RightTab
  setRightTab: (tab: RightTab) => void
  /** Show a tab, expanding the column if it is collapsed. */
  openRightTab: (tab: RightTab) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  navWidth: NAV_DEFAULT_WIDTH,
  navExpandedWidth: NAV_DEFAULT_WIDTH,
  setNavWidth: (w) => set(w > NAV_MIN_WIDTH ? { navWidth: w, navExpandedWidth: w } : { navWidth: w }),
  setNavCollapsed: (v) =>
    set((s) => ({ navWidth: v ? NAV_MIN_WIDTH : Math.max(s.navExpandedWidth, 160) })),
  navTrees: loadNavTrees(),
  setNavTreeOpen: (id, open) =>
    set((s) => {
      const navTrees = { ...s.navTrees, [id]: open }
      try {
        localStorage.setItem(NAV_TREES_KEY, JSON.stringify(navTrees))
      } catch {
        // Remembered for this session only
      }
      return { navTrees }
    }),

  navOrder: [...DEFAULT_NAV_ORDER],
  setNavOrder: (order) => set({ navOrder: order }),
  loadNavOrder: async () => {
    try {
      const dp = getDataProvider()
      const saved = await dp.settings.get('nav_order')
      if (saved) {
        // Drops retired ids (the old `session` Activity page), duplicates and
        // anything unknown; appends pages added since the order was saved.
        set({ navOrder: normalizeNavOrder(JSON.parse(saved)) })
      }
    } catch {
      // Use default order on any error
    }
  },
  saveNavOrder: async (order) => {
    set({ navOrder: order })
    try {
      const dp = getDataProvider()
      await dp.settings.set('nav_order', JSON.stringify(order))
    } catch {
      // Silent fail — order is still in memory
    }
  },

  rightWidth: RIGHT_DEFAULT_WIDTH,
  rightCollapsed: false,
  setRightWidth: (w) => set({ rightWidth: w }),
  setRightCollapsed: (v) => set({ rightCollapsed: v }),
  rightTab: loadRightTab(),
  setRightTab: (tab) => {
    set({ rightTab: tab })
    try {
      localStorage.setItem(RIGHT_TAB_KEY, tab)
    } catch {
      // Remembered for this session only
    }
  },
  openRightTab: (tab) => {
    useLayoutStore.getState().setRightTab(tab)
    set({ rightCollapsed: false })
  },
}))
