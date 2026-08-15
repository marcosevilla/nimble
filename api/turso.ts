/**
 * Vercel serverless proxy for Turso's HTTP pipeline API.
 *
 * Why this exists: a Turso auth token grants full read/write on the entire
 * database. The browser must never hold one. The web client POSTs its
 * pipeline body here; this function attaches the token server-side and
 * forwards to `<TURSO_URL>/v2/pipeline`.
 *
 * The request and response shapes are identical to talking to Turso directly
 * (see apps/mobile/services/turso.ts for the shape), so client code only has
 * to swap the base URL for `/api/turso` and drop the Authorization header.
 *
 * Environment (Vercel project settings, server-side only — do NOT prefix with
 * VITE_ or anything else that would inline it into the browser bundle):
 *   TURSO_URL    e.g. libsql://nimble-xxx.turso.io  (or https://…)
 *   TURSO_TOKEN  the database auth token
 */

/* ------------------------------------------------------------------ */
/* Handler types                                                       */
/* ------------------------------------------------------------------ */

/**
 * Minimal structural types for Vercel's Node runtime handler.
 *
 * Declared here rather than imported from `@vercel/node`, which drags the whole
 * Vercel builder toolchain (build-utils, python-analysis, hono, …) in for two
 * type names — nine npm audit advisories in exchange for no build-time value,
 * since this file sits outside `tsconfig.app.json`'s `include` and `tsc -b`
 * never type-checks it. Vercel supplies the real runtime at deploy time; these
 * only have to describe the surface this handler actually touches.
 */
interface VercelRequest {
  method?: string
  /**
   * Vercel parses an `application/json` body into this for us. A client that
   * omits the header leaves it a raw string, which the handler also accepts.
   */
  body?: unknown
}

interface VercelResponse {
  /** Chainable, so `res.status(405).json(...)` works. */
  status(code: number): VercelResponse
  setHeader(name: string, value: string): void
  json(body: unknown): void
  send(body: string): void
  end(): void
}

/* ------------------------------------------------------------------ */
/* Safety filter                                                       */
/* ------------------------------------------------------------------ */

/**
 * Tables the web client is allowed to touch. `settings` is deliberately
 * absent — it never syncs and is device-local.
 */
const ALLOWED_TABLES = new Set([
  'local_tasks',
  'projects',
  'captures',
  'goals',
  'milestones',
  'habits',
  'habit_logs',
  'daily_state',
  'activity_log',
  'documents',
  'doc_folders',
  'doc_notes',
  'capture_routes',
  'life_areas',
  'calendar_feeds',
  'vault_notes',
  'vault_links',
  'vault_tags',
  'labels',
  'task_labels',
  'sections',
  'sync_log',
])

/** Statement kinds that are never acceptable from a client, full stop. */
const FORBIDDEN_KEYWORDS = /\b(DROP|ALTER|ATTACH|DETACH|VACUUM|PRAGMA|REINDEX)\b/i

/**
 * Strip string literals, quoted identifiers and comments so the table-name
 * scan can't be fooled by a table name that only appears inside a literal
 * (and so a `--` comment can't hide a keyword from the forbidden check).
 */
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`])*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]')
}

/**
 * Pull every identifier that appears in a table position: after FROM, JOIN,
 * INTO, UPDATE, DELETE FROM, or a bare `INSERT tbl`. Deliberately greedy —
 * anything that looks like a table has to be on the allow-list.
 */
const TABLE_POSITION =
  /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:OR\s+(?:REPLACE|IGNORE|ROLLBACK|ABORT|FAIL)\s+)?(?:IF\s+NOT\s+EXISTS\s+)?((?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?[A-Za-z_][A-Za-z0-9_]*)/gi

/**
 * Tokens that can sit in a "table position" without being a table:
 *  - `FROM (SELECT …)` / `FROM VALUES …`
 *  - `… ON CONFLICT DO UPDATE SET …` — the upsert tail, where `SET` follows
 *    `UPDATE`. Without this every upsert would be falsely rejected.
 */
const NOT_A_TABLE = new Set(['select', 'values', 'set'])

interface Rejection {
  reason: string
  sql: string
}

function checkStatement(rawSql: string): Rejection | null {
  const sql = stripLiteralsAndComments(rawSql)

  const forbidden = sql.match(FORBIDDEN_KEYWORDS)
  if (forbidden) {
    return { reason: `${forbidden[1].toUpperCase()} statements are not allowed`, sql: rawSql }
  }

  // Names bound by a WITH … AS (…) clause are query-local, not real tables.
  const cteNames = new Set<string>()
  for (const m of sql.matchAll(/\b(?:WITH|,)\s+([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)) {
    cteNames.add(m[1].toLowerCase())
  }

  const seen: string[] = []
  for (const m of sql.matchAll(TABLE_POSITION)) {
    const ident = m[1].replace(/\s+/g, '')
    // main.local_tasks -> local_tasks (schema-qualified names are still checked
    // on the table half; a non-`main`/`temp` schema is rejected outright).
    const parts = ident.split('.')
    if (parts.length === 2) {
      const schema = parts[0].toLowerCase()
      if (schema !== 'main' && schema !== 'temp') {
        return { reason: `cross-schema reference "${ident}" is not allowed`, sql: rawSql }
      }
    }
    const table = parts[parts.length - 1].toLowerCase()
    if (NOT_A_TABLE.has(table) || cteNames.has(table)) continue
    seen.push(table)
  }

  for (const table of seen) {
    if (!ALLOWED_TABLES.has(table)) {
      return { reason: `table "${table}" is not on the allow-list`, sql: rawSql }
    }
  }

  // A statement that reads or writes but names no table at all is suspicious
  // enough to refuse (e.g. `SELECT load_extension(...)`). Bare `SELECT 1`
  // health checks are the one exception.
  if (seen.length === 0 && !/^\s*select\s+1\s*;?\s*$/i.test(sql)) {
    const isNoop = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)
    if (!isNoop) {
      return { reason: 'statement names no allow-listed table', sql: rawSql }
    }
  }

  return null
}

interface PipelineRequest {
  type?: string
  stmt?: { sql?: string; args?: unknown[] }
}

function validatePipeline(body: unknown): Rejection | null {
  if (typeof body !== 'object' || body === null) {
    return { reason: 'body must be a JSON object', sql: '' }
  }
  const requests = (body as { requests?: unknown }).requests
  if (!Array.isArray(requests)) {
    return { reason: 'body.requests must be an array', sql: '' }
  }
  for (const req of requests as PipelineRequest[]) {
    if (!req || typeof req !== 'object') {
      return { reason: 'each request must be an object', sql: '' }
    }
    if (req.type === 'close' || req.type === 'open') continue
    if (req.type !== 'execute') {
      return { reason: `unsupported request type "${String(req.type)}"`, sql: '' }
    }
    const sql = req.stmt?.sql
    if (typeof sql !== 'string' || sql.trim() === '') {
      return { reason: 'execute request is missing stmt.sql', sql: '' }
    }
    const rejection = checkStatement(sql)
    if (rejection) return rejection
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

/**
 * This handler uses the Node signature `(req, res)`, NOT the Web signature
 * `(Request) => Response`. It was originally written the Web way, which looks
 * supported and type-checks fine, but on Vercel's Node runtime the returned
 * `Response` is simply discarded: nothing ever ends the response, so the
 * function hangs until FUNCTION_INVOCATION_TIMEOUT (deployed) or returns
 * NO_RESPONSE_FROM_FUNCTION (vercel dev). Marking api/ as ESM does not change
 * this. Reply through `res` — do not `return` a Response here.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const tursoUrl = process.env.TURSO_URL
  const tursoToken = process.env.TURSO_TOKEN
  if (!tursoUrl || !tursoToken) {
    res.status(500).json({ error: 'Server is missing TURSO_URL / TURSO_TOKEN' })
    return
  }

  // Vercel parses an application/json body into req.body for us, but a client
  // that omits the header leaves it a raw string — handle both.
  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' })
      return
    }
  }
  if (body === undefined || body === null) {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  const rejection = validatePipeline(body)
  if (rejection) {
    // The SQL is echoed back because this only ever fires on our own client's
    // bugs; it's the fastest way to find the offending statement.
    res.status(403).json({ error: `Rejected by proxy: ${rejection.reason}`, sql: rejection.sql })
    return
  }

  // libsql:// -> https://, strip trailing slashes (matches the mobile client)
  const baseUrl = tursoUrl.trim().replace(/\/+$/, '').replace('libsql://', 'https://')

  let upstream: Response
  try {
    upstream = await fetch(`${baseUrl}/v2/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tursoToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    res.status(502).json({ error: `Upstream request failed: ${(err as Error).message}` })
    return
  }

  // Return verbatim so the client sees exactly what Turso said.
  const text = await upstream.text()
  res.status(upstream.status)
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.send(text)
}
