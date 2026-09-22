/* Human copy for settings failures (settings audit P2-16). Sibling of
   `backupMessage` in BackupSection and the Google code map — the raw
   Rust/invoke string never becomes the headline; it is kept as `detail`
   for a collapsed disclosure so the user can still forward it.

   Plain TS, no JSX — tests/settingsSections.test.mjs imports it directly. */

export interface SettingsFailure {
  /** Neutral, sentence-case line the user reads. */
  message: string
  /** The raw error text, for a collapsed "Details" disclosure. */
  detail: string | null
}

export const SETTINGS_FAILURE_DEFAULT = "That didn't save. Try again."

/* Substring → copy. Order matters: first match wins. Rust surfaces these
   as `format!("Turso test failed: {}")`-style strings, so matching on the
   stable prefix is the contract. */
const MESSAGES: readonly [pattern: string, message: string][] = [
  ['Turso test failed', "Nimble couldn't reach Turso with these details. Check the URL and token."],
  ['Turso client build failed', 'The Turso URL or token is not in a shape Nimble can use. Check both.'],
  ['Turso response parse failed', "Turso answered with something Nimble couldn't read. Try again."],
  ['Turso request failed', "Sync couldn't reach Turso. Check your connection and try again."],
  ['Turso pull failed', "Sync couldn't pull from Turso. Check your connection and try again."],
  ['WebNotImplementedError', 'This setting is managed on the desktop app.'],
  ['not configured', 'Set up the connection first.'],
  ['permission', "Nimble doesn't have permission for that. Check System Settings."],
]

function rawText(error: unknown): string | null {
  if (error == null) return null
  const text = error instanceof Error ? error.message : String(error)
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function settingsFailure(error: unknown): SettingsFailure {
  const detail = rawText(error)
  if (!detail) return { message: SETTINGS_FAILURE_DEFAULT, detail: null }
  const hit = MESSAGES.find(([pattern]) => detail.includes(pattern))
  return { message: hit ? hit[1] : SETTINGS_FAILURE_DEFAULT, detail }
}

/** Toast-friendly: just the headline. */
export function settingsMessage(error: unknown): string {
  return settingsFailure(error).message
}
