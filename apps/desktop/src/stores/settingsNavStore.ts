import { create } from 'zustand'
import { useAppStore } from '@/stores/appStore'
import { DEFAULT_SETTINGS_PAGE, settingsTarget, type SettingsPageId } from '@/lib/settingsSections'

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
