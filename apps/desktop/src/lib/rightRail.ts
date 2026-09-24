import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import { useLayoutStore } from '@/stores/layoutStore'

/** Pages that give the full width to their content and show no right column. */
export function pageHidesRightRail(page: string): boolean {
  return page === 'settings'
}

/** The tabbed right column is on screen (not replaced by a detail sidebar). */
function rightRailShown(): boolean {
  if (pageHidesRightRail(useAppStore.getState().currentPage)) return false
  const detail = useDetailStore.getState()
  return !(detail.target && detail.mode === 'sidebar')
}

/**
 * Open the focus queue: the right column's Focus tab where the column is
 * shown, otherwise the full focus view. Presentation only — starts nothing.
 */
export function openFocusQueue(): void {
  if (rightRailShown()) {
    useFocusSurface.getState().setExpanded(false)
    useLayoutStore.getState().openRightTab('focus')
  } else {
    useFocusSurface.getState().setExpanded(true)
  }
}

/** ⇧F: open the focus queue, or close it if it is already showing. */
export function toggleFocusQueue(): void {
  const surface = useFocusSurface.getState()
  if (surface.expanded) {
    surface.setExpanded(false)
    return
  }
  const layout = useLayoutStore.getState()
  if (rightRailShown() && layout.rightTab === 'focus' && !layout.rightCollapsed) {
    layout.setRightCollapsed(true)
    return
  }
  openFocusQueue()
}

/**
 * ⇧H: show today's habits in the right column, or hide the column if the
 * Habits tab is already showing. Where the column isn't on screen it is
 * brought back first: Settings switches to Today — syncing the
 * detail store to that switch (as Dashboard.tsx's own page-change effect
 * does) so a sidebar-mode detail saved for Today is seen and closed below
 * instead of rendering over the tab on the next page-change effect — and
 * an open detail sidebar closes (as Escape would).
 */
export function toggleHabits(): void {
  const layout = useLayoutStore.getState()
  const hidden = pageHidesRightRail(useAppStore.getState().currentPage)
  if (hidden) {
    useAppStore.getState().setCurrentPage('today')
    useDetailStore.getState().syncToPage('today')
  }
  const detail = useDetailStore.getState()
  if (detail.target && detail.mode === 'sidebar') {
    detail.close()
    layout.openRightTab('habits')
    return
  }
  if (!hidden && layout.rightTab === 'habits' && !layout.rightCollapsed) {
    layout.setRightCollapsed(true)
    return
  }
  layout.openRightTab('habits')
}
