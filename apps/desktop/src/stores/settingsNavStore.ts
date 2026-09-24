import { create } from 'zustand'
import { useAppStore } from '@/stores/appStore'
import { DEFAULT_SETTINGS_PAGE, settingsTarget, type SettingsPageId } from '@/lib/settingsSections'
import { resolveNavTarget } from '@/lib/navTargets'

// Which Settings sub-page is showing. Kept for the session (not persisted)
// so Cmd+, and `g ,` reopen the last one. `pendingSection` is a one-shot
// deep link: SettingsPage scrolls to it after the page renders, then clears it.
interface SettingsNavState {
  page: SettingsPageId
  pendingSection: string | null
  showPage: (page: SettingsPageId) => void
  clearPendingSection: () => void
}

export const useSettingsNavStore = create<SettingsNavState>((set) => ({
  page: DEFAULT_SETTINGS_PAGE,
  pendingSection: null,
  showPage: (page) => set({ page, pendingSection: null }),
  clearPendingSection: () => set({ pendingSection: null }),
}))

/** Open Settings on the page that holds `sectionId`, scrolled to it. */
export function openSettings(sectionId: string) {
  const { page, section } = settingsTarget(sectionId)
  useSettingsNavStore.setState({ page, pendingSection: section })
  useAppStore.getState().setCurrentPage('settings')
}

/** Go to a page by id — a page, or an id that redirects to one (`activity`
 *  and the retired `session` page open Settings → Activity). Returns false
 *  for an id that goes nowhere. */
export function navigateTo(id: string | null | undefined): boolean {
  const target = resolveNavTarget(id)
  if (!target) return false
  if (target.settingsPage) useSettingsNavStore.getState().showPage(target.settingsPage)
  useAppStore.getState().setCurrentPage(target.page)
  return true
}
