/**
 * Web entry point — the browser build target.
 *
 * The desktop counterpart is `main.tsx`. These two files are the ONLY place
 * the two targets differ: same `src/`, same component tree, different
 * DataProvider. If you find yourself adding a second difference, put it behind
 * the provider seam instead — that seam is the reason a UI change reaches both
 * builds without being ported (docs/web-client-architecture-decision.md §2).
 *
 * Deliberately absent versus main.tsx:
 *  - The `?window=capture` branch. The frameless ⌥⌘Space capture strip is a
 *    global hotkey plus an always-on-top native window; none of it exists in a
 *    browser (§5, OUT permanently).
 *  - `createTauriProvider()`. Replaced by `createTursoProvider()`.
 *
 * The `@tauri-apps/api/*` imports elsewhere in the tree are not a problem here:
 * `vite.web.config.ts` aliases them to no-op stubs in `src/platform/`, so the
 * ~6 component files that use them build unmodified.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'dialkit/styles.css'
import App from './App.tsx'
import { createTursoProvider } from '@/services/turso-provider'
import { DataProviderRoot, setDataProvider } from '@/services/provider-context'
import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { useSelectionStore } from '@/stores/selectionStore'

// DEV-only: same store hatch as main.tsx, so the Playwright audit loop can
// drive the web build the same way it drives the desktop one.
// See nimble/docs/audit-loop-playbook.md.
if (import.meta.env.DEV) {
  ;(window as unknown as { __stores: unknown }).__stores = { useAppStore, useDetailStore, useSelectionStore }
}

// Initialize the DataProvider before anything renders.
// setDataProvider() makes it available to Zustand stores (non-React code).
// <DataProviderRoot> makes it available to React hooks via useDataProvider().
const tursoProvider = createTursoProvider()
setDataProvider(tursoProvider)

// Web opens on Tasks, not Today. Today is the guided morning review, and it is
// built on calendar events and AI priorities — neither of which the web target
// can reach (§5: no local calendar feeds, no Anthropic key in the browser), so
// it would open on a page that is structurally empty here. Tasks is backed by
// the reads this build actually implements.
//
// Set on the store rather than changing its `currentPage` default, which is
// shared with the desktop build. Safe to do at boot because appStore is not
// persisted — this is a starting page, not an override of a remembered one.
useAppStore.getState().setCurrentPage('tasks')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProviderRoot provider={tursoProvider}>
      <App />
    </DataProviderRoot>
  </StrictMode>,
)
