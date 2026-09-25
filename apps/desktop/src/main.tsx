import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'dialkit/styles.css'
import App from './App.tsx'
import { CaptureStrip } from '@/components/shared/CaptureStrip'
import { FocusCompanion } from '@/components/focus/FocusCompanion'
import { createCompanionWindow } from '@/services/focusCompanionWindow'
import { createTauriProvider } from '@/services/tauri-provider'
import { DataProviderRoot, setDataProvider } from '@/services/provider-context'
import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { navigateTo, useSettingsNavStore } from '@/stores/settingsNavStore'

// DEV-only: expose stores on window so the audit-loop Playwright session can
// deep-link pages (no Tauri runtime in a plain browser, so the mock drives
// the app). See nimble/docs/audit-loop-playbook.md.
// detail/selection stores let capture scripts open the task detail page and
// the inline task composer card deterministically.
if (import.meta.env.DEV) {
  ;(window as unknown as { __stores: unknown }).__stores = { useAppStore, useDetailStore, useSelectionStore, useSettingsNavStore, navigateTo }
}

// Initialize the DataProvider before anything renders.
// setDataProvider() makes it available to Zustand stores (non-React code).
// <DataProviderRoot> makes it available to React hooks via useDataProvider().
const tauriProvider = createTauriProvider()
setDataProvider(tauriProvider)

// The frameless quick-capture window loads the same bundle with ?window=capture
// and renders only the capture strip (see tauri.conf.json "capture" window).
// The always-on-top focus companion loads ?window=focus and renders only the
// shared focus card/queue; <DataProviderRoot> gives it the same event bridge.
const windowKind = new URLSearchParams(window.location.search).get('window')

const root =
  windowKind === 'capture' ? <CaptureStrip />
  : windowKind === 'focus' ? <FocusCompanion windowApi={createCompanionWindow()} />
  : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProviderRoot provider={tauriProvider}>
      {root}
    </DataProviderRoot>
  </StrictMode>,
)
