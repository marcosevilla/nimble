export type SyncHealth = 'ok' | 'off' | 'stale' | 'error'

const STALE_MS = 60 * 60 * 1000

export interface SyncHealthInput {
  enabled: boolean
  last_sync_at: string | null
  last_error: string | null
}

/**
 * Derives the sync health banner state from Todoist sync status.
 * `last_sync_at` is SQLite localtime "YYYY-MM-DD HH:MM:SS".
 * Priority: off (disabled) > error (last push/pull rejected) > stale
 * (no successful sync yet, or none within the last hour) > ok.
 */
export function syncHealth(s: SyncHealthInput, now: Date): SyncHealth {
  if (!s.enabled) return 'off'
  if (s.last_error) return 'error'
  if (!s.last_sync_at) return 'stale'
  const last = new Date(s.last_sync_at.replace(' ', 'T'))
  return now.getTime() - last.getTime() > STALE_MS ? 'stale' : 'ok'
}
