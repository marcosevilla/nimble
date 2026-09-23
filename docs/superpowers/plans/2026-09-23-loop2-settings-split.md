# Loop 2 · Chunk 1 — Settings Sub-pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 14-section Settings scroll into 5 sub-pages (General · Today & brief · Tasks & capture · Connections · Data), with an in-page rail that lists the pages and nests the active page's sections, plus a mount slot for Lane B's brief settings.

**Architecture:** `lib/settingsSections.ts` stays the single registry. Each section gains a `page`, and a new `SETTINGS_PAGES` list sets page order; pure helpers decide which pages show and where a deep link lands (all `node:test`ed). A tiny zustand store keeps the current page for the session and carries one-shot deep links. `SettingsPage.tsx` renders only the active page's sections, reusing its scroll-spy and body map.

**Tech Stack:** React 19, TypeScript, Tailwind v4, zustand, `node --test` (Node 22 strips TS types; tests import `../src/lib/*.ts` directly, so `lib/settingsSections.ts` must not import `@/` paths).

**Spec:** Decided in chat with Marco on 2026-09-23 (Lane A session). NEXT.md item 4 ("Settings sub-pages (19 sections → 4–5 pages)"); settings audit P2-1 structural half (`docs/audit-findings/settings/2026-09-22-loop1.md:51`, `…/2026-09-23-loop1-rescore.md` P2-1); brief spec `docs/superpowers/specs/2026-09-23-morning-brief-design.md:73` ("Settings → Today & brief"). The decisions:

| Decision | Chosen |
| --- | --- |
| Grouping | **General** = Appearance, Demo mode, About · **Today & brief** = Lane B slot · **Tasks & capture** = Capture routes, Labels, Reminders · **Connections** = API keys (was "Integrations"), Obsidian, Todoist sync, Calendars, Phone alerts · **Data** = Sync, Backups, Maintenance |
| Sub-nav | In-page left rail (existing 160px column): the 5 pages; the active page's sections nest under it with the existing scroll-spy highlight |
| Brief slot | The `today-brief` section's body is `null` until Lane B mounts `<TodayBriefSettings />`. A page with no renderable section is hidden, so "Today & brief" appears by itself once mounted |
| Re-entry | `Cmd+,` / `g ,` reopen the last sub-page for the session (General on first open). Not persisted across launches |
| Deep links | `openSettings(sectionId)` opens the right page and scrolls to the section. The sync banner → `todoist-sync`; the Demo pill → `demo` |

## Global Constraints

- Frontend only (`apps/desktop/src`). No Rust, no schema, no new npm dependencies.
- **Lane B boundary:** don't touch `nimble-core/`, `apps/desktop/src-tauri/`, `TodayPage`, `useLocalToday`, or create `TodayBriefSettings`. Lane B adds that component and replaces the `null` in the `'today-brief'` body with it (plus its import).
- `lib/shortcuts.ts` is append-only; this chunk adds **no** shortcuts, so don't edit it.
- Don't edit `NEXT.md` (updated at wrap only).
- Use `cn()` for conditional classes, never template literals. Type weights come from scale tokens (`text-body-strong`, `text-meta-strong`), never `font-medium`/`font-bold`. Colors come from theme variables (`text-foreground`, `text-muted-foreground`, `bg-hover`).
- Labels are sentence case; the only allowed inner capitals are the acronym `API`.
- Keep every existing `<section id>` unchanged (`integrations` keeps its id even though its label becomes "API keys"), so existing anchors still resolve.
- Tests: `cd apps/desktop && node --test tests/*.test.mjs` (baseline **331/331** at `6921835`). Type check `npx tsc -b`. Builds: `npm run build` and `npm run build:web` in `apps/desktop`.
- Work in worktree `.claude/worktrees/loop2-settings` on branch `loop2/settings-split`; commit per task. If `node_modules` is missing, run `npm install` once from the worktree's repo root first.

## Review Focus

1. **"Open settings" on the Todoist sync banner, pressed from Tasks** lands on Connections, scrolled to Todoist sync, with that section highlighted in the rail. (Task 1 `settingsTarget` test; Task 3 Step 6 manual check.)
2. **Web build (no Backups / Reminders / Phone alerts) with the brief slot still empty** shows no empty page in the rail, and a remembered page that is now hidden falls back to General instead of rendering nothing. (Task 1 `visiblePages` + `resolveSettingsPage` tests; Task 3 Step 6.)
3. **Switching pages after scrolling far down Connections** starts the new page at its top, and the rail highlights that page's first section, not a stale id. (Task 3 Step 6.)
4. **Maintenance expanded, switch to General, come back to Data**: the disclosure and its sync tools agree (both closed, or both open), never an "open" state with a closed `<details>`. (Task 3 Step 3 makes `<details>` controlled; Step 6 checks it.)
5. **A window narrower than `md` (768px; the web build on a small screen)**: the rail is hidden, but a row of page buttons above the content still reaches all pages. (Task 3 Step 4; Step 6 check at 700px.)

---

### Task 1: Pages in the settings registry

Give every section a page, add the page list, and add the pure helpers the page and store need. The array order changes so that sections sit grouped in page order. Render order and rail order then come from the same array, as before.

**Files:**
- Modify: `apps/desktop/src/lib/settingsSections.ts` (whole file; currently 68 lines)
- Test: `apps/desktop/tests/settingsSections.test.mjs:1-30` (replace the first three tests and the import; keep everything from the `activeSectionId picks the last section…` test down)

**Interfaces:**
- Produces (all exported from `lib/settingsSections.ts`):
  - `type SettingsPageId = 'general' | 'brief' | 'tasks' | 'connections' | 'data'`
  - `interface SettingsPage { id: SettingsPageId; label: string }`
  - `SETTINGS_PAGES: readonly SettingsPage[]` (page order)
  - `SettingsSection` gains a required `page: SettingsPageId`
  - `DEFAULT_SETTINGS_PAGE: SettingsPageId` (= `'general'`)
  - `visiblePages(sections: readonly SettingsSection[], pages?: readonly SettingsPage[]): SettingsPage[]`: pages with at least one of `sections`, in page order
  - `sectionsOnPage(sections: readonly SettingsSection[], page: SettingsPageId): SettingsSection[]`
  - `resolveSettingsPage(requested: SettingsPageId, pages: readonly SettingsPage[]): SettingsPageId | null`: `requested` if it is in `pages`, else the first page's id, else `null`
  - `settingsTarget(sectionId: string, sections?: readonly SettingsSection[]): { page: SettingsPageId; section: string | null }`: the section's page and id; an unknown id gives `{ page: DEFAULT_SETTINGS_PAGE, section: null }`
  - Unchanged: `SettingsCapability`, `visibleSections`, `SectionBox`, `activeSectionId`

- [ ] **Step 1: Write the failing tests.** In `tests/settingsSections.test.mjs`, replace the import line and the first three tests (lines 3–30, down to and including the `visibleSections drops capability-gated sections…` test) with:

```js
import {
  SETTINGS_SECTIONS,
  SETTINGS_PAGES,
  DEFAULT_SETTINGS_PAGE,
  visibleSections,
  visiblePages,
  sectionsOnPage,
  resolveSettingsPage,
  settingsTarget,
  activeSectionId,
} from '../src/lib/settingsSections.ts'
```

(keep the `settingsMessage` import and the `ALL` / `NONE` constants that follow it), then:

```js
const ACRONYMS = ['API']
function assertSentenceCase(label) {
  assert.equal(label[0], label[0].toUpperCase(), label)
  // "API keys" → "Api keys" before checking that nothing after the first letter is capitalised
  const rest = ACRONYMS.reduce((s, a) => s.replaceAll(a, a[0] + a.slice(1).toLowerCase()), label).slice(1)
  assert.equal(rest, rest.toLowerCase(), label)
}

test('section and page ids are unique; labels are sentence case', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
  const pageIds = SETTINGS_PAGES.map((p) => p.id)
  assert.equal(new Set(pageIds).size, pageIds.length)
  for (const s of SETTINGS_SECTIONS) assertSentenceCase(s.label)
  for (const p of SETTINGS_PAGES) assertSentenceCase(p.label)
})

test('five pages in the decided order, each section on the decided page', () => {
  assert.deepEqual(
    SETTINGS_PAGES.map((p) => [p.id, p.label]),
    [
      ['general', 'General'],
      ['brief', 'Today & brief'],
      ['tasks', 'Tasks & capture'],
      ['connections', 'Connections'],
      ['data', 'Data'],
    ],
  )
  const byPage = Object.fromEntries(SETTINGS_PAGES.map((p) => [p.id, sectionsOnPage(SETTINGS_SECTIONS, p.id).map((s) => s.id)]))
  assert.deepEqual(byPage, {
    general: ['appearance', 'demo', 'about'],
    brief: ['today-brief'],
    tasks: ['capture-routes', 'labels', 'reminders'],
    connections: ['integrations', 'obsidian', 'todoist-sync', 'calendars', 'google-calendar'],
    data: ['sync', 'backups', 'maintenance'],
  })
  assert.equal(DEFAULT_SETTINGS_PAGE, 'general')
  assert.equal(SETTINGS_SECTIONS.find((s) => s.id === 'integrations').label, 'API keys')
})

test('sections are grouped in page order, so render order matches the rail', () => {
  const order = SETTINGS_PAGES.map((p) => p.id)
  const pageIndex = SETTINGS_SECTIONS.map((s) => order.indexOf(s.page))
  assert.ok(pageIndex.every((i) => i >= 0), 'every section names a known page')
  assert.deepEqual(pageIndex, [...pageIndex].sort((a, b) => a - b))
})

test('no page opens on a standalone section (it would draw a stray top rule)', () => {
  for (const p of SETTINGS_PAGES) {
    const first = sectionsOnPage(SETTINGS_SECTIONS, p.id)[0]
    assert.ok(first && !first.standalone, p.id)
  }
})

test('retired sections stay gone', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id)
  for (const gone of ['vault', 'status-colors', 'import-todoist', 'docs-format', 'tasks-format', 'focus']) {
    assert.ok(!ids.includes(gone), `${gone} should not be a top-level section`)
  }
})

test('visibleSections drops capability-gated sections and keeps order', () => {
  const all = visibleSections(ALL).map((s) => s.id)
  assert.deepEqual(all, SETTINGS_SECTIONS.map((s) => s.id))
  const none = visibleSections(NONE).map((s) => s.id)
  for (const gated of ['backups', 'reminders', 'google-calendar']) assert.ok(!none.includes(gated), gated)
  assert.equal(none.length, all.length - 3)
})

test('visiblePages hides a page with no renderable section (web build, empty brief slot)', () => {
  const web = visibleSections(NONE).filter((s) => s.id !== 'today-brief')
  assert.deepEqual(visiblePages(web).map((p) => p.id), ['general', 'tasks', 'connections', 'data'])
  assert.deepEqual(visiblePages(visibleSections(ALL)).map((p) => p.id), SETTINGS_PAGES.map((p) => p.id))
  assert.deepEqual(visiblePages([]), [])
})

test('resolveSettingsPage keeps a visible page and falls back to the first visible one', () => {
  const pages = visiblePages(visibleSections(ALL).filter((s) => s.id !== 'today-brief'))
  assert.equal(resolveSettingsPage('data', pages), 'data')
  assert.equal(resolveSettingsPage('brief', pages), 'general')
  assert.equal(resolveSettingsPage('general', []), null)
})

test('settingsTarget maps a section to its page; unknown ids open the default page', () => {
  assert.deepEqual(settingsTarget('todoist-sync'), { page: 'connections', section: 'todoist-sync' })
  assert.deepEqual(settingsTarget('demo'), { page: 'general', section: 'demo' })
  assert.deepEqual(settingsTarget('today-brief'), { page: 'brief', section: 'today-brief' })
  assert.deepEqual(settingsTarget('no-such-section'), { page: 'general', section: null })
})
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `cd apps/desktop && node --test tests/settingsSections.test.mjs`
Expected: FAIL. The import of `SETTINGS_PAGES` / `visiblePages` / `sectionsOnPage` / `resolveSettingsPage` / `settingsTarget` / `DEFAULT_SETTINGS_PAGE` throws "does not provide an export named …".

- [ ] **Step 3: Implement.** Replace `apps/desktop/src/lib/settingsSections.ts` from the top comment through the end of `visibleSections` (keep `SectionBox` and `activeSectionId` exactly as they are) with:

```ts
/* Settings information architecture — ONE list drives the page rail, the
   nested section links, the render order and the scroll-spy (settings
   audit P2-1, P2-2; sub-pages loop 2).

   Rules:
   - SETTINGS_PAGES order is rail order. SETTINGS_SECTIONS is grouped by
     page in that same order, and within a page its order is render order.
   - Adding a section = a row here (with its `page`) and a matching body in
     SettingsPage's `bodies` map. A section whose body is null does not
     render, and a page with no rendered section is hidden from the rail
     (that is how "Today & brief" stays out until Lane B mounts it).
   - `requires` names the DataProvider capability that must be `supported`
     for the section to render (web build drops Backups / Reminders /
     Phone alerts). `standalone` sections draw their own top rule, so the
     page does not add a Separator before them — never first on a page.
   - Labels are sentence case (acronyms like API excepted).

   Plain TS, no JSX — tests/settingsSections.test.mjs imports it directly. */

export type SettingsCapability = 'backup' | 'reminders' | 'googleCalendar'

export type SettingsPageId = 'general' | 'brief' | 'tasks' | 'connections' | 'data'

export interface SettingsPage {
  id: SettingsPageId
  label: string
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: 'general', label: 'General' },
  { id: 'brief', label: 'Today & brief' },
  { id: 'tasks', label: 'Tasks & capture' },
  { id: 'connections', label: 'Connections' },
  { id: 'data', label: 'Data' },
]

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'general'

export interface SettingsSection {
  id: string
  label: string
  page: SettingsPageId
  requires?: SettingsCapability
  standalone?: boolean
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'appearance', label: 'Appearance', page: 'general' },
  { id: 'demo', label: 'Demo mode', page: 'general' },
  { id: 'about', label: 'About', page: 'general' },
  { id: 'today-brief', label: 'Today & brief', page: 'brief' },
  { id: 'capture-routes', label: 'Capture routes', page: 'tasks' },
  { id: 'labels', label: 'Labels', page: 'tasks' },
  { id: 'reminders', label: 'Reminders', page: 'tasks', requires: 'reminders', standalone: true },
  { id: 'integrations', label: 'API keys', page: 'connections' },
  { id: 'obsidian', label: 'Obsidian', page: 'connections' },
  { id: 'todoist-sync', label: 'Todoist sync', page: 'connections' },
  { id: 'calendars', label: 'Calendars', page: 'connections' },
  { id: 'google-calendar', label: 'Phone alerts', page: 'connections', requires: 'googleCalendar', standalone: true },
  { id: 'sync', label: 'Sync', page: 'data' },
  { id: 'backups', label: 'Backups', page: 'data', requires: 'backup', standalone: true },
  { id: 'maintenance', label: 'Maintenance', page: 'data' },
]

/** Sections the current provider can actually render, in page order. */
export function visibleSections(
  caps: Record<SettingsCapability, boolean>,
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): SettingsSection[] {
  return sections.filter((s) => !s.requires || caps[s.requires])
}

/** Pages holding at least one of `sections`, in rail order. */
export function visiblePages(
  sections: readonly SettingsSection[],
  pages: readonly SettingsPage[] = SETTINGS_PAGES,
): SettingsPage[] {
  const used = new Set(sections.map((s) => s.page))
  return pages.filter((p) => used.has(p.id))
}

/** The given sections that live on `page`, order kept. */
export function sectionsOnPage(sections: readonly SettingsSection[], page: SettingsPageId): SettingsSection[] {
  return sections.filter((s) => s.page === page)
}

/** The page to show: `requested` while it is visible, otherwise the first
 *  visible page (a remembered page can disappear, e.g. an empty slot). */
export function resolveSettingsPage(requested: SettingsPageId, pages: readonly SettingsPage[]): SettingsPageId | null {
  if (pages.some((p) => p.id === requested)) return requested
  return pages[0]?.id ?? null
}

/** Where a deep link to `sectionId` lands. Unknown ids open the default page. */
export function settingsTarget(
  sectionId: string,
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): { page: SettingsPageId; section: string | null } {
  const hit = sections.find((s) => s.id === sectionId)
  return hit ? { page: hit.page, section: hit.id } : { page: DEFAULT_SETTINGS_PAGE, section: null }
}
```

- [ ] **Step 4: Run the tests and watch them pass.**

Run: `cd apps/desktop && node --test tests/settingsSections.test.mjs`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Type-check.** `SettingsPage.tsx` still uses only `visibleSections` and `activeSectionId`, so it compiles unchanged; the body map has no `today-brief` key yet, so that section renders nothing.

Run: `cd apps/desktop && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add apps/desktop/src/lib/settingsSections.ts apps/desktop/tests/settingsSections.test.mjs
git commit -m "feat(settings): group sections into five sub-pages in the registry"
```

---

### Task 2: Settings nav store and deep links

A session-scoped store remembers the current sub-page and carries a one-shot deep link. `openSettings(sectionId)` replaces the two ad-hoc "go to Settings" jumps that should land on a section.

**Files:**
- Create: `apps/desktop/src/stores/settingsNavStore.ts`
- Modify: `apps/desktop/src/components/shared/SyncHealthBanner.tsx` (the `openSettings` const, currently lines 43–52, plus imports)
- Modify: `apps/desktop/src/components/layout/NavSidebar.tsx:349` (Demo pill `onClick`) plus import

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS_PAGE`, `settingsTarget`, `SettingsPageId` from Task 1.
- Produces:
  - `useSettingsNavStore` (zustand) with state `{ page: SettingsPageId; pendingSection: string | null }` and actions `showPage(page: SettingsPageId): void` (sets page, clears `pendingSection`) and `clearPendingSection(): void`.
  - `openSettings(sectionId: string): void`: sets `{ page, pendingSection }` from `settingsTarget(sectionId)`, then `useAppStore.getState().setCurrentPage('settings')`. **Lane B uses this** for "Settings → Today & brief" (`openSettings('today-brief')`).

- [ ] **Step 1: Create the store** at `apps/desktop/src/stores/settingsNavStore.ts`:

```ts
import { create } from 'zustand'
import { useAppStore } from '@/stores/appStore'
import { DEFAULT_SETTINGS_PAGE, settingsTarget, type SettingsPageId } from '@/lib/settingsSections'

// Which Settings sub-page is showing. Kept for the session (not persisted)
// so Cmd+, and `g ,` reopen the last one. `pendingSection` is a one-shot
// deep link: SettingsPage scrolls to it after the page renders, then clears it.
interface SettingsNavState {
  page: SettingsPageId
  pendingSection: string | null
  showPage: (page: SettingsPageId) => void
  clearPendingSection: () => void
}

export const useSettingsNavStore = create<SettingsNavState>((set) => ({
  page: DEFAULT_SETTINGS_PAGE,
  pendingSection: null,
  showPage: (page) => set({ page, pendingSection: null }),
  clearPendingSection: () => set({ pendingSection: null }),
}))

/** Open Settings on the page that holds `sectionId`, scrolled to it. */
export function openSettings(sectionId: string) {
  const { page, section } = settingsTarget(sectionId)
  useSettingsNavStore.setState({ page, pendingSection: section })
  useAppStore.getState().setCurrentPage('settings')
}
```

- [ ] **Step 2: Rewire the sync banner.** In `SyncHealthBanner.tsx`, add `import { openSettings } from '@/stores/settingsNavStore'` and replace the whole `openSettings` const (the double `requestAnimationFrame` + `getElementById('todoist-sync')` block) with:

```tsx
  const openTodoistSettings = () => openSettings('todoist-sync')
```

Then change the button's `onClick={openSettings}` to `onClick={openTodoistSettings}`. If `useAppStore` has no other use left in the file, remove its import (check with `grep -n useAppStore`).

- [ ] **Step 3: Rewire the Demo pill.** In `NavSidebar.tsx`, add `import { openSettings } from '@/stores/settingsNavStore'` and change the Demo pill's `onClick={() => setCurrentPage('settings')}` (line 349, inside the `{demoMode && (` block) to `onClick={() => openSettings('demo')}`. Leave the Settings nav button (line ~416, `handleNavClick('settings')`) alone: it reopens the last sub-page. Leave the comment above the pill ("click jumps to Settings to toggle off") as is; it's still true.

- [ ] **Step 4: Type-check and run the suite.**

Run: `cd apps/desktop && npx tsc -b && node --test tests/*.test.mjs`
Expected: no type errors; all tests pass (331 baseline + Task 1's net new).

- [ ] **Step 5: Commit.**

```bash
git add apps/desktop/src/stores/settingsNavStore.ts apps/desktop/src/components/shared/SyncHealthBanner.tsx apps/desktop/src/components/layout/NavSidebar.tsx
git commit -m "feat(settings): nav store with openSettings deep links"
```

---

### Task 3: Render one sub-page at a time

`SettingsPage` shows only the active page's sections. The rail lists pages (buttons) and nests the active page's section links (anchors, scroll-spy as today). Switching pages resets the scroll; a pending deep link scrolls to its section instead. The `today-brief` slot is added as `null`.

**Files:**
- Modify: `apps/desktop/src/components/pages/SettingsPage.tsx`: imports (`:54`), the `sections`/`sectionIds`/scroll-spy block (`:1370-1376`), the `integrations` body title (`:1589-1592`), the Maintenance `<details>` (`:1760-1763`), the `bodies` map (add `'today-brief'`), and the returned JSX (`:1808-1848`)

**Interfaces:**
- Consumes: `visiblePages`, `sectionsOnPage`, `resolveSettingsPage`, `DEFAULT_SETTINGS_PAGE` (Task 1); `useSettingsNavStore` (Task 2).
- Produces: the mount slot for Lane B: the `bodies` entry `'today-brief': null`. Lane B's contract: its component renders one root `<section id="today-brief" className=…>` (same `SECTION_CLASS` recipe and a `SectionHeader`-style title) so the rail link and `openSettings('today-brief')` both land on it.

- [ ] **Step 1: Imports.** Change line 54 to:

```ts
import {
  visibleSections,
  visiblePages,
  sectionsOnPage,
  resolveSettingsPage,
  activeSectionId,
  DEFAULT_SETTINGS_PAGE,
} from '@/lib/settingsSections'
import { useSettingsNavStore } from '@/stores/settingsNavStore'
```

- [ ] **Step 2: Move the page/section derivation below `bodies`.** Delete these two lines near the top of `SettingsPage()` (`:1375-1376`):

```ts
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections])
  const { active: activeSection, select: selectSection } = useSettingsScrollSpy(sectionIds)
```

Keep the `sections` `useMemo` above them. Add the store reads next to the other hooks at the top of the component (after `const [maintenanceOpen, …]`):

```ts
  const storedPage = useSettingsNavStore((s) => s.page)
  const showPage = useSettingsNavStore((s) => s.showPage)
  const pendingSection = useSettingsNavStore((s) => s.pendingSection)
  const clearPendingSection = useSettingsNavStore((s) => s.clearPendingSection)
  const contentRef = useRef<HTMLDivElement>(null)
```

Then, **after** the closing `}` of the `bodies` object and before `return (`, add:

```tsx
  // A section renders only when it has a body; `today-brief` stays null
  // until Lane B mounts its component, which keeps "Today & brief" out of
  // the rail until then.
  const renderable = sections.filter((s) => bodies[s.id] != null)
  const pages = visiblePages(renderable)
  const page = resolveSettingsPage(storedPage, pages) ?? DEFAULT_SETTINGS_PAGE
  const pageSections = sectionsOnPage(renderable, page)
  const { active: activeSection, select: selectSection } = useSettingsScrollSpy(pageSections.map((s) => s.id))

  // A new page starts at its top…
  useEffect(() => {
    if (contentRef.current) findScroller(contentRef.current).scrollTop = 0
  }, [page])

  // …unless a deep link names a section; this effect runs after the one
  // above, so the section wins. Clearing it re-runs only this effect.
  useEffect(() => {
    if (!pendingSection) return
    const el = document.getElementById(pendingSection)
    if (el) {
      el.scrollIntoView({ block: 'start' })
      selectSection(pendingSection)
    }
    clearPendingSection()
  }, [pendingSection, page, selectSection, clearPendingSection])
```

These hooks sit after a plain object, never after an early return, so hook order stays stable. `useSettingsScrollSpy` keys its effect on `ids.join(',')`, so a fresh array each render is fine, and a page switch re-runs its geometry pass.

- [ ] **Step 3: Body edits.**
  1. In the `integrations` body, change `title="Integrations"` to `title="API keys"` (keep the description and the `id="integrations"`).
  2. Make Maintenance's disclosure controlled, so a remount after switching pages can't leave `maintenanceOpen` true while `<details>` is closed. Change

     ```tsx
        <details
          className="group rounded-lg border"
          onToggle={(e) => setMaintenanceOpen(e.currentTarget.open)}
        >
     ```

     to

     ```tsx
        <details
          open={maintenanceOpen}
          className="group rounded-lg border"
          onToggle={(e) => setMaintenanceOpen(e.currentTarget.open)}
        >
     ```

  3. Add the Lane B slot as the fourth entry of `bodies`, right after `about`:

     ```tsx
    /* Lane B mounts <TodayBriefSettings /> here (one root
       <section id="today-brief">). While null, the page stays hidden. */
    'today-brief': null,
     ```

- [ ] **Step 4: Replace the returned JSX** (the whole `return ( <PageFrame …> … </PageFrame> )`) with:

```tsx
  const pageButtonClass = (current: boolean) =>
    cn(
      'rounded-md px-2 py-1 text-left transition-colors duration-(--transition-fast) hover:bg-hover hover:text-foreground',
      current ? 'text-body-strong text-foreground' : 'text-muted-foreground',
    )

  return (
    <PageFrame title="Settings" width="wide" bodyClassName="flex gap-8">
      {/* Left rail — the sub-pages; the current page's sections nest under it */}
      <nav
        aria-label="Settings pages"
        className="sticky top-[calc(var(--page-header-h)+1.5rem)] hidden w-40 shrink-0 self-start md:block"
      >
        <ul className="space-y-0.5 text-body">
          {pages.map((p) => {
            const isCurrent = p.id === page
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => showPage(p.id)}
                  className={cn('block w-full', pageButtonClass(isCurrent))}
                >
                  {p.label}
                </button>
                {isCurrent && pageSections.length > 1 && (
                  <ul aria-label={`${p.label} sections`} className="mt-0.5 mb-1 space-y-0.5">
                    {pageSections.map((s) => {
                      const isActive = activeSection === s.id
                      return (
                        <li key={s.id}>
                          <a
                            href={`#${s.id}`}
                            aria-current={isActive ? 'true' : undefined}
                            onClick={() => selectSection(s.id)}
                            className={cn(
                              'block rounded-md py-1 pl-5 pr-2 transition-colors duration-(--transition-fast) hover:bg-hover hover:text-foreground',
                              isActive ? 'text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {s.label}
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Main content — the current page's sections, in registry order.
          Section offset on every direct child, so the standalone Backups /
          Reminders / Phone alerts components land like the rest. */}
      <div
        ref={contentRef}
        className="flex-1 min-w-0 space-y-8 [&>section]:scroll-mt-[calc(var(--page-header-h)+1.5rem)]"
      >
        {/* Below md the rail is hidden; keep every page reachable */}
        <nav aria-label="Settings pages" className="flex flex-wrap gap-1 md:hidden">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === page ? 'page' : undefined}
              onClick={() => showPage(p.id)}
              className={cn('text-body', pageButtonClass(p.id === page))}
            >
              {p.label}
            </button>
          ))}
        </nav>
        {pageSections.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && !s.standalone && <Separator />}
            {bodies[s.id]}
          </Fragment>
        ))}
      </div>
    </PageFrame>
  )
```

The narrow-screen `<nav>` is a direct child of the content column but not a `<section>`, so the `[&>section]` offset doesn't touch it. On desktop it's `display:none` (`md:hidden`), which has no box, so its `space-y-8` margin never renders.

- [ ] **Step 5: Type-check, lint the file, run the suite, build both targets.**

Run: `cd apps/desktop && npx tsc -b && node --test tests/*.test.mjs && npm run build && npm run build:web`
Expected: no type errors; all tests pass; both builds green.

Then lint: `cd apps/desktop && npx eslint src/components/pages/SettingsPage.tsx src/stores/settingsNavStore.ts src/components/shared/SyncHealthBanner.tsx src/components/layout/NavSidebar.tsx`. Expected: zero problems that weren't already on `main`. For the baseline, run the same eslint command in the main checkout (`/Users/marcosevilla/Developer/marco-task-app/nimble/apps/desktop`) and compare the counts. Never use `git stash` for this; the stash is shared with the other lane.

- [ ] **Step 6: Check it in a browser.** From `apps/desktop`, run `npm run dev` (desktop Vite config) and open it with Playwright, injecting `../../tools/mock-tauri.js` via `addInitScript` before the bundle loads (it polyfills all 143 Tauri commands, so Backups / Reminders / Phone alerts render). Add a **second** `addInitScript`, after the mock, that forces the two deep-link entry points to show:

```js
const base = window.__TAURI_INTERNALS__.invoke
window.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
  if (cmd === 'demo_status') return Promise.resolve(true)
  if (cmd === 'get_todoist_sync_status') {
    return base(cmd, args, opts).then((s) => ({ ...s, last_error: 'mock: token rejected' }))
  }
  return base(cmd, args, opts)
}
```

Viewport 1280×800. Screenshot each state to the session scratchpad. Check:
  1. Settings opens on **General**; the rail shows General · Tasks & capture · Connections · Data (no "Today & brief"), with General's three sections nested and Appearance highlighted.
  2. Click **Connections**: API keys is at the top of the content column, the page is scrolled to the top, and five section links are nested. Scroll to the bottom: the highlight follows to Phone alerts. Click **Data**: it starts at its top, and Sync is highlighted.
  3. Expand Maintenance on Data, switch to General, and return to Data: the disclosure is open and its sync tools show, or it is closed with no tools. Never a mismatch.
  4. Go to Tasks, then use `Cmd+,` (or `g ,`): Settings reopens on the page you last used.
  5. Deep links, with Settings last left on **Data**: go to Tasks and click the banner's **Open settings**. Expected: Connections, scrolled so Todoist sync sits under the header, and that link highlighted. Go to Tasks again and click the **Demo** pill in the nav. Expected: General, scrolled to Demo mode, and that link highlighted.
  6. Resize to 700×800: the rail is gone, and a row of page buttons above the content switches pages.
  7. Light and dark theme screenshots of Connections.
  If the dev build can't render Settings with the mock, say so in the report and list what couldn't be checked. Don't hand-edit `index.html` or `public/` to make it work.

- [ ] **Step 7: Commit.**

```bash
git add apps/desktop/src/components/pages/SettingsPage.tsx
git commit -m "feat(settings): render one sub-page at a time with a page rail"
```

---

## Handoff note for Lane B (put in the final report, not in NEXT.md)

After this merges, mounting brief settings is: `import { TodayBriefSettings } from '@/components/settings/TodayBriefSettings'` plus replacing `'today-brief': null,` with `'today-brief': <TodayBriefSettings />,` in `SettingsPage.tsx`'s `bodies`. The component's root is `<section id="today-brief" className="space-y-4 scroll-mt-[calc(var(--page-header-h)+1.5rem)]">`. The page appears in the rail on its own. Opening it from elsewhere (brief ⋯ → Customize) is `openSettings('today-brief')` from `@/stores/settingsNavStore`.
