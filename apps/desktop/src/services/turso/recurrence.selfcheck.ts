/**
 * Parity self-check for the recurrence port. There is no test runner in this
 * repo, so this is a plain script with no dependencies:
 *
 *   npx tsx apps/desktop/src/services/turso/recurrence.selfcheck.ts
 *
 * It runs every vector in `recurrence.vectors.ts` (all of which come from the
 * Rust unit tests in `nimble-core/src/recurrence.rs`) through this port and
 * exits non-zero on the first sign of divergence. Run it after ANY change to
 * either implementation.
 */

import { nextOccurrence, parseRule, type RecurrenceRule } from './recurrence'
import { VECTORS, type Vector } from './recurrence.vectors'

// This file lives under `src/`, so `tsc -b` type-checks it as part of
// `npm run build` — but the app's tsconfig only loads `vite/client` types, not
// `@types/node`. Declaring the one Node global used here keeps the build green
// without dragging Node types into the browser build's global scope.
declare const process: { exit(code: number): never }

interface Failure {
  vector: Vector
  detail: string
}

const failures: Failure[] = []
let passed = 0

/** Stable, order-independent rendering so `{a,b}` and `{b,a}` compare equal. */
function showRule(r: RecurrenceRule | null): string {
  if (r === null) return 'null'
  return `{ interval: ${r.interval}, unit: '${r.unit}', time: ${r.time === null ? 'null' : `'${r.time}'`} }`
}

function describe(v: Vector): string {
  switch (v.kind) {
    case 'parse':
      return `parseRule(${JSON.stringify(v.input)})`
    case 'next':
      return `nextOccurrence(${v.rule !== undefined ? JSON.stringify(v.rule) : showRule(v.builtRule!)}, ${v.currentDue}, ${v.today})`
    case 'nextAfter':
      return `nextOccurrence(${showRule(v.builtRule)}, ${v.currentDue}, ${v.today})`
  }
}

/**
 * Compares two formatted dates. Not a string compare: chrono signs years
 * outside 0..=9999, so "+102026-08-09" sorts BEFORE "2026-08-09"
 * lexicographically while being ~100k years later.
 */
function isAfter(a: string, b: string): boolean {
  const key = (s: string): [number, number, number] => {
    const m = /^([+-]?\d+)-(\d{2})-(\d{2})$/.exec(s)
    if (m === null) throw new Error(`unparseable date in vector: ${JSON.stringify(s)}`)
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const [ay, am, ad] = key(a)
  const [by, bm, bd] = key(b)
  if (ay !== by) return ay > by
  if (am !== bm) return am > bm
  return ad > bd
}

/** Resolves the rule for a next-occurrence vector, failing loudly if it can't. */
function ruleFor(v: { rule?: string; builtRule?: RecurrenceRule }): RecurrenceRule {
  if (v.builtRule !== undefined) return v.builtRule
  const parsed = parseRule(v.rule!)
  if (parsed === null) {
    throw new Error(`rule ${JSON.stringify(v.rule)} failed to parse (Rust does .unwrap() here)`)
  }
  return parsed
}

function check(v: Vector, ok: boolean, detail: string): void {
  if (ok) {
    passed += 1
  } else {
    failures.push({ vector: v, detail })
  }
}

for (const v of VECTORS) {
  try {
    switch (v.kind) {
      case 'parse': {
        const actual = parseRule(v.input)
        const a = showRule(actual)
        const e = showRule(v.expected)
        check(v, a === e, `expected ${e}\n         actual   ${a}`)
        break
      }
      case 'next': {
        const actual = nextOccurrence(ruleFor(v), v.currentDue, v.today)
        check(v, actual === v.expected, `expected ${v.expected}\n         actual   ${actual}`)
        break
      }
      case 'nextAfter': {
        const actual = nextOccurrence(v.builtRule, v.currentDue, v.today)
        // The Rust test only asserts strictly-after; the exact value is the
        // oracle-captured one and is checked too, since a silent change there
        // would be worth knowing about.
        const after = isAfter(actual, v.after)
        const exact = actual === v.alsoExactly
        check(
          v,
          after && exact,
          `expected > ${v.after} and == ${v.alsoExactly}\n         actual   ${actual}` +
            (after ? '' : ' (NOT after)'),
        )
        break
      }
    }
  } catch (err) {
    check(v, false, `threw ${err instanceof Error ? err.message : String(err)}`)
  }
}

const total = VECTORS.length
console.log(`recurrence parity self-check — source of truth: nimble-core/src/recurrence.rs`)
console.log(`${total} vectors from the Rust unit tests\n`)

for (const f of failures) {
  console.log(`FAIL  [${f.vector.from}] ${describe(f.vector)}`)
  console.log(`         ${f.detail}\n`)
}

if (failures.length === 0) {
  console.log(`PASS  ${passed}/${total} vectors match the Rust implementation.`)
  process.exit(0)
} else {
  console.log(`FAILED  ${failures.length}/${total} vectors diverge from the Rust implementation.`)
  process.exit(1)
}
