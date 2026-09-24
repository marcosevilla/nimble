/**
 * Phone quick capture: one POST puts a note in the Nimble Inbox.
 *
 * Why this exists: the iPhone Shortcut behind the Action button needs a single
 * request that works without a browser session. `/api/turso` sits behind the
 * cookie gate and takes raw SQL, so neither fits. This endpoint takes plain text,
 * authenticates with its own bearer token, and writes exactly one capture.
 *
 * The write mirrors `createCapture` in apps/desktop/src/services/turso/captures.ts
 * (itself a mirror of nimble-core/src/db/captures.rs): the captures INSERT plus
 * a `sync_log` entry in one BEGIN/COMMIT pipeline. The desktop pull reads
 * sync_log, not the table, so a capture without its sync_log row would never
 * reach the Mac. See apps/desktop/src/services/turso/mutations.ts for the rules
 * this follows (full-row snapshot, ISO sync timestamp, local-time row timestamp).
 *
 * Not mirrored, same as the web client: the `item_captured` activity_log entry.
 *
 * Request (from the Shortcut's "Get Contents of URL"):
 *   POST /api/capture
 *   Authorization: Bearer <CAPTURE_TOKEN>
 *   Content-Type: application/json
 *   { "text": "the thought" }
 * A `text/plain` body is accepted too.
 *
 * Environment (Vercel project settings, server-side only):
 *   TURSO_URL, TURSO_TOKEN  shared with api/turso.ts
 *   CAPTURE_TOKEN           the Shortcut's secret; unset = endpoint disabled
 *   CAPTURE_TZ              IANA zone for `created_at` (default America/Los_Angeles)
 *
 * middleware.ts exempts this path from the cookie gate — the token above is its
 * only protection, so it must stay long and random.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'

/** See api/turso.ts for why these are declared locally. */
interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

interface VercelResponse {
  status(code: number): VercelResponse
  setHeader(name: string, value: string): void
  json(body: unknown): void
  end(): void
}

/** Shows as "via iphone" on the capture's detail page. */
const SOURCE = 'iphone'

/** Every sync_log row needs a device id; the Mac pulls anything not its own. */
const DEVICE_ID = 'iphone-shortcut'

/** A thought, not a document. Stops a mis-shared file from landing in the Inbox. */
const MAX_LENGTH = 10_000

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length).trim())
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

/** Accepts `{ text }`, `{ content }` or a bare string body. */
function readText(body: unknown): string | null {
  if (typeof body === 'string') {
    try {
      return readText(JSON.parse(body))
    } catch {
      return body
    }
  }
  if (typeof body === 'object' && body !== null) {
    const { text, content } = body as { text?: unknown; content?: unknown }
    const value = text ?? content
    return typeof value === 'string' ? value : null
  }
  return null
}

/**
 * `YYYY-MM-DD HH:MM:SS` in the owner's zone. The function runs in UTC, and the
 * Mac writes `created_at` in local time (see `rowTimestamp` in mutations.ts), so
 * a UTC value here would sort ~7 hours into the future in the Inbox.
 */
function rowTimestamp(timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

const text = (value: string) => ({ type: 'text', value })
const nul = () => ({ type: 'null' })

/** See api/turso.ts: Node `(req, res)` signature only — a returned Response hangs. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const expected = process.env.CAPTURE_TOKEN
  const tursoUrl = process.env.TURSO_URL
  const tursoToken = process.env.TURSO_TOKEN
  if (!expected || !tursoUrl || !tursoToken) {
    res.status(500).json({ error: 'Server is missing CAPTURE_TOKEN / TURSO_URL / TURSO_TOKEN' })
    return
  }

  const auth = req.headers.authorization
  if (!tokenMatches(Array.isArray(auth) ? auth[0] : auth, expected)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const content = readText(req.body)?.trim()
  if (!content) {
    res.status(400).json({ error: 'Nothing to capture' })
    return
  }
  if (content.length > MAX_LENGTH) {
    res.status(413).json({ error: `Capture is over ${MAX_LENGTH} characters` })
    return
  }

  // Every key, nulls included: receivers apply this with INSERT OR REPLACE.
  const capture = {
    id: randomUUID(),
    content,
    source: SOURCE,
    converted_to_task_id: null,
    routed_to: null,
    context: null,
    created_at: rowTimestamp(process.env.CAPTURE_TZ || 'America/Los_Angeles'),
  }

  const statements = [
    { sql: 'BEGIN', args: [] },
    {
      sql: 'INSERT INTO captures (id, content, source, context, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [text(capture.id), text(capture.content), text(capture.source), nul(), text(capture.created_at)],
    },
    {
      sql:
        'INSERT INTO sync_log ' +
        '(id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
      args: [
        text(randomUUID()),
        text('captures'),
        text(capture.id),
        text('INSERT'),
        nul(),
        text(JSON.stringify(capture)),
        text(DEVICE_ID),
        text(new Date().toISOString()),
      ],
    },
    { sql: 'COMMIT', args: [] },
  ]

  const baseUrl = tursoUrl.trim().replace(/\/+$/, '').replace('libsql://', 'https://')

  let results: Array<{ type?: string; error?: { message?: string } }>
  try {
    const upstream = await fetch(`${baseUrl}/v2/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tursoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [...statements.map((stmt) => ({ type: 'execute', stmt })), { type: 'close' }],
      }),
    })
    if (!upstream.ok) {
      res.status(502).json({ error: `Turso answered ${upstream.status}` })
      return
    }
    results = ((await upstream.json()) as { results?: typeof results }).results ?? []
  } catch (err) {
    res.status(502).json({ error: `Upstream request failed: ${(err as Error).message}` })
    return
  }

  // Turso reports a failed statement inside a 200; the capture only counts if
  // every statement through COMMIT succeeded.
  const failed = results.slice(0, statements.length).find((r) => r.type !== 'ok')
  if (results.length < statements.length || failed) {
    res.status(502).json({ error: `Capture not saved: ${failed?.error?.message ?? 'incomplete response'}` })
    return
  }

  res.status(201).json({ ok: true, id: capture.id })
}
