/**
 * Login endpoint for the password gate (see middleware.ts, which enforces it).
 *
 * Takes a POSTed password, and on a match sets a signed, httpOnly cookie:
 *   `<expiryMillis>.<hex HMAC-SHA256 of that same string>`
 * The middleware verifies that signature statelessly — nothing is stored here.
 *
 * Environment (Vercel project settings, server-side only — do NOT prefix with
 * VITE_ or anything else that would inline it into the browser bundle):
 *   WEB_PASSWORD   the shared password
 *   COOKIE_SECRET  HMAC key for the cookie (must match what middleware reads)
 *
 * This route is the one path the middleware matcher excludes, so it stays
 * reachable while logged out.
 */

/* ------------------------------------------------------------------ */
/* Handler types                                                       */
/* ------------------------------------------------------------------ */

/** Same locally-declared shapes as api/turso.ts — see the note there on why
 *  this deliberately does not depend on `@vercel/node`. */
interface VercelRequest {
  method?: string
  /** Vercel parses JSON and form-urlencoded bodies into this; a client that
   *  omits the Content-Type leaves it a raw string, handled below. */
  body?: unknown
}

interface VercelResponse {
  /** Chainable, so `res.status(405).json(...)` works. */
  status(code: number): VercelResponse
  setHeader(name: string, value: string | string[]): void
  json(body: unknown): void
  send(body: string): void
  end(): void
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const COOKIE_NAME = 'nimble_gate'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

const encoder = new TextEncoder()

/** Web Crypto, not node:crypto — identical code to middleware.ts, which runs
 *  on Edge where node:crypto does not exist. Keeping one implementation means
 *  the two ends cannot drift. */
async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Body may arrive parsed (object) or raw (string, JSON or form-urlencoded). */
function readField(body: unknown, field: string): string {
  if (typeof body === 'object' && body !== null) {
    const value = (body as Record<string, unknown>)[field]
    return typeof value === 'string' ? value : ''
  }
  if (typeof body === 'string') {
    try {
      const parsed: unknown = JSON.parse(body)
      if (typeof parsed === 'object' && parsed !== null) {
        const value = (parsed as Record<string, unknown>)[field]
        return typeof value === 'string' ? value : ''
      }
    } catch {
      return new URLSearchParams(body).get(field) ?? ''
    }
  }
  return ''
}

/** Same-origin paths only — never let a submitted `next` become an open
 *  redirect (`//evil.com` is protocol-relative and would leave the site). */
function safePath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

/**
 * Node signature `(req, res)`, NOT the Web signature `(Request) => Response`.
 * Vercel's Node runtime silently discards a returned `Response`, so the call
 * hangs to FUNCTION_INVOCATION_TIMEOUT. See the long note in api/turso.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const password = process.env.WEB_PASSWORD
  const secret = process.env.COOKIE_SECRET
  if (!password || !secret) {
    res.status(500).json({ error: 'Server is missing WEB_PASSWORD / COOKIE_SECRET' })
    return
  }

  const submitted = readField(req.body, 'password')
  const next = safePath(readField(req.body, 'next'))

  // Compare the HMACs rather than the passwords: constant time in content and
  // independent of length, so a wrong guess leaks neither.
  const ok = safeEqual(await hmacHex(submitted, secret), await hmacHex(password, secret))
  if (!ok) {
    res.status(401)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.send(
      '<!doctype html><meta charset="utf-8"><title>Nimble</title>' +
        '<p style="font:15px/1.5 ui-sans-serif,system-ui,sans-serif;padding:24px">' +
        'Incorrect password. <a href="/">Try again</a>.</p>',
    )
    return
  }

  const expiry = String(Date.now() + MAX_AGE_SECONDS * 1000)
  const cookie = `${expiry}.${await hmacHex(expiry, secret)}`

  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${cookie}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  )
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Location', next)
  res.status(302).end()
}
