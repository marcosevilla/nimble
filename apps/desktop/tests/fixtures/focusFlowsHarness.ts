// Bundled by tests/focusFlows.test.mjs (Vite SSR) so the focus store, its
// entry-point orchestration and the provider accessor share one module
// instance, like the running app.
export { useFocusCache, refreshFocus, sendFocusAction, resetFocusCache, focusNow, enqueueTasks, focusSpaceAction } from '../../src/stores/focusStore'
export { useFocusSurface } from '../../src/stores/focusSurfaceStore'
export { setDataProvider } from '../../src/services/provider-context'
