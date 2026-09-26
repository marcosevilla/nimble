import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Loop 4 P2-19: text tokens measured from themes.css itself, so a later
// token edit that drops below AA fails here rather than in an audit.
const css = readFileSync(new URL('../src/themes.css', import.meta.url), 'utf8')

function block(selector) {
  const i = css.indexOf(`${selector} {`)
  assert.ok(i >= 0, selector)
  return css.slice(i, css.indexOf('}', i))
}
function oklch(src, name) {
  const m = new RegExp(`${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(src)
  return m && m.slice(1).map(Number)
}
function luminance([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (x) => Math.min(1, Math.max(0, x))
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}
const ratio = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

const warmDark = block('.dark,\n.theme-warm.dark')
const DARKS = ['.dark,\n.theme-warm.dark', '.theme-ocean.dark', '.theme-rose.dark', '.theme-mono.dark', '.theme-forest.dark', '.theme-runner.dark']

for (const sel of DARKS) {
  const name = sel.split(',')[0]
  test(`${name}: muted text ≥4.5:1 on background and card, subtle stays under muted`, () => {
    const src = block(sel)
    const pick = (n) => oklch(src, n) ?? oklch(warmDark, n)
    const bg = pick('--background'), card = pick('--card')
    const muted = pick('--muted-foreground'), subtle = pick('--muted-foreground-subtle')
    for (const [role, fg] of [['muted', muted], ['subtle', subtle]]) {
      assert.ok(ratio(fg, bg) >= 4.5, `${role} on background ${ratio(fg, bg).toFixed(2)}`)
      assert.ok(ratio(fg, card) >= 4.5, `${role} on card ${ratio(fg, card).toFixed(2)}`)
    }
    assert.ok(subtle[0] < muted[0], 'subtle is dimmer than muted')
  })
}
