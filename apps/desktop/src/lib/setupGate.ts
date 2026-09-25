/* The first-run gate, emptied in brief phase 2 (addendum §3): nothing is
   required before the app runs; the Today setup is the onboarding.
   tests/setupGate.test.mjs pins this to REQUIRED_SETTINGS in
   nimble-core/src/db/settings.rs so neither list grows back alone. */
export const SETUP_REQUIRED_KEYS: readonly string[] = []
