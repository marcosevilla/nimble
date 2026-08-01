import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'dialkit/styles.css'
import App from './App.tsx'
import { CaptureStrip } from '@/components/shared/CaptureStrip'
import { createTauriProvider } from '@/services/tauri-provider'
import { DataProviderRoot, setDataProvider } from '@/services/provider-context'
import { useAppStore } from '@/stores/appStore'

// DEV-only: expose stores on window so the audit-loop Playwright session can
// bypass onboarding (no Tauri runtime in a plain browser → invoke() throws →
// SetupDialog blocks the UI). See daily-triage/docs/audit-loop-playbook.md.
if (import.meta.env.DEV) {
  ;(window as unknown as { __stores: unknown }).__stores = { useAppStore }
}

// Initialize the DataProvider before anything renders.
// setDataProvider() makes it available to Zustand stores (non-React code).
// <DataProviderRoot> makes it available to React hooks via useDataProvider().
const tauriProvider = createTauriProvider()
setDataProvider(tauriProvider)

// The frameless quick-capture window loads the same bundle with ?window=capture
// and renders only the capture strip (see tauri.conf.json "capture" window)
const isCaptureWindow =
  new URLSearchParams(window.location.search).get('window') === 'capture'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProviderRoot provider={tauriProvider}>
      {isCaptureWindow ? <CaptureStrip /> : <App />}
    </DataProviderRoot>
  </StrictMode>,
)
