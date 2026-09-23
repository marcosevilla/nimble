/* First-run setup gate. These must match REQUIRED_SETTINGS in
   nimble-core/src/db/settings.rs: App.tsx re-runs check_setup_complete at
   every launch, so a setup that saves less than this reappears forever.
   tests/setupGate.test.mjs pins the two lists together. The calendar feed
   is optional (setup P1-4). */
export const SETUP_REQUIRED_KEYS = [
  'todoist_api_token',
  'obsidian_vault_path',
  'anthropic_api_key',
] as const

export function isSetupReady(values: Record<string, string | undefined>): boolean {
  return SETUP_REQUIRED_KEYS.every((key) => Boolean(values[key]?.trim()))
}
