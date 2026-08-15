/**
 * Stable per-browser device identity for the web build.
 *
 * Every `sync_log` row carries the id of the device that wrote it, and the
 * desktop pull filters on `device_id != <its own>` (nimble-core/src/db/sync.rs).
 * That filter is the reason this matters more than it looks: if the web client
 * ever presented the Mac's device id, the Mac would discard every web-originated
 * change — silently, with no error and no missing-data symptom until something
 * you typed on your phone simply wasn't there.
 *
 * Namespacing keeps that impossible. Desktop writes a bare UUID v4, mobile writes
 * `mobile-<8 hex>`, and this writes `web-<8 hex>` — the prefix alone guarantees
 * no overlap with the desktop id space regardless of what the random half does.
 *
 * Desktop persists its id in the `settings` table. That route is closed here:
 * `settings` is deliberately absent from the proxy's allow-list (api/turso.ts)
 * because it never syncs, so the browser cannot read or write it. localStorage is
 * the web equivalent — per-origin, per-browser, and survives reloads.
 *
 * Consequence worth knowing: clearing site data mints a NEW device id. That is
 * harmless. Ids are only ever compared for inequality, never resolved back to a
 * device, so an extra one costs nothing beyond a row in `sync_log` attributed to
 * a device that no longer exists.
 */

const STORAGE_KEY = 'nimble.web.deviceId'

/** `web-` + 8 hex chars, matching mobile's `<prefix>-<8 hex>` shape. */
function mintDeviceId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `web-${hex}`
}

/**
 * Cached for the lifetime of the page so a write path never depends on
 * localStorage being readable more than once.
 */
let cached: string | null = null

/**
 * The id for this browser, minted and persisted on first call.
 *
 * localStorage access is wrapped because it throws rather than returning null in
 * a few real situations — Safari private browsing historically, and any embedding
 * that blocks storage. Falling back to an in-memory id keeps writes working for
 * the session instead of failing the mutation outright; the cost is that the next
 * page load looks like a different device, which sync tolerates.
 */
export function getDeviceId(): string {
  if (cached) return cached

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      cached = stored
      return stored
    }
    const minted = mintDeviceId()
    localStorage.setItem(STORAGE_KEY, minted)
    cached = minted
    return minted
  } catch {
    cached = mintDeviceId()
    return cached
  }
}
