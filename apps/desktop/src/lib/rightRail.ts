import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import { useLayoutStore } from '@/stores/layoutStore'

/** Pages that give the full width to their content and show no right column. */
export function pageHidesRightRail(page: string): boolean {
  return page === 'settings' || page === 'session'
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
