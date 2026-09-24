# Loop 2 · Chunk 2 — One Capture Vocabulary + Natural-Language Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Your capture routes (`/i /q /t` and any you add) work the same in Inbox, Cmd+K and the quick-capture strip, with the same route pill. Anything headed for a task understands dates like "fri at 3pm": the words are tinted in the field, a chip shows the date, Backspace keeps them as plain text, and they come out of the title.

**Architecture:** Three pure, node-tested modules do the thinking. `lib/captureDate.ts` wraps `chrono-node` with Nimble's rules. `lib/captureRoutes.ts` gains prefix validation and the reserved list. `lib/captureActions.ts` routes, creates and converts with a date through the existing DataProvider calls. A small UI kit (`components/capture/`) plus one hook (`hooks/useCaptureDate.ts`) is then wired into the three surfaces. No Rust changes: a dated task is created by the existing call, then dated with `tasks.update`.

**Tech Stack:** React 19, TypeScript, Tailwind v4, sonner, date-fns 4, **chrono-node 2.10.1 (new, MIT)**, `node --test` (Node 22 strips TS types; tests import `../src/lib/*.ts` directly; lib files import siblings with a `.ts` extension and never `@/` paths at runtime; `import type` from `@nimble/types` is fine).

**Spec:** UX decisions made with Marco on 2026-09-23 (Lane A session, recorded in `nimble/.superpowers/loop2-lane-a-decisions.md`), plus NEXT.md "Decided 2026-09-23" (1) and (2):

| Decision | Chosen |
| --- | --- |
| Vocabulary | **Routes everywhere.** User routes work the same in Inbox, Cmd+K and the strip, with the same pill. Cmd+K keeps `/doc` and `/search` as palette-only modes. `/task` and `/note` (`/capture`) keep working as silent aliases (task mode / note mode). A route can't use a reserved prefix. |
| Where dates parse | Only where the result is a **task**: a task-type route (Inbox, Cmd+K, strip), Cmd+K `/task` mode, Cmd+K's "Create task" row, and converting a note. Notes and doc routes never parse. |
| Parse scope | **Day + time.** "fri at 3pm" sets due Fri + 15:00. Recurrence ("every friday") is not parsed and stays text. |
| Highlight | **Chip + in-text tint.** The matched words are tinted inside the field (a mirror layer behind a transparent field, scroll-synced), and a chip shows `📅 Fri, Sep 25 · 3:00 PM  ⌫ keep as text`. |
| Cancel | **Backspace.** With the caret right after the date (only spaces between), the first ⌫ keeps the words as plain text instead of deleting a letter; the next ⌫ deletes normally. A cancelled match stays cancelled until the field is cleared. |
| Convert | **Parse + undo toast.** Converting "call mom friday" makes task "call mom" due Fri. A toast "Converted · due Fri, Sep 25 [Keep as text]" (click, or ⌘Z while it shows) restores the words and clears the date. |

Parser rules come from a spike against chrono-node 2.10.1, with reference Wed Sep 23 2026 10:00:
- **Accepted:** "friday", "fri at 3pm", "tomorrow", "in 3 days", "sep 30", "9/30", "this weekend", "tonight" (date only).
- **Rejected:**
  - "call at 3". A time needs am/pm or noon/midnight, otherwise it reads as 3 AM.
  - "fix bug now".
  - "mon-fri" (a range).
  - "every friday" (recurrence).
  - A date that would leave an empty title.
- **Known false positive:** "sat on the couch" parses as Sat. ⌫ handles that.

## Global Constraints

- Frontend only. Don't touch `nimble-core/`, `apps/desktop/src-tauri/`, migrations, `TodayPage`, `useLocalToday` or the Settings "Today & brief" slot (Lane B owns them).
- The only new npm dependency is `chrono-node@2.10.1` in `apps/desktop/package.json` (exact version, no caret).
- `lib/shortcuts.ts` is append-only. New rows and the new `'Capture'` section go at the end, and nothing above is reordered or removed.
- Don't edit `NEXT.md`.
- Use `cn()` for conditional classes. Type weights come from scale tokens (`text-body-strong`, `text-label`, `text-meta`). Colors come from theme variables: the tint is `bg-primary/15`, and route colors stay a dot (the LabelChipPill recipe).
- Sentence-case copy. Use `…`, not `...`, in any new copy.
- The existing behaviour of non-task captures (notes, doc routes, the strip's `selection` / `quick_capture` sources, `prefillContext`) is unchanged.
- Tests: `cd apps/desktop && node --test tests/*.test.mjs` (baseline **337/337** at `f97ca10`). Type check and build: `npm run build` (runs `tsc -b`; `npx tsc --noEmit` checks nothing here) and `npm run build:web`.
- Work in worktree `.claude/worktrees/loop2-capture`, branch `loop2/capture-prefixes`; commit per task. Never use `git stash` (it's shared with Lane B).

## Review Focus

1. **Typing a normal sentence into a task route**, e.g. "/t read chapter 2" or "/t sat with Ana". Nothing is tinted for the first, and ⌫ clears the tint on the second. Enter creates exactly what's in the field, and the title never loses words that weren't a date. (Task 1 tests pin the parser; Task 5 Step 6 checks ⌫ in the browser.)
2. **A route whose date update fails after the task was created.** The task still exists (undated), and the toast says the date didn't stick. The words are never silently lost, and there's no duplicate task. (Task 3 test: `routeWithDate` with an `update` that throws.)
3. **Converting a note with no date words** behaves exactly as before: one call, the old `taskToast`, no "Keep as text". (Task 3 test: `convertWithDate` makes no `update` call when nothing parses.)
4. **Adding a route `/doc`, `/Search` or a duplicate `/I`** in Settings is refused with a clear message, and editing a route without changing its prefix still saves. (Task 2 tests.)
5. **Long input in the Inbox field or Cmd+K that scrolls sideways.** The tint stays under the matched words as you move the caret and type. (Task 4 builds the scroll sync; Task 5 Step 6 and Task 6 Step 5 check it with a 120-character entry.)

---

### Task 1: chrono-node and the date parser

Add the dependency, plus a pure parser that applies Nimble's rules on top of chrono.

**Files:**
- Modify: `apps/desktop/package.json` (add `"chrono-node": "2.10.1"` to `dependencies`), root `package-lock.json` (via `npm install`)
- Create: `apps/desktop/src/lib/captureDate.ts`
- Test: `apps/desktop/tests/captureDate.test.mjs`

**Interfaces:**
- Produces (from `lib/captureDate.ts`):
  - `interface ParsedCaptureDate { dueDate: string /* YYYY-MM-DD */; dueTime: string | null /* HH:MM, 24h */; start: number; end: number /* span in the parsed text, including a leading connector word */; matchText: string /* chrono's matched text, as typed */; title: string /* text with the span removed, whitespace collapsed */; label: string /* 'Today' | 'Tomorrow' | 'Fri, Sep 25', plus ' · 3:00 PM' when timed */ }`
  - `parseCaptureDate(text: string, ref: Date, ignore?: readonly string[]): ParsedCaptureDate | null`. `ignore` holds lowercased `matchText`s the user cancelled with ⌫.
  - `isKeepAsTextKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; selectionStart: number | null; selectionEnd: number | null; spanEnd: number; value: string }): boolean`

- [ ] **Step 1: Add the dependency.**

Run (from the worktree root): `npm install chrono-node@2.10.1 --save-exact --workspace @nimble/desktop --no-audit --no-fund`
Expected: `apps/desktop/package.json` gains `"chrono-node": "2.10.1"`; `package-lock.json` updates.

- [ ] **Step 2: Write the failing tests** at `apps/desktop/tests/captureDate.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCaptureDate, isKeepAsTextKey } from '../src/lib/captureDate.ts'

const ref = new Date(2026, 8, 23, 10, 0) // Wed Sep 23 2026, 10:00 local

const pick = (r) => r && { dueDate: r.dueDate, dueTime: r.dueTime, title: r.title, label: r.label }

test('a weekday sets the date, leaves no time, and leaves the title', () => {
  assert.deepEqual(pick(parseCaptureDate('call mom friday', ref)), {
    dueDate: '2026-09-25', dueTime: null, title: 'call mom', label: 'Fri, Sep 25',
  })
})

test('day + time with am/pm sets both', () => {
  assert.deepEqual(pick(parseCaptureDate('call mom fri at 3pm', ref)), {
    dueDate: '2026-09-25', dueTime: '15:00', title: 'call mom', label: 'Fri, Sep 25 · 3:00 PM',
  })
  assert.deepEqual(pick(parseCaptureDate('lunch fri at noon', ref)), {
    dueDate: '2026-09-25', dueTime: '12:00', title: 'lunch', label: 'Fri, Sep 25 · 12:00 PM',
  })
})

test('relative days read Today / Tomorrow', () => {
  assert.deepEqual(pick(parseCaptureDate('tomorrow buy film', ref)), {
    dueDate: '2026-09-24', dueTime: null, title: 'buy film', label: 'Tomorrow',
  })
  assert.deepEqual(pick(parseCaptureDate('tonight edit photos', ref)), {
    dueDate: '2026-09-23', dueTime: null, title: 'edit photos', label: 'Today',
  })
  assert.equal(parseCaptureDate('buy film in 3 days', ref).dueDate, '2026-09-26')
})

test('a time alone with am/pm lands today (or the next day once passed)', () => {
  assert.deepEqual(pick(parseCaptureDate('call at 3pm', ref)), {
    dueDate: '2026-09-23', dueTime: '15:00', title: 'call', label: 'Today · 3:00 PM',
  })
  assert.equal(parseCaptureDate('call at 9am', ref).dueDate, '2026-09-24')
})

test('a leading connector word goes with the date', () => {
  const r = parseCaptureDate('by monday send deck', ref)
  assert.equal(r.dueDate, '2026-09-28')
  assert.equal(r.title, 'send deck')
  assert.equal(r.start, 0)
  const on = parseCaptureDate('pay rent on friday', ref)
  assert.equal(on.title, 'pay rent')
  assert.equal('pay rent on friday'.slice(on.start, on.end), 'on friday')
})

test('span offsets point at the matched words', () => {
  const text = 'call mom fri at 3pm'
  const r = parseCaptureDate(text, ref)
  assert.equal(text.slice(r.start, r.end), 'fri at 3pm')
  assert.equal(r.matchText, 'fri at 3pm')
})

test('rejected: bare hour, now, ranges, recurrence, no date, empty title', () => {
  for (const text of [
    'call at 3',
    'fix bug now',
    'mon-fri standup',
    'water plants every friday',
    'stretch each monday',
    'read chapter 2',
    'review 3 kids books',
    'tomorrow',
    'fri at 3pm',
  ]) {
    assert.equal(parseCaptureDate(text, ref), null, text)
  }
})

test('an ignored match is skipped; without it the same text parses', () => {
  assert.equal(parseCaptureDate('sat on the couch', ref).dueDate, '2026-09-26')
  assert.equal(parseCaptureDate('sat on the couch', ref, ['sat']), null)
  assert.equal(parseCaptureDate('Call mom FRIDAY', ref, ['friday']), null)
})

test('isKeepAsTextKey: Backspace with the caret right after the date span', () => {
  const value = '/t call mom friday'
  const spanEnd = value.length
  const base = { key: 'Backspace', selectionStart: spanEnd, selectionEnd: spanEnd, spanEnd, value }
  assert.equal(isKeepAsTextKey(base), true)
  assert.equal(isKeepAsTextKey({ ...base, value: value + '  ', selectionStart: spanEnd + 2, selectionEnd: spanEnd + 2 }), true)
  assert.equal(isKeepAsTextKey({ ...base, value: value + ' x', selectionStart: spanEnd + 2, selectionEnd: spanEnd + 2 }), false)
  assert.equal(isKeepAsTextKey({ ...base, selectionStart: spanEnd - 3, selectionEnd: spanEnd }), false)
  assert.equal(isKeepAsTextKey({ ...base, selectionStart: spanEnd - 1, selectionEnd: spanEnd - 1 }), false)
  assert.equal(isKeepAsTextKey({ ...base, metaKey: true }), false)
  assert.equal(isKeepAsTextKey({ ...base, altKey: true }), false)
  assert.equal(isKeepAsTextKey({ ...base, key: 'Delete' }), false)
  assert.equal(isKeepAsTextKey({ ...base, selectionStart: null, selectionEnd: null }), false)
})
```

- [ ] **Step 2b: Run and watch it fail.**

Run: `cd apps/desktop && node --test tests/captureDate.test.mjs`
Expected: FAIL, "Cannot find module … captureDate.ts".

- [ ] **Step 3: Implement** `apps/desktop/src/lib/captureDate.ts`:

```ts
/* Natural-language dates for captures headed to a task (loop 2, decisions
   2026-09-23): day + time only, never recurrence. chrono-node finds the
   phrase; the rules below decide whether it counts.

   Plain TS, no JSX, no `@/` imports — tests/captureDate.test.mjs imports it. */
import * as chrono from 'chrono-node'
import { addDays, format, isSameDay } from 'date-fns'

export interface ParsedCaptureDate {
  /** YYYY-MM-DD, local. */
  dueDate: string
  /** HH:MM 24h, or null when no time was given. */
  dueTime: string | null
  /** Span in the parsed text, including a leading connector ("by monday"). */
  start: number
  end: number
  /** chrono's matched text, as typed. Lowercased, it is what ⌫ ignores. */
  matchText: string
  /** The text with the span removed and whitespace collapsed. */
  title: string
  /** 'Today' | 'Tomorrow' | 'Fri, Sep 25', plus ' · 3:00 PM' when timed. */
  label: string
}

const CONNECTOR_BEFORE = /\b(on|by|due|at|for)\s+$/i
const RECURRENCE_BEFORE = /\b(every|each)\s+$/i
const NOON_OR_MIDNIGHT = /\b(noon|midnight)\b/i

function localDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function dayLabel(d: Date, ref: Date): string {
  if (isSameDay(d, ref)) return 'Today'
  if (isSameDay(d, addDays(ref, 1))) return 'Tomorrow'
  return format(d, 'EEE, MMM d')
}

/** First date phrase in `text` that passes Nimble's rules, or null. */
export function parseCaptureDate(text: string, ref: Date, ignore: readonly string[] = []): ParsedCaptureDate | null {
  const results = chrono.parse(text, ref, { forwardDate: true })
  for (const r of results) {
    const s = r.start
    if (r.end) continue // ranges ("mon-fri")
    if (ignore.includes(r.text.toLowerCase())) continue
    if (r.text.trim().toLowerCase() === 'now') continue
    const before = text.slice(0, r.index)
    if (RECURRENCE_BEFORE.test(before)) continue

    const hasDay = s.isCertain('day') || s.isCertain('weekday')
    const hasTime = s.isCertain('hour') && (s.isCertain('meridiem') || NOON_OR_MIDNIGHT.test(r.text))
    if (!hasDay && !hasTime) continue // "call at 3" would read as 3 AM

    const connector = before.match(CONNECTOR_BEFORE)
    const start = connector ? r.index - connector[0].length : r.index
    const end = r.index + r.text.length
    const title = (text.slice(0, start) + ' ' + text.slice(end)).replace(/\s+/g, ' ').trim()
    if (!title) continue

    const date = s.date()
    const dueTime = hasTime ? format(date, 'HH:mm') : null
    const label = dayLabel(date, ref) + (hasTime ? ` · ${format(date, 'h:mm a')}` : '')
    return { dueDate: localDate(date), dueTime, start, end, matchText: r.text, title, label }
  }
  return null
}

/** ⌫ keeps the date words as text when the caret sits right after the
 *  date span (only spaces between) with nothing selected. */
export function isKeepAsTextKey(e: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  selectionStart: number | null
  selectionEnd: number | null
  spanEnd: number
  value: string
}): boolean {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false
  if (e.selectionStart === null || e.selectionStart !== e.selectionEnd) return false
  if (e.selectionStart < e.spanEnd) return false
  return e.value.slice(e.spanEnd, e.selectionStart).trim() === ''
}
```

- [ ] **Step 4: Run and watch it pass.**

Run: `cd apps/desktop && node --test tests/captureDate.test.mjs`
Expected: PASS. If one case disagrees with chrono 2.10.1's real output, **don't loosen the rule silently**. Report the case, chrono's output and your proposed rule change in the report as DONE_WITH_CONCERNS. Changing the rule is the controller's call.

- [ ] **Step 5: Full suite + build.**

Run: `cd apps/desktop && node --test tests/*.test.mjs && npm run build`
Expected: all pass (337 + new); the build is green, and chrono-node resolves in Vite.

- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/package.json package-lock.json apps/desktop/src/lib/captureDate.ts apps/desktop/tests/captureDate.test.mjs
git commit -m "feat(capture): chrono-node date parser with Nimble's rules"
```

---

### Task 2: Reserved prefixes and route validation

One place decides what a route prefix may be. The Settings route editor uses it.

**Files:**
- Modify: `apps/desktop/src/lib/captureRoutes.ts` (append; `parseRoutePrefix` unchanged)
- Modify: `apps/desktop/src/components/pages/SettingsPage.tsx`: `CaptureRoutesSection`'s `handleSave`, the two checks at the top (currently `:678-686`)
- Test: `apps/desktop/tests/captureRoutes.test.mjs` (new)

**Interfaces:**
- Produces (from `lib/captureRoutes.ts`):
  - `RESERVED_PREFIXES: readonly string[]` = `['/doc', '/search', '/task', '/note', '/capture']`
  - `validateRoutePrefix(prefix: string, routes: readonly CaptureRoute[], editingId?: string | null): string | null`. Returns an error message, or null when OK.

- [ ] **Step 1: Write the failing tests** at `apps/desktop/tests/captureRoutes.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoutePrefix, validateRoutePrefix, RESERVED_PREFIXES } from '../src/lib/captureRoutes.ts'

const route = (id, prefix, target_type = 'doc') => ({
  id, prefix, target_type, doc_id: null, label: id, color: '#000', icon: 'FileText', position: 0, created_at: '',
})
const ROUTES = [route('ideas', '/i'), route('quotes', '/q'), route('task', '/t', 'task')]

test('reserved prefixes are the command bar modes and aliases', () => {
  assert.deepEqual([...RESERVED_PREFIXES], ['/doc', '/search', '/task', '/note', '/capture'])
})

test('validateRoutePrefix accepts a new, well-formed prefix', () => {
  assert.equal(validateRoutePrefix('/w', ROUTES), null)
  assert.equal(validateRoutePrefix('  /work  ', ROUTES), null)
})

test('validateRoutePrefix refuses malformed prefixes', () => {
  assert.equal(validateRoutePrefix('', ROUTES), 'Prefix is required')
  assert.equal(validateRoutePrefix('w', ROUTES), 'Prefix must start with /')
  assert.equal(validateRoutePrefix('/', ROUTES), 'Add at least one letter after /')
  assert.equal(validateRoutePrefix('/a b', ROUTES), "Prefix can't contain spaces")
})

test('validateRoutePrefix refuses reserved prefixes in any case', () => {
  assert.equal(validateRoutePrefix('/doc', ROUTES), '/doc is reserved for the command bar')
  assert.equal(validateRoutePrefix('/Search', ROUTES), '/Search is reserved for the command bar')
  assert.equal(validateRoutePrefix('/task', ROUTES), '/task is reserved for the command bar')
})

test('validateRoutePrefix refuses a duplicate, but not the route being edited', () => {
  assert.equal(validateRoutePrefix('/I', ROUTES), '/I is already used by another route')
  assert.equal(validateRoutePrefix('/i', ROUTES, 'ideas'), null)
  assert.equal(validateRoutePrefix('/q', ROUTES, 'ideas'), '/q is already used by another route')
})

test('parseRoutePrefix still matches the longest prefix followed by a space', () => {
  const withLong = [...ROUTES, route('idea-long', '/idea')]
  assert.equal(parseRoutePrefix('/idea film', withLong).route.id, 'idea-long')
  assert.equal(parseRoutePrefix('/i film', withLong).content, 'film')
  assert.equal(parseRoutePrefix('/ifilm', withLong).route, null)
})
```

- [ ] **Step 2: Run and watch it fail.**

Run: `cd apps/desktop && node --test tests/captureRoutes.test.mjs`
Expected: FAIL. `validateRoutePrefix` / `RESERVED_PREFIXES` are not exported.

- [ ] **Step 3: Implement.** Append to `apps/desktop/src/lib/captureRoutes.ts`:

```ts
/** Prefixes the command bar keeps for itself: `/doc` and `/search` are
 *  palette modes; `/task`, `/note` and `/capture` are its silent aliases
 *  (decision 2026-09-23). A capture route can't take one. */
export const RESERVED_PREFIXES: readonly string[] = ['/doc', '/search', '/task', '/note', '/capture']

/** Why `prefix` can't be saved as a route, or null when it can.
 *  `editingId` is the route being edited, so keeping its own prefix is fine. */
export function validateRoutePrefix(
  prefix: string,
  routes: readonly CaptureRoute[],
  editingId: string | null = null,
): string | null {
  const p = prefix.trim()
  if (!p) return 'Prefix is required'
  if (!p.startsWith('/')) return 'Prefix must start with /'
  if (p.length < 2) return 'Add at least one letter after /'
  if (/\s/.test(p)) return "Prefix can't contain spaces"
  const lower = p.toLowerCase()
  if (RESERVED_PREFIXES.includes(lower)) return `${p} is reserved for the command bar`
  if (routes.some((r) => r.id !== editingId && r.prefix.toLowerCase() === lower)) {
    return `${p} is already used by another route`
  }
  return null
}
```

If `captureRoutes.ts` imports `CaptureRoute` without `type`, change it to `import type { CaptureRoute } from '@nimble/types'` so the node test can load the file.

- [ ] **Step 4: Use it in Settings.** In `SettingsPage.tsx`, add `validateRoutePrefix` to the imports (`import { validateRoutePrefix } from '@/lib/captureRoutes'`), and in `CaptureRoutesSection`'s `handleSave` replace

```ts
    if (!formPrefix.trim() || !formLabel.trim()) {
      toast.error('Prefix and label are required')
      return
    }
    if (!formPrefix.startsWith('/')) {
      toast.error('Prefix must start with /')
      return
    }
```

with

```ts
    const prefixError = validateRoutePrefix(formPrefix, routes, editingId)
    if (prefixError) {
      toast.error(prefixError)
      return
    }
    if (!formLabel.trim()) {
      toast.error('Label is required')
      return
    }
```

(`routes` and `editingId` are the section's existing state.)

- [ ] **Step 5: Run the tests and the build.**

Run: `cd apps/desktop && node --test tests/*.test.mjs && npm run build`
Expected: all pass; the build is green.

- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/src/lib/captureRoutes.ts apps/desktop/tests/captureRoutes.test.mjs apps/desktop/src/components/pages/SettingsPage.tsx
git commit -m "feat(capture): reserve command-bar prefixes and validate routes"
```

---

### Task 3: Capture actions with a date

Pure async helpers over the DataProvider. They route, convert, and date the resulting task. Tested with a fake provider.

**Files:**
- Create: `apps/desktop/src/lib/captureActions.ts`
- Test: `apps/desktop/tests/captureActions.test.mjs`

**Interfaces:**
- Consumes: `ParsedCaptureDate`, `parseCaptureDate` (Task 1).
- Produces (from `lib/captureActions.ts`):
  - `type CaptureDp = Pick<DataProvider, 'captureRoutes' | 'captures' | 'tasks'>` (`DataProvider` imported with `import type` from `@nimble/types`)
  - `routeWithDate(dp: CaptureDp, route: CaptureRoute, content: string, date: ParsedCaptureDate | null): Promise<{ result: RouteCaptureResult; dateSet: boolean; dateFailed: boolean }>`. For a task route with a date, it routes `date.title`, then `tasks.update({ id: result.created_id, dueDate, dueTime? })`. Without a date, or for a doc route, it routes `content` as-is. If the update throws, the task stays and `dateFailed: true`.
  - `convertWithDate(dp: CaptureDp, capture: Capture, ref: Date): Promise<{ task: LocalTask; date: ParsedCaptureDate | null; keepAsText: (() => Promise<void>) | null }>`. It converts, and when the note's text parses it updates the task with `content: date.title` plus the date. `keepAsText` restores `capture.content` and clears the date. With no date, there's no update and `keepAsText` is null. If the dating update throws, it returns `date: null, keepAsText: null` (the task stays as converted).
  - `dueFields(date: ParsedCaptureDate): { dueDate: string; dueTime?: string }`

- [ ] **Step 1: Write the failing tests** at `apps/desktop/tests/captureActions.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { routeWithDate, convertWithDate, dueFields } from '../src/lib/captureActions.ts'
import { parseCaptureDate } from '../src/lib/captureDate.ts'

const ref = new Date(2026, 8, 23, 10, 0)
const TASK_ROUTE = { id: 'r-t', prefix: '/t', target_type: 'task', doc_id: null, label: 'Task', color: '#0f0', icon: 'CheckSquare', position: 2, created_at: '' }
const DOC_ROUTE = { ...TASK_ROUTE, id: 'r-i', prefix: '/i', target_type: 'doc', label: 'Ideas' }

function fakeDp({ updateThrows = false } = {}) {
  const calls = []
  return {
    calls,
    captureRoutes: {
      route: async (prefix, content) => {
        calls.push(['route', prefix, content])
        const isTask = prefix === '/t'
        return { routed_to: isTask ? 'task-1' : 'doc-1', target_type: isTask ? 'task' : 'doc', created_id: isTask ? 'task-1' : 'note-1', label: isTask ? 'Task' : 'Ideas' }
      },
    },
    captures: {
      convertToTask: async (id) => { calls.push(['convert', id]); return { id: 'task-9', content: 'call mom friday' } },
    },
    tasks: {
      update: async (opts) => { calls.push(['update', opts]); if (updateThrows) throw new Error('boom'); return { id: opts.id } },
    },
  }
}

test('dueFields omits dueTime when there is none', () => {
  assert.deepEqual(dueFields(parseCaptureDate('call mom friday', ref)), { dueDate: '2026-09-25' })
  assert.deepEqual(dueFields(parseCaptureDate('call mom fri at 3pm', ref)), { dueDate: '2026-09-25', dueTime: '15:00' })
})

test('a task route with a date routes the stripped title, then sets the date', async () => {
  const dp = fakeDp()
  const date = parseCaptureDate('call mom fri at 3pm', ref)
  const out = await routeWithDate(dp, TASK_ROUTE, 'call mom fri at 3pm', date)
  assert.deepEqual(dp.calls, [
    ['route', '/t', 'call mom'],
    ['update', { id: 'task-1', dueDate: '2026-09-25', dueTime: '15:00' }],
  ])
  assert.equal(out.dateSet, true)
  assert.equal(out.dateFailed, false)
})

test('a task route without a date routes the content as-is, no update', async () => {
  const dp = fakeDp()
  const out = await routeWithDate(dp, TASK_ROUTE, 'read chapter 2', null)
  assert.deepEqual(dp.calls, [['route', '/t', 'read chapter 2']])
  assert.equal(out.dateSet, false)
})

test('a doc route never dates and keeps every word', async () => {
  const dp = fakeDp()
  const date = parseCaptureDate('idea for friday', ref)
  await routeWithDate(dp, DOC_ROUTE, 'idea for friday', date)
  assert.deepEqual(dp.calls, [['route', '/i', 'idea for friday']])
})

test('a failed date update keeps the task and reports dateFailed', async () => {
  const dp = fakeDp({ updateThrows: true })
  const out = await routeWithDate(dp, TASK_ROUTE, 'call mom friday', parseCaptureDate('call mom friday', ref))
  assert.equal(dp.calls.filter((c) => c[0] === 'route').length, 1)
  assert.equal(out.dateSet, false)
  assert.equal(out.dateFailed, true)
  assert.equal(out.result.created_id, 'task-1')
})

test('convertWithDate dates the task and keepAsText restores the words', async () => {
  const dp = fakeDp()
  const capture = { id: 'cap-1', content: 'call mom friday' }
  const out = await convertWithDate(dp, capture, ref)
  assert.equal(out.date.dueDate, '2026-09-25')
  assert.deepEqual(dp.calls, [
    ['convert', 'cap-1'],
    ['update', { id: 'task-9', content: 'call mom', dueDate: '2026-09-25' }],
  ])
  await out.keepAsText()
  assert.deepEqual(dp.calls[2], ['update', { id: 'task-9', content: 'call mom friday', clearDueDate: true, clearDueTime: true }])
})

test('convertWithDate with no date words makes one call and offers no keep-as-text', async () => {
  const dp = fakeDp()
  const out = await convertWithDate(dp, { id: 'cap-2', content: 'read chapter 2' }, ref)
  assert.deepEqual(dp.calls, [['convert', 'cap-2']])
  assert.equal(out.date, null)
  assert.equal(out.keepAsText, null)
})

test('convertWithDate falls back to the plain conversion when dating fails', async () => {
  const dp = fakeDp({ updateThrows: true })
  const out = await convertWithDate(dp, { id: 'cap-3', content: 'call mom friday' }, ref)
  assert.equal(out.task.id, 'task-9')
  assert.equal(out.date, null)
  assert.equal(out.keepAsText, null)
})
```

- [ ] **Step 2: Run and watch it fail.**

Run: `cd apps/desktop && node --test tests/captureActions.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `apps/desktop/src/lib/captureActions.ts`:

```ts
/* Capture writes that may carry a parsed date. There's no Rust change: the
   task is made by the existing call (route / convert), then dated with
   tasks.update. The update already announces nimble-data-changed, so
   every window (the capture strip included) refreshes.

   Plain TS — tests/captureActions.test.mjs imports it with a fake provider. */
import type { Capture, CaptureRoute, DataProvider, LocalTask, RouteCaptureResult } from '@nimble/types'
import { parseCaptureDate, type ParsedCaptureDate } from './captureDate.ts'

export type CaptureDp = Pick<DataProvider, 'captureRoutes' | 'captures' | 'tasks'>

export function dueFields(date: ParsedCaptureDate): { dueDate: string; dueTime?: string } {
  return date.dueTime ? { dueDate: date.dueDate, dueTime: date.dueTime } : { dueDate: date.dueDate }
}

/** Route a capture. A task route with a date gets the stripped title, then
 *  the date. If dating fails, the task still exists (undated) and the caller
 *  says so. */
export async function routeWithDate(
  dp: CaptureDp,
  route: CaptureRoute,
  content: string,
  date: ParsedCaptureDate | null,
): Promise<{ result: RouteCaptureResult; dateSet: boolean; dateFailed: boolean }> {
  const dated = route.target_type === 'task' && date !== null
  const result = await dp.captureRoutes.route(route.prefix, dated ? date.title : content)
  if (!dated || result.target_type !== 'task') return { result, dateSet: false, dateFailed: false }
  try {
    await dp.tasks.update({ id: result.created_id, ...dueFields(date) })
    return { result, dateSet: true, dateFailed: false }
  } catch {
    return { result, dateSet: false, dateFailed: true }
  }
}

/** Convert a note to a task; if its text holds a date, apply it and hand
 *  back an undo that restores the words. */
export async function convertWithDate(
  dp: CaptureDp,
  capture: Pick<Capture, 'id' | 'content'>,
  ref: Date,
): Promise<{ task: LocalTask; date: ParsedCaptureDate | null; keepAsText: (() => Promise<void>) | null }> {
  const task = await dp.captures.convertToTask(capture.id)
  const date = parseCaptureDate(capture.content, ref)
  if (!date) return { task, date: null, keepAsText: null }
  try {
    await dp.tasks.update({ id: task.id, content: date.title, ...dueFields(date) })
  } catch {
    return { task, date: null, keepAsText: null }
  }
  const keepAsText = async () => {
    await dp.tasks.update({ id: task.id, content: capture.content, clearDueDate: true, clearDueTime: true })
  }
  return { task, date, keepAsText }
}
```

- [ ] **Step 4: Run and watch it pass.**

Run: `cd apps/desktop && node --test tests/captureActions.test.mjs`
Expected: PASS.

- [ ] **Step 5: Full suite + build**, then **commit**:

Run: `cd apps/desktop && node --test tests/*.test.mjs && npm run build`

```bash
git add apps/desktop/src/lib/captureActions.ts apps/desktop/tests/captureActions.test.mjs
git commit -m "feat(capture): route and convert with a parsed date"
```

---

### Task 4: Capture UI kit: tinted field, pill, chip, hook

The shared pieces the three surfaces wire in. There's no node test (these are React components). Task 5 verifies them in the browser.

**Files:**
- Create: `apps/desktop/src/components/capture/HighlightField.tsx`
- Create: `apps/desktop/src/components/capture/CaptureTokens.tsx` (`RoutePill`, `DateChip`; `RouteIcon` moves here from `InboxPage.tsx`)
- Create: `apps/desktop/src/hooks/useCaptureDate.ts`

**Interfaces:**
- Consumes: `parseCaptureDate`, `isKeepAsTextKey`, `ParsedCaptureDate` (Task 1).
- Produces:
  - `HighlightField`: props `value: string`, `highlight: { start: number; end: number } | null`, `wrapperClassName?: string`, `multiline?: boolean`, `fieldRef?: React.Ref<HTMLInputElement | HTMLTextAreaElement>`, plus every other `<input>`/`<textarea>` prop (`onChange`, `onKeyDown`, `placeholder`, `aria-label`, `className`, `autoFocus`, `rows`, `spellCheck` …). `className` styles the field; `wrapperClassName` sets its layout in the row (e.g. `flex-1`).
  - `RoutePill({ route }: { route: CaptureRoute })`, `DateChip({ label }: { label: string })`, `RouteIcon({ name, className })`
  - `useCaptureDate(full: string, content: string, enabled: boolean): { date: ParsedCaptureDate | null; highlight: { start: number; end: number } | null; onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => boolean }`. `content` must be a suffix of `full` (the text after the prefix). `onKeyDown` returns true when it consumed ⌫ to keep the date as text.

- [ ] **Step 1: `hooks/useCaptureDate.ts`:**

```ts
import { useCallback, useMemo, useState } from 'react'
import { isKeepAsTextKey, parseCaptureDate, type ParsedCaptureDate } from '@/lib/captureDate'

/** Date parsing for one capture field. `content` is the part after any
 *  route prefix and must be a suffix of `full`. Only task-bound captures
 *  pass `enabled`. ⌫ right after the date keeps its words as text; that
 *  choice sticks until the field is cleared. */
export function useCaptureDate(full: string, content: string, enabled: boolean) {
  const [ignored, setIgnored] = useState<string[]>([])
  // Clearing the field forgets every "keep as text" choice.
  const [lastFull, setLastFull] = useState(full)
  if (full !== lastFull) {
    setLastFull(full)
    if (!full.trim() && ignored.length > 0) setIgnored([])
  }

  const date: ParsedCaptureDate | null = useMemo(
    () => (enabled && content.trim() ? parseCaptureDate(content, new Date(), ignored) : null),
    [enabled, content, ignored],
  )
  const offset = full.length - content.length
  const highlight = date ? { start: offset + date.start, end: offset + date.end } : null

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
      if (!date || !highlight) return false
      const el = e.currentTarget
      const keep = isKeepAsTextKey({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
        spanEnd: highlight.end,
        value: full,
      })
      if (!keep) return false
      e.preventDefault()
      setIgnored((prev) => [...prev, date.matchText.toLowerCase()])
      return true
    },
    [date, highlight, full],
  )

  return { date, highlight, onKeyDown }
}
```

(Setting state during render when `full` changes is React's documented "adjust state on prop change" pattern. It avoids an effect-driven extra render.)

- [ ] **Step 2: `components/capture/HighlightField.tsx`:**

```tsx
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { cn } from '@/lib/utils'

export interface HighlightRange {
  start: number
  end: number
}

/* Metrics the mirror must share with the field so the tint lands exactly
   under the matched characters. Copied from the live field, so any font
   setting or class change carries over. */
const MIRRORED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontFeatureSettings', 'fontVariationSettings',
  'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing',
] as const

function mirrorMetrics(field: HTMLElement): CSSProperties {
  const cs = getComputedStyle(field)
  const out: Record<string, string> = { borderStyle: 'solid', borderColor: 'transparent' }
  for (const p of MIRRORED) out[p] = cs[p]
  return out as CSSProperties
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement

type HighlightFieldProps = {
  value: string
  highlight: HighlightRange | null
  wrapperClassName?: string
  multiline?: boolean
  fieldRef?: Ref<FieldEl>
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'>

/** An input (or textarea) that tints `highlight` inside its own text. A
 *  mirror sits behind the transparent field with the same metrics and
 *  scroll position; only the tinted span paints. */
export function HighlightField({
  value, highlight, wrapperClassName, multiline = false, fieldRef, className, onScroll, onSelect, ...rest
}: HighlightFieldProps) {
  const fieldEl = useRef<FieldEl | null>(null)
  const mirrorEl = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<CSSProperties>({})

  const setRefs = useCallback((el: FieldEl | null) => {
    fieldEl.current = el
    if (typeof fieldRef === 'function') fieldRef(el)
    else if (fieldRef) (fieldRef as React.MutableRefObject<FieldEl | null>).current = el
  }, [fieldRef])

  const sync = useCallback(() => {
    const f = fieldEl.current
    const m = mirrorEl.current
    if (!f || !m) return
    m.scrollLeft = f.scrollLeft
    m.scrollTop = f.scrollTop
  }, [])

  const hasHighlight = highlight !== null
  useLayoutEffect(() => {
    if (hasHighlight && fieldEl.current) setMetrics(mirrorMetrics(fieldEl.current))
  }, [hasHighlight])
  // After every value/caret change the browser may scroll the field; follow it.
  useLayoutEffect(() => {
    if (!hasHighlight) return
    sync()
    const id = requestAnimationFrame(sync)
    return () => cancelAnimationFrame(id)
  }, [value, highlight?.start, highlight?.end, hasHighlight, sync])

  const start = highlight ? Math.max(0, Math.min(highlight.start, value.length)) : 0
  const end = highlight ? Math.max(start, Math.min(highlight.end, value.length)) : 0

  const fieldProps = {
    ...rest,
    ref: setRefs,
    value,
    className: cn('relative w-full bg-transparent', className),
    onScroll: (e: React.UIEvent<FieldEl>) => { sync(); onScroll?.(e as never) },
    onSelect: (e: React.SyntheticEvent<FieldEl>) => { requestAnimationFrame(sync); onSelect?.(e as never) },
  }

  return (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      {hasHighlight && (
        <div
          ref={mirrorEl}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden text-transparent"
          style={{ ...metrics, whiteSpace: multiline ? 'pre-wrap' : 'pre', overflowWrap: multiline ? 'break-word' : 'normal' }}
        >
          {value.slice(0, start)}
          <mark className="rounded-[3px] bg-primary/15 text-transparent">{value.slice(start, end)}</mark>
          {value.slice(end)}
          {multiline ? '​' : null}
        </div>
      )}
      {multiline ? (
        <textarea {...(fieldProps as React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref: typeof setRefs })} />
      ) : (
        <input {...(fieldProps as React.InputHTMLAttributes<HTMLInputElement> & { ref: typeof setRefs })} />
      )}
    </div>
  )
}
```

If TypeScript rejects a cast, keep the runtime shape above and narrow the types properly. Don't reach for `any`. The mirror comes before the field in the DOM and the field is `relative`, so the field paints on top. The field's background must stay transparent for the tint to show.

- [ ] **Step 3: `components/capture/CaptureTokens.tsx`.** Move the `ROUTE_ICONS` map and `RouteIcon` from `InboxPage.tsx:30-42` here (export `RouteIcon`), and add:

```tsx
import { CalendarDays, CheckSquare, FileText, Lightbulb, Quote } from 'lucide-react'
import type { CaptureRoute } from '@nimble/types'

const ROUTE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Lightbulb,
  Quote,
  CheckSquare,
  FileText,
}

export function RouteIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ROUTE_ICONS[name] ?? FileText
  return <Icon className={className} />
}

/** LabelChipPill recipe (inbox P2-8): the user's route color is a dot; the
 *  text stays on a theme token so contrast never depends on data. */
export function RoutePill({ route }: { route: CaptureRoute }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-label text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: route.color }} />
      <RouteIcon name={route.icon} className="size-3" />
      {route.label}
    </span>
  )
}

/** The date a task-bound capture will get, with the ⌫ escape hatch. */
export function DateChip({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-label text-muted-foreground"
    >
      <CalendarDays className="size-3" />
      <span className="text-foreground">{label}</span>
      <kbd className="font-mono">⌫</kbd>
      <span>keep as text</span>
    </span>
  )
}
```

In `InboxPage.tsx`, delete the moved map and function, import `RouteIcon` from `@/components/capture/CaptureTokens`, and drop the lucide icons that are no longer used there. Leave everything else in Inbox alone for now (Task 5 rewires it).

- [ ] **Step 4: Build.**

Run: `cd apps/desktop && npm run build && node --test tests/*.test.mjs && npx eslint src/components/capture src/hooks/useCaptureDate.ts src/components/pages/InboxPage.tsx`
Expected: green; no new eslint problems (compare with the same command in the main checkout at `/Users/marcosevilla/Developer/marco-task-app/nimble/apps/desktop`, which lacks the new files, so only `InboxPage.tsx` is comparable).

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/components/capture apps/desktop/src/hooks/useCaptureDate.ts apps/desktop/src/components/pages/InboxPage.tsx
git commit -m "feat(capture): tinted field, route pill, date chip and date hook"
```

---

### Task 5: Inbox: tinted dates, dated routing, convert with undo

**Files:**
- Modify: `apps/desktop/src/components/pages/InboxPage.tsx`: the capture input block (currently `:366-400`), `handleSubmit` (`:211-252`), `handleConvert` (`:254-265`)
- Modify: `tools/mock-tauri.js`: `route_capture` (`:1345-1353`) makes a real task for task routes

**Interfaces:**
- Consumes: `HighlightField`, `RoutePill`, `DateChip`, `useCaptureDate` (Task 4); `routeWithDate`, `convertWithDate` (Task 3); `isTextEntry` from `@/lib/keyGuard`.

- [ ] **Step 1: Mock parity.** In `tools/mock-tauri.js`, make `route_capture` mirror Rust for task routes (Rust creates a real task and returns its id). The mock's own `create_local_task` lives in the same `commands` object:

```js
    route_capture: function (args) {
      var route = CAPTURE_ROUTES.find(function (r) { return r.prefix === (args && args.prefix) }) || CAPTURE_ROUTES[0]
      if (route.target_type === 'task') {
        // Rust creates a real task and returns its id (capture_routes.rs), so a
        // follow-up update_local_task lands on it instead of TASKS[0].
        var task = commands.create_local_task({ content: args.content })
        return { routed_to: task.id, target_type: 'task', created_id: task.id, label: route.label }
      }
      return {
        routed_to: route.doc_id || 'doc-ideas',
        target_type: route.target_type,
        created_id: newId('note'),
        label: route.label,
      }
    },
```

Check that `create_local_task`'s argument shape (`:1182`) accepts `{ content }`. If it expects a different key, match it.

- [ ] **Step 2: Wire the date hook.** Next to `parsedRoute` in `InboxPage`, add:

```ts
  const taskBound = parsedRoute.route?.target_type === 'task' && parsedRoute.content.trim() !== ''
  const capDate = useCaptureDate(inputValue, parsedRoute.content, taskBound)
```

Import `useCaptureDate` from `@/hooks/useCaptureDate`, `HighlightField`, `RoutePill`, `DateChip` from `@/components/capture/*`, and `routeWithDate`, `convertWithDate` from `@/lib/captureActions`.

- [ ] **Step 3: Submit with the date.** In `handleSubmit`, replace the routed branch's `try` body:

```ts
      try {
        const result = await dp.captureRoutes.route(route.prefix, content)
        if (result.target_type === 'task') emitTasksChanged()
        toast.success(`Saved to ${result.label}`)
        refreshCaptures()
      }
```

with

```ts
      try {
        const date = route.target_type === 'task' ? capDate.date : null
        const { result, dateSet, dateFailed } = await routeWithDate(dp, route, content, date)
        if (result.target_type === 'task') emitTasksChanged()
        if (dateSet && date) toast.success(`Saved to ${result.label} · due ${date.label}`)
        else if (dateFailed) toast(`Saved to ${result.label}. The date didn't stick. Set it on the task.`)
        else toast.success(`Saved to ${result.label}`)
        refreshCaptures()
      }
```

Add `capDate.date` to the `useCallback` deps.

- [ ] **Step 4: Convert with undo.** Replace `handleConvert`'s `try` body:

```ts
      const task = await dp.captures.convertToTask(capture.id)
      taskToast(`Converted to task: "${capture.content}"`, task.id)
      emitTasksChanged()
```

with

```ts
      const { task, date, keepAsText } = await convertWithDate(dp, capture, new Date())
      emitTasksChanged()
      if (!date || !keepAsText) {
        taskToast(`Converted to task: "${capture.content}"`, task.id)
        return
      }
      // "Keep as text": click the action, or ⌘Z while the toast shows.
      let done = false
      const cleanup = () => window.removeEventListener('keydown', onUndoKey)
      const keep = async () => {
        if (done) return
        done = true
        cleanup()
        toast.dismiss(toastId)
        try {
          await keepAsText()
          emitTasksChanged()
          toast(`Kept "${capture.content}" as written`)
        } catch (e) {
          toast.error(`Couldn't restore the text: ${e}`)
        }
      }
      const onUndoKey = (e: KeyboardEvent) => {
        if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isTextEntry(e.target as Element | null)) {
          e.preventDefault()
          void keep()
        }
      }
      window.addEventListener('keydown', onUndoKey)
      const toastId = toast.success(`Converted · due ${date.label}`, {
        action: { label: 'Keep as text', onClick: () => void keep() },
        onDismiss: cleanup,
        onAutoClose: cleanup,
      })
```

Import `isTextEntry` from `@/lib/keyGuard`. `toastId` is a `const` declared after `keep` but only read when `keep` runs, which is after it's assigned. That's fine at runtime; if eslint's `no-use-before-define` complains, hoist `let toastId: string | number` above `keep` and assign it.

- [ ] **Step 5: The field, pill and chip.** Replace the `<input … />` and the `{parsedRoute.route && parsedRoute.content && (…)}` pill block (`:368-387`) with:

```tsx
        <HighlightField
          fieldRef={inputRef}
          value={inputValue}
          highlight={capDate.highlight}
          wrapperClassName="flex-1"
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (capDate.onKeyDown(e)) return
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
            if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() }
          }}
          placeholder="Write a note… (/i idea, /q quote, /t task)"
          aria-label="Capture a note"
          className="text-body outline-none placeholder:text-muted-foreground"
        />
        {parsedRoute.route && parsedRoute.content && <RoutePill route={parsedRoute.route} />}
        {capDate.date && <DateChip label={capDate.date.label} />}
```

`inputRef` is typed `useRef<HTMLInputElement>(null)`. If `fieldRef`'s type rejects it, widen the ref's type at its declaration to `HTMLInputElement | HTMLTextAreaElement`, or adapt it with a callback ref. Keep every existing `inputRef.current?.focus()` call working.

- [ ] **Step 6: Verify.** Run `cd apps/desktop && npm run build && node --test tests/*.test.mjs`. Then, in the browser (from `apps/desktop`: `npx vite --port 5232 --strictPort` in the background; Playwright with `addInitScript({ path: '<abs>/tools/mock-tauri.js' })` before navigating; load the Playwright MCP tools with ToolSearch), on Inbox at 1280×800:
  1. Type `/t call mom fri at 3pm`. Expected: "fri at 3pm" is tinted exactly under the words, and the Task pill plus the `Fri, Sep 25 · 3:00 PM ⌫ keep as text` chip show (the date depends on the real "today" in the browser, so check the weekday matches). Screenshot.
  2. Press ⌫ once. Expected: the tint and chip are gone and the text is unchanged. Press ⌫ again: the "m" is deleted. Retype "m": no tint (the match stays cancelled).
  3. Clear the field, type `/t call mom friday`, and press Enter. Expected: the toast reads "Saved to Task · due …". In Tasks, a task "call mom" with that due date exists.
  4. Type `/i idea for friday`. Expected: the Ideas pill shows, with no tint and no chip.
  5. Type a plain note `call mom friday` (no prefix). Expected: no tint and no chip. Enter saves a note with every word.
  6. Type `/t ` followed by about 110 characters of filler and then ` tomorrow`, so the field scrolls sideways. Expected: the tint sits under "tomorrow"; move the caret to the start (⌘←) and back to the end (⌘→), and the tint stays aligned whenever "tomorrow" is visible. Screenshot.
  7. Convert a note whose text is `call mom friday` (create it, then press `t` on it). Expected: the toast "Converted · due …" has a "Keep as text" action; the task reads "call mom". Press ⌘Z (focus not in a field): the task reads "call mom friday" with no due date. Convert a note with no date words: you get the old "Converted to task" toast.
  8. Dark theme screenshot of step 1.
  Report each as PASS/FAIL with the screenshot names (scratchpad `…/scratchpad/capture-shots/`). If the mock blocks a step, say which, rather than editing `index.html` or `public/`.

- [ ] **Step 7: Commit.**

```bash
git add apps/desktop/src/components/pages/InboxPage.tsx tools/mock-tauri.js
git commit -m "feat(inbox): tinted dates on task routes, dated routing, convert with keep-as-text"
```

---

### Task 6: Cmd+K: your routes, dates on task creation

**Files:**
- Modify: `apps/desktop/src/components/shared/CommandBar.tsx`: `parseMode` (`:27-35`), `BarMode`, the state/hooks block, `handleCreateTask` (`:150-158`), a new `handleRoute`, `handleKeyDown` (`:231-276`), `handleChange` (`:279-291`), the placeholder (`:295-300`), and the input row plus results (`:311-345`)
- Modify: `apps/desktop/src/components/shared/CommandBarResults.tsx`: the create row (`:255-269`) takes `createTitle` and `createDate`
- Modify: `apps/desktop/src/hooks/useLocalTasks.ts:75-93`: `addTask`'s `extra` gains `dueTime?: string`, passed to `dp.tasks.create`

**Interfaces:**
- Consumes: `parseRoutePrefix` (existing), `RoutePill`, `DateChip`, `HighlightField`, `useCaptureDate` (Task 4), `routeWithDate` (Task 3).
- Produces: `BarMode` gains `'route'`; `parseMode(raw: string, routes: readonly CaptureRoute[]): { mode: BarMode; query: string; route: CaptureRoute | null }`.

- [ ] **Step 1: `addTask` takes a time.** In `useLocalTasks.ts`, add `dueTime?: string` to `extra`'s type and `dueTime: extra?.dueTime,` to the `dp.tasks.create({…})` call.

- [ ] **Step 2: Routes in `parseMode`.** Add `'route'` to the `BarMode` union (`CommandBarResults.tsx:16`), then:

```ts
function parseMode(raw: string, routes: readonly CaptureRoute[]): { mode: BarMode; query: string; route: CaptureRoute | null } {
  const trimmed = raw.trimStart()
  // Built-in modes and silent aliases first; route validation keeps user
  // routes off these names (lib/captureRoutes RESERVED_PREFIXES).
  if (trimmed.startsWith('/task ')) return { mode: 'task', query: trimmed.slice(6), route: null }
  if (trimmed.startsWith('/capture ')) return { mode: 'capture', query: trimmed.slice(9), route: null }
  if (trimmed.startsWith('/note ')) return { mode: 'capture', query: trimmed.slice(6), route: null }
  if (trimmed.startsWith('/doc ')) return { mode: 'doc', query: trimmed.slice(5), route: null }
  if (trimmed.startsWith('/search ')) return { mode: 'search', query: trimmed.slice(8), route: null }
  const { route, content } = parseRoutePrefix(trimmed, [...routes])
  if (route && content) return { mode: 'route', query: content, route }
  return { mode: 'search', query: trimmed, route: null }
}
```

Load routes in the component: `const [routes, setRoutes] = useState<CaptureRoute[]>([])`, fetched with `dp.captureRoutes.list()` each time the bar opens (in the existing open handler, or in an effect on `open`, with errors caught to `[]`). Update both `parseMode` call sites (`useMemo` and `handleChange`) to pass `routes`, and add `route` to the destructured result in the `useMemo`.

Make `query` always a suffix of `rawQuery` so the tint offsets line up: every branch above returns a suffix of `trimmed`, and `trimmed` is a suffix of `rawQuery`.

- [ ] **Step 3: Dates for task intents.** After `selectedIndex`, `createIndex` and `mode` are known:

```ts
  // Dates parse only where Enter makes a task (decisions 2026-09-23).
  const taskBound =
    mode === 'task' ||
    (mode === 'route' && route?.target_type === 'task') ||
    (mode === 'search' && selectedIndex === createIndex)
  const capDate = useCaptureDate(rawQuery, query, taskBound && query.trim() !== '')
```

Place this right after `const createIndex = …` (currently `:107`). It must stay above the `if (!open) return null` early return (`:293`), because it's a hook.

- [ ] **Step 4: Create and route with the date.**

```ts
  const handleCreateTask = useCallback(async () => {
    const text = query.trim()
    if (!text) return
    const date = capDate.date
    const task = await addTask(date ? date.title : text, date ? { dueDate: date.dueDate, dueTime: date.dueTime ?? undefined } : undefined)
    if (task) {
      taskToast(date ? `Task created: "${date.title}" · due ${date.label}` : `Task created: "${text}"`, task.id)
      closeBar()
    }
  }, [query, addTask, closeBar, capDate.date])

  const handleRoute = useCallback(async () => {
    if (!route) return
    const text = query.trim()
    if (!text) return
    try {
      const date = route.target_type === 'task' ? capDate.date : null
      const { result, dateSet, dateFailed } = await routeWithDate(dp, route, text, date)
      if (result.target_type === 'task') emitTasksChanged()
      if (dateSet && date) toast.success(`Saved to ${result.label} · due ${date.label}`)
      else if (dateFailed) toast(`Saved to ${result.label}. The date didn't stick. Set it on the task.`)
      else toast.success(`Saved to ${result.label}`)
      closeBar()
    } catch (e) {
      toast.error(`Couldn't save to ${route.label}: ${e}`)
    }
  }, [route, query, capDate.date, dp, closeBar])
```

(Import `emitTasksChanged` from `@/hooks/useLocalTasks` if it isn't already.)

- [ ] **Step 5: Keys.** At the very top of `handleKeyDown` (before the breakdown branch is fine, since the breakdown view has no text field), add `if (capDate.onKeyDown(e as React.KeyboardEvent<HTMLInputElement>)) return`. In the Enter branch, add `if (mode === 'route') { handleRoute(); return }` next to the `capture`/`task` lines. Add `handleRoute` and `capDate` to the deps. In `handleChange`, treat `'route'` like `'task'` for the default selection (there are no search results in route mode). Where `filteredTasks` / doc / capture searches are computed, skip them when `mode === 'route'` (as they already do for `'doc'` where applicable), so route mode shows no search results.

- [ ] **Step 6: Placeholder.** Replace the `rawQuery === '/'` line with:

```ts
  else if (rawQuery === '/') placeholder = [...routes.map((r) => r.prefix), '/task', '/doc', '/search'].join('  ')
```

- [ ] **Step 7: The input row.** Replace the `<input … />` with:

```tsx
          <HighlightField
            fieldRef={inputRef}
            type="text"
            value={rawQuery}
            highlight={capDate.highlight}
            wrapperClassName="flex-1"
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="text-body outline-none placeholder:text-muted-foreground"
          />
          {mode === 'route' && route && <RoutePill route={route} />}
          {capDate.date && mode !== 'search' && <DateChip label={capDate.date.label} />}
```

In search mode the chip lives in the Create task row instead (Step 9), so it never looks attached to a matched task.

- [ ] **Step 8: Route mode results.** Render route mode as one action row instead of `<CommandBarResults>`. Change `showResults && (…<CommandBarResults …/>)` to render, when `mode === 'route' && route`:

```tsx
          <div className="mt-1 overflow-hidden rounded-xl border border-border/50 bg-popover p-1 shadow-lg shadow-black/10">
            <button
              type="button"
              onClick={handleRoute}
              className="flex w-full items-center gap-2 rounded-md bg-hover px-2 py-1.5 text-left text-body"
            >
              <RouteIcon name={route.icon} className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Save to {route.label}</span>
              <span className="min-w-0 flex-1 truncate text-body-strong">"{capDate.date ? capDate.date.title : query.trim()}"</span>
              <kbd className="rounded-sm bg-muted px-1 py-0.5 text-label text-muted-foreground">Enter</kbd>
            </button>
          </div>
```

Match the outer container classes to whatever `CommandBarResults`' own wrapper uses, so both look the same (read its root element and copy those classes instead of the ones above if they differ).

- [ ] **Step 9: The Create task row.** In `CommandBarResults.tsx`, add optional props `createTitle?: string` and `createDate?: { label: string } | null`. In the create row, show `"{createTitle ?? query}"` and, after it, `{createDate && <DateChip label={createDate.label} />}` (import from `@/components/capture/CaptureTokens`). In `CommandBar`, pass `createTitle={capDate.date && mode === 'search' ? capDate.date.title : undefined}` and `createDate={mode === 'search' ? capDate.date : null}`.

- [ ] **Step 10: Verify.** Run `cd apps/desktop && npm run build && node --test tests/*.test.mjs`. Then, in the browser with the mock (same setup as Task 5 Step 6), open ⌘K and check:
  1. Type `/i film idea`. Expected: the Ideas pill and one "Save to Ideas "film idea"" row; Enter shows the toast "Saved to Ideas" and closes.
  2. Type `/t call mom fri at 3pm`. Expected: the Task pill, the tint and the date chip in the input row; the row "Save to Task "call mom""; Enter shows "Saved to Task · due …", and the task exists with that date and time.
  3. Type `call mom tomorrow` (search mode). With the Create task row selected (arrow to it if a match is selected first), expected: the tint in the input, and "Create task "call mom" [📅 Tomorrow ⌫ keep as text]". Arrow up to a matched task: the tint goes away. Arrow back and press Enter: the task "call mom" is due tomorrow.
  4. `/task buy film sep 30`. Expected: the chip in the input row; Enter creates "buy film" due Sep 30.
  5. ⌫ right after the date in step 2's text keeps it as text (the tint and chip go away; Enter routes "call mom fri at 3pm" with no date).
  6. `/doc` and `/search` still work as before; `/note hi` saves a note.
  7. Type `/` alone. Expected: the placeholder lists `/i  /q  /t  /task  /doc  /search`.
  8. Long input (about 120 characters with "tomorrow" at the end) in search mode with Create task selected: the tint stays aligned. Screenshot.
  Record PASS/FAIL and screenshot names.

- [ ] **Step 11: Commit.**

```bash
git add apps/desktop/src/components/shared/CommandBar.tsx apps/desktop/src/components/shared/CommandBarResults.tsx apps/desktop/src/hooks/useLocalTasks.ts
git commit -m "feat(command-bar): capture routes with pill, dates on task creation"
```

---

### Task 7: Capture strip routes and dates, plus shortcut rows

**Files:**
- Modify: `apps/desktop/src/components/shared/CaptureStrip.tsx`: routes state, the parse, the date hook, `submit` (`:122-146`), `handleKeyDown` (`:148-157`), and the textarea block
- Modify: `apps/desktop/src/lib/shortcuts.ts`: append the `'Capture'` section and its rows
- Test: `apps/desktop/tests/shortcuts.test.mjs` (append one test; extend one existing assertion, see Step 5)

**Interfaces:**
- Consumes: `parseRoutePrefix`, `HighlightField` (multiline), `RoutePill`, `DateChip`, `useCaptureDate`, `routeWithDate`.

- [ ] **Step 1: Routes in the strip.** Add `const [routes, setRoutes] = useState<CaptureRoute[]>([])` and load `dp.captureRoutes.list()` on mount and again on each summon (where `openCount` is bumped), catching errors to `[]`. Then:

```ts
  const parsed = useMemo(() => parseRoutePrefix(value, routes), [value, routes])
  const taskBound = parsed.route?.target_type === 'task' && parsed.content.trim() !== ''
  const capDate = useCaptureDate(value, parsed.content, taskBound)
```

`parseRoutePrefix` requires the input to start with `/`, and its `content` is a suffix of the input (it `trimStart`s after the prefix), which `useCaptureDate` needs.

- [ ] **Step 2: Submit through routes.** In `submit`, before the existing `prefillRef` branch:

```ts
      const { route, content } = parseRoutePrefix(text, routes)
      if (route && content) {
        const date = route.target_type === 'task' ? capDate.date : null
        await routeWithDate(dp, route, content, date)
      } else if (prefillRef.current) {
```

Leave the rest of the chain (`selection` / `quick_capture`, `emit('captures-changed')`, the saved animation, dismiss) as it is. A routed save still ends with `emit('captures-changed')`, because the routed capture's history row changed. Add `routes` and `capDate.date` to the deps. There's no toast here: the strip's ✓ animation is its confirmation.

- [ ] **Step 3: Keys.** First line of `handleKeyDown`: `if (capDate.onKeyDown(e)) return`.

- [ ] **Step 4: The field.** Replace the `<textarea … />` with:

```tsx
        <HighlightField
          multiline
          fieldRef={textareaRef}
          autoFocus
          rows={1}
          value={value}
          highlight={capDate.highlight}
          wrapperClassName="flex-1 self-center"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture anything… (/t task, /i idea)"
          spellCheck={false}
          className="max-h-28 resize-none py-1 text-[15px] leading-normal text-foreground outline-none placeholder:text-muted-foreground/80"
        />
        {parsed.route && parsed.content && <RoutePill route={parsed.route} />}
        {capDate.date && <DateChip label={capDate.date.label} />}
```

`autoGrow` sets `textareaRef.current.style.height` and must keep working. Check that `textareaRef` still points at the textarea. The pill and chip sit in the card's `items-end` flex row. Give them `mb-1.5` (the same bottom offset as the existing `from {prefillContext}` meta) so they line up with the text baseline. Since `RoutePill`/`DateChip` don't take a className, wrap each in `<span className="mb-1.5 flex">…</span>`.

- [ ] **Step 5: Shortcut rows.** In `lib/shortcuts.ts`, add `| 'Capture'` at the end of the `ShortcutSection` union, append `'Capture'` at the end of `SHORTCUT_SECTIONS`, and append at the very end of `SHORTCUTS`:

```ts
  // ── Capture (Inbox field, ⌘K, quick-capture strip; loop 2 chunk 2) ──
  { section: 'Capture', keys: '/i /q /t', label: 'Send to one of your capture routes (Settings → Tasks & capture)' },
  { section: 'Capture', keys: '⌫', label: 'Right after a detected date: keep the words as text' },
  { section: 'Capture', keys: '⌘Z', label: 'After converting a note with a date: keep the words as text' },
```

Append to `tests/shortcuts.test.mjs`:

```js
test('Capture section is appended last with routes, ⌫ and ⌘Z', () => {
  assert.equal(SHORTCUT_SECTIONS[SHORTCUT_SECTIONS.length - 1], 'Capture')
  const keys = SHORTCUTS.filter((s) => s.section === 'Capture').map((s) => s.keys)
  assert.deepEqual(keys, ['/i /q /t', '⌫', '⌘Z'])
})
```

(Match the file's existing import names for `SHORTCUTS` / `SHORTCUT_SECTIONS`, adding them to its import if missing.)

The existing test `Inbox is appended after General (then B3b sections), existing order untouched` pins the exact `SHORTCUT_SECTIONS` array. Append `'Capture'` to the end of its expected array. That is the only edit to an existing test, and it keeps the test's intent: everything before is untouched.

- [ ] **Step 6: Verify.** Run `cd apps/desktop && npm run build && npm run build:web && node --test tests/*.test.mjs`, plus `npx eslint` on the touched files compared with the main checkout. In the browser with the mock, open `http://localhost:<port>/?window=capture` at 800×300:
  1. Type `/t call mom tomorrow`. Expected: the tint under "tomorrow" (the textarea wraps, so check the tint on a line that wraps too: add filler until it wraps), the Task pill, and the chip. Screenshot.
  2. Enter. Expected: the ✓ animation; the mock now has a task "call mom" due tomorrow (check with `window.__TAURI_INTERNALS__.invoke('get_local_tasks', {})` or the mock's equivalent list command in the console).
  3. `/i film idea` then Enter: routed to Ideas, no chip.
  4. A plain `hello` still saves as a `quick_capture` note.
  5. On the main app, the help panel (`?`) shows the Capture section last with its three rows.
  If the strip route doesn't render in the browser (desktop window APIs), report which step was blocked and what you checked by reading the code instead.

- [ ] **Step 7: Commit.**

```bash
git add apps/desktop/src/components/shared/CaptureStrip.tsx apps/desktop/src/lib/shortcuts.ts apps/desktop/tests/shortcuts.test.mjs
git commit -m "feat(capture-strip): routes and dates; Capture shortcuts in help"
```
