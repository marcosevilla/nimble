/**
 * Password gate for the deployed web client.
 *
 * Why this exists: Vercel's own Password Protection needs the paid Advanced
 * Deployment Protection add-on, and Vercel Authentication cannot cover a
 * *production* domain on this plan — so a production URL is otherwise wide
 * open, SQL proxy and all. This middleware is the substitute: one shared
 * password, one signed cookie, covering both the static app and `/api/*`.
 *
 * Runtime: Edge (the default for middleware). There is no Node `crypto` here,
 * so signing/verification use Web Crypto (`crypto.subtle`), which the Edge
 * runtime does provide.
 *
 * Environment (Vercel project settings, server-side only — do NOT prefix with
 * VITE_ or anything else that would inline it into the browser bundle):
 *   WEB_PASSWORD   the shared password (read by api/login.ts, not here)
 *   COOKIE_SECRET  HMAC key for the session cookie (read by both)
 *
 * Cookie: `<expiryMillis>.<hex HMAC-SHA256 of that same string>`. Stateless —
 * nothing is stored server-side; the signature proves we minted it and the
 * embedded expiry is checked on every request.
 */

/**
 * Everything except the login endpoint itself. `/api/*` IS gated (that is the
 * point — `/api/turso` is a full-database proxy), and so are the built assets;
 * the login page below is entirely self-contained (inline CSS, no scripts, no
 * images) so a logged-out visitor never needs an asset to reach the form.
 *
 * `_vercel/` is Vercel's own internal path (insights, image optimizer) and is
 * left alone. The matcher deliberately does NOT exclude the SPA rewrite in
 * vercel.json (`/((?!api/).*)` -> `/index.html`): middleware runs before
 * rewrites, so it sees the real request path (`/tasks`), which is what we want.
 */
export const config = {
  matcher: ['/((?!api/login|_vercel/).*)'],
}

/** Must match api/login.ts, which mints it. */
const COOKIE_NAME = 'nimble_gate'

/* ------------------------------------------------------------------ */
/* Signing                                                             */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder()

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

/** Length-independent, content constant-time comparison of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

async function isAuthenticated(request: Request, secret: string): Promise<boolean> {
  const cookie = readCookie(request, COOKIE_NAME)
  if (!cookie) return false

  const dot = cookie.indexOf('.')
  if (dot === -1) return false
  const expiry = cookie.slice(0, dot)
  const signature = cookie.slice(dot + 1)

  if (!/^\d+$/.test(expiry)) return false
  if (Number(expiry) <= Date.now()) return false

  return safeEqual(signature, await hmacHex(expiry, secret))
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

/**
 * The "carry on" signal for Vercel Edge Middleware. This is exactly what
 * `next()` from `@vercel/edge` returns — an empty response carrying
 * `x-middleware-next: 1` — reimplemented here so the gate adds no dependency.
 */
function proceed(): Response {
  return new Response(null, { headers: { 'x-middleware-next': '1' } })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Keep only same-origin, non-protocol-relative paths so the `next` field can't
 * be turned into an open redirect. (api/login.ts re-checks this; never trust
 * the round-trip.)
 */
function safePath(pathname: string, search: string): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return '/'
  return pathname + search
}

function loginPage(next: string, status: number): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nimble</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    font: 15px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif;
    background: #faf9f7; color: #1c1b19;
  }
  form { display: grid; gap: 12px; width: min(320px, calc(100vw - 48px)); }
  h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  input, button {
    font: inherit; padding: 9px 12px; border-radius: 8px;
    border: 1px solid #ddd8d1; background: #fff; color: inherit;
  }
  input:focus-visible, button:focus-visible { outline: 2px solid #c2703d; outline-offset: 1px; }
  button { border-color: transparent; background: #c2703d; color: #fff; font-weight: 500; cursor: pointer; }
  @media (prefers-color-scheme: dark) {
    body { background: #17161a; color: #ecebe9; }
    input { background: #211f25; border-color: #35323b; }
  }
</style>
</head>
<body>
<form method="POST" action="/api/login">
  <h1>Nimble</h1>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
  <button type="submit">Unlock</button>
</form>
</body>
</html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const isApi = url.pathname.startsWith('/api/')

  // Belt and braces: the matcher already skips this, but a matcher typo must
  // not be able to lock the only unlock route behind the gate.
  if (url.pathname === '/api/login') return proceed()

  const secret = process.env.COOKIE_SECRET
  if (!secret) {
    // Fail closed. Without the key nothing can be verified, so serving the app
    // would mean serving it unprotected.
    return isApi
      ? jsonError(500, 'Server is missing COOKIE_SECRET')
      : new Response('Server is missing COOKIE_SECRET', {
          status: 500,
          headers: { 'Cache-Control': 'no-store' },
        })
  }

  if (await isAuthenticated(request, secret)) return proceed()

  // API callers get a status they can branch on — never a redirect, which a
  // fetch() would happily follow and then fail to parse as JSON.
  if (isApi) return jsonError(401, 'Unauthorized')

  const next = safePath(url.pathname, url.search)

  // A navigation gets the form rendered in place (200, so the browser doesn't
  // treat it as an error page). Anything else — a stale asset request from a
  // cached bundle, say — gets a bare 401 rather than HTML under a .js URL.
  if ((request.headers.get('accept') ?? '').includes('text/html')) {
    return loginPage(next, 200)
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'Cache-Control': 'no-store' },
  })
}
