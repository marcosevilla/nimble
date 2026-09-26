/** Settings → Sync's "Last synced": one human, local timestamp, whichever
 *  stamp backs it — `turso_last_completed_at` (RFC 3339 with an offset and
 *  fractional seconds) or the older pull watermark (ISO with `Z`). A bare
 *  SQLite `YYYY-MM-DD HH:MM:SS` is UTC. Anything unparseable is shown as is.
 *  (A shared lib/format.ts comes with a later design chunk.) */
export function formatSyncTime(raw: string, now: Date = new Date()): string {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return raw
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
  return `${date}, ${time}`
}
