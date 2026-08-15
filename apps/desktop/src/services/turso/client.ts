/**
 * Turso HTTP pipeline client for the web build.
 *
 * Every domain module under `services/turso/` goes through this file — do not
 * hand-roll a second fetch to `/api/turso`. Requests carry no credentials: the
 * Vercel function at `api/turso.ts` holds TURSO_URL/TURSO_TOKEN server-side and
 * forwards to `<TURSO_URL>/v2/pipeline`, so the browser never sees a token that
 * grants full read/write.
 *
 * ⚠️ The single most important thing this file does is check for STATEMENT-LEVEL
 * errors. Turso answers a pipeline with HTTP 200 even when an individual
 * statement failed — the failure is reported as `results[i].type === 'error'`
 * inside a 2xx body. Checking only `response.ok` (which is what
 * apps/mobile/services/turso.ts does) reads a failed query as an empty result
 * set, which looks exactly like "no rows" to a caller. That mistake has already
 * been made three separate times in this codebase. `unwrap` below is the one
 * place it gets caught; everything else builds on it.
 *
 * Values come back from the HTTP API as `{ type, value }` cells with every
 * value encoded as a STRING — including integers. Use the decode helpers
 * (`str`, `num`, `bool`, …) rather than reading `row[col]` directly, or
 * `priority` arrives as "3" and `completed` as "0", which is truthy.
 */

/** An argument bound into a statement's `?` placeholders. */
export interface TursoArg {
  type: 'text' | 'integer' | 'float' | 'null'
  value?: string | null
}

/** One statement plus its bound arguments. */
export interface TursoStatement {
  sql: string
  args?: TursoArg[]
}

/** A decoded row: column name -> raw cell value (always string or null). */
export type Row = Record<string, string | null>

/** Thrown for transport failures, proxy rejections and statement-level errors. */
export class TursoError extends Error {
  readonly statementIndex: number | null
  readonly sql: string | null

  constructor(message: string, statementIndex: number | null = null, sql: string | null = null) {
    super(message)
    this.name = 'TursoError'
    this.statementIndex = statementIndex
    this.sql = sql
  }
}

/* ------------------------------------------------------------------ */
/* Argument builders                                                   */
/* ------------------------------------------------------------------ */

export function text(value: string): TursoArg {
  return { type: 'text', value }
}

export function integer(value: number): TursoArg {
  return { type: 'integer', value: String(Math.trunc(value)) }
}

export function nullArg(): TursoArg {
  return { type: 'null' }
}

export function textOrNull(value: string | null | undefined): TursoArg {
  return value != null ? text(value) : nullArg()
}

/** SQLite has no boolean type; `completed` and friends are INTEGER 0/1. */
export function boolean(value: boolean): TursoArg {
  return integer(value ? 1 : 0)
}

/* ------------------------------------------------------------------ */
/* Cell decoding                                                       */
/* ------------------------------------------------------------------ */

/** Required TEXT column. Throws if absent — a missing column is a bug, not data. */
export function str(row: Row, col: string): string {
  const v = row[col]
  if (v == null) throw new TursoError(`Expected a value for column "${col}"`)
  return v
}

/** Nullable TEXT column. */
export function strOrNull(row: Row, col: string): string | null {
  return row[col] ?? null
}

/** Required INTEGER/REAL column, decoded from its string encoding. */
export function num(row: Row, col: string): number {
  const v = row[col]
  if (v == null) throw new TursoError(`Expected a value for column "${col}"`)
  const n = Number(v)
  if (Number.isNaN(n)) throw new TursoError(`Column "${col}" is not numeric: ${v}`)
  return n
}

/** Nullable INTEGER/REAL column. */
export function numOrNull(row: Row, col: string): number | null {
  const v = row[col]
  if (v == null) return null
  const n = Number(v)
  if (Number.isNaN(n)) throw new TursoError(`Column "${col}" is not numeric: ${v}`)
  return n
}

/** INTEGER 0/1 column. Note `"0"` is a truthy string — always decode it. */
export function bool(row: Row, col: string): boolean {
  return num(row, col) !== 0
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

interface PipelineCell {
  type: string
  value?: string | null
}

interface PipelineResult {
  type: 'ok' | 'error'
  response?: {
    type: string
    result?: {
      cols: Array<{ name: string }>
      rows: PipelineCell[][]
    }
  }
  error?: { message?: string }
}

interface PipelineBody {
  results?: PipelineResult[]
}

/** Turn one statement's result block into plain `Row` objects. */
function toRows(result: PipelineResult): Row[] {
  const payload = result.response?.result
  if (!payload) return []
  const names = payload.cols.map((c) => c.name)
  return payload.rows.map((cells) => {
    const row: Row = {}
    cells.forEach((cell, i) => {
      row[names[i]] = cell.type === 'null' ? null : (cell.value ?? null)
    })
    return row
  })
}

/**
 * Validate a pipeline response and return one `Row[]` per submitted statement.
 * This is where a 200-with-embedded-error is turned into a thrown TursoError.
 */
function unwrap(body: PipelineBody, statements: TursoStatement[]): Row[][] {
  const results = body.results
  if (!Array.isArray(results)) {
    throw new TursoError('Malformed pipeline response: no results array')
  }

  const out: Row[][] = []
  // The trailing `close` request produces a result too; only walk as many as
  // we submitted, and index errors against the caller's own statement list.
  for (let i = 0; i < statements.length; i++) {
    const result = results[i]
    if (!result) {
      throw new TursoError(`Pipeline returned no result for statement ${i}`, i, statements[i].sql)
    }
    if (result.type === 'error') {
      const message = result.error?.message ?? 'unknown error'
      throw new TursoError(`Turso rejected statement ${i}: ${message}`, i, statements[i].sql)
    }
    out.push(toRows(result))
  }
  return out
}

/**
 * Run several statements in ONE round trip. Prefer this over awaiting `query`
 * in sequence — each call is a network hop to Vercel and then to Turso.
 */
export async function pipeline(statements: TursoStatement[]): Promise<Row[][]> {
  const requests = [
    ...statements.map((s) => ({ type: 'execute' as const, stmt: { sql: s.sql, args: s.args ?? [] } })),
    { type: 'close' as const },
  ]

  let response: Response
  try {
    response = await fetch('/api/turso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
  } catch (err) {
    throw new TursoError(`Could not reach /api/turso: ${(err as Error).message}`)
  }

  const raw = await response.text()

  if (!response.ok) {
    // The proxy answers rejections as {error, sql}; surface that verbatim
    // rather than a bare status, since it names the offending statement.
    let detail = raw.slice(0, 500)
    try {
      const parsed = JSON.parse(raw) as { error?: string }
      if (parsed.error) detail = parsed.error
    } catch {
      /* not JSON — keep the raw prefix */
    }
    throw new TursoError(`/api/turso returned ${response.status}: ${detail}`)
  }

  let body: PipelineBody
  try {
    body = JSON.parse(raw) as PipelineBody
  } catch {
    throw new TursoError(`/api/turso returned non-JSON: ${raw.slice(0, 200)}`)
  }

  return unwrap(body, statements)
}

/** Run a single statement and return its rows. */
export async function query(sql: string, args: TursoArg[] = []): Promise<Row[]> {
  const [rows] = await pipeline([{ sql, args }])
  return rows
}
