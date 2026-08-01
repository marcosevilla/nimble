# Today Page — Audit Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Worktrees are required** — see Workspace Setup below.

**Goal:** Resolve 32 findings from the dry-run #1 audit of the Today page (empty state, Review mode), bringing the surface into alignment with `daily-triage/docs/ux-intent.md`.

**Architecture:** Fixes are split into seven lanes. Five are independent and can ship without a design decision (A: no-guilt language, B: calendar error chrome, C: color tokens, E: button base, G: misc safety). Two depend on **Gate 0** — a composition decision about focal point and greeting placement that must be resolved before lanes D and F can execute (lane F's stagger / radius / animation choices are reactions to lane D's layout).

**Tech Stack:** React 19, Tailwind v4, shadcn/ui (base-nova), Tauri 2.0 webview. No unit tests (per `daily-triage/CLAUDE.md`). Verification substitutes: `npm run build` (TS clean), Playwright MCP smoke at `http://localhost:5173/` with the DEV bypass `window.__stores.useAppStore.getState().setSetupComplete(true)`, and visual diff against `/Users/marcosevilla/Developer/marco-task-app/smoke-today-after-bypass.png`.

---

## Workspace Setup

**Per `daily-triage/docs/audit-loop-playbook.md` step 3 — non-negotiable:**

- [ ] **Setup 1: Create worktrees for parallel lanes**

Run `superpowers:using-git-worktrees` skill. Two concurrent worktrees max for this dry run. Suggested assignment:
- Worktree A — lanes A, B, C, E, G (independent, no composition dependency)
- Worktree B — held until Gate 0 resolves, then runs lanes D and F

```bash
# Create worktrees from main (run from repo root)
git worktree add ../marco-task-app-audit-1 main
git worktree add ../marco-task-app-audit-2 main
```

---

## Gate 0 — Composition Decision (BLOCKING for lanes D + F)

Marco must answer these four questions before lanes D and F execute. Lane D writes the layout; lane F polishes it. If composition shifts, polish gets redone.

| # | Question | Options | Default if no answer |
|---|---|---|---|
| 1 | **Focal point** | (a) constrain review column to ~520px centered, OR (b) keep full width and elevate via `bg-muted/20` page + `bg-card` card | (a) — interface-craft critique specifically calls for this |
| 2 | **Greeting alignment** | (a) left-align everywhere, OR (b) commit to centered "moment" with vertical breathing room | (a) — matches the rest of the app's rhythm |
| 3 | **Greeting + PageHeader date redundancy** | (a) keep PageHeader date, drop greeting subtitle, OR (b) drop PageHeader meta, let greeting carry day-context, OR (c) keep both, accept duplication | (a) — most Linear-like |
| 4 | **Step runway** | (a) show "Step 1 of 3" meta line, OR (b) render upcoming steps as ghosted/dimmed rows | (b) — more informative, matches §1.6 expectation setting |

**Record the decision inline below before proceeding to lanes D/F:**

- [ ] **Gate 0 resolved.** Decisions: 1=___ 2=___ 3=___ 4=___ . Signed off by Marco on YYYY-MM-DD.

---

## Lane A — No-guilt language (3 tasks, blockers)

Lane A removes literal "Overdue" / "need attention" framing — direct §1.1 + §3.1 anti-pattern violations. Independent of all other lanes.

### Task A1: Rename `groupByUrgency` "Overdue" group → "Still open"

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:62-83`

- [ ] **Step 1: Apply the rename**

Replace the body of `groupByUrgency` (lines 62-83):

```ts
function groupByUrgency(tasks: TodoistTaskRow[]): UrgencyGroup[] {
  const today = new Date().toISOString().slice(0, 10)
  const stillOpen: TodoistTaskRow[] = []
  const highPriority: TodoistTaskRow[] = []
  const dueToday: TodoistTaskRow[] = []
  const quickWins: TodoistTaskRow[] = []

  for (const task of tasks) {
    const isCarriedOver = task.due_date != null && task.due_date < today
    if (isCarriedOver) stillOpen.push(task)
    else if (task.priority >= 3) highPriority.push(task)
    else if (task.content.length < 50 && task.priority <= 2) quickWins.push(task)
    else dueToday.push(task)
  }

  const groups: UrgencyGroup[] = []
  if (stillOpen.length > 0) groups.push({ key: 'still-open', title: 'Still open', tasks: stillOpen, defaultOpen: true })
  if (highPriority.length > 0) groups.push({ key: 'high', title: 'High priority', tasks: highPriority, defaultOpen: true })
  if (dueToday.length > 0) groups.push({ key: 'today', title: 'Due today', tasks: dueToday, defaultOpen: true })
  if (quickWins.length > 0) groups.push({ key: 'quick', title: 'Quick wins', tasks: quickWins, defaultOpen: false })
  return groups
}
```

Also lowercases "High Priority", "Due Today", "Quick Wins" to sentence case to match the rest of the app's copy convention (§1.4).

- [ ] **Step 2: Search for residual "Overdue" string usage**

Run: `grep -rn "Overdue\|overdue" daily-triage/apps/desktop/src --include="*.tsx" --include="*.ts"`
Expected: only matches in `TaskRow.tsx` / Todoist data shape comments — flag any user-facing string. If a user-facing string appears outside lane A's scope (e.g. in a tooltip), append it as a sub-task here.

- [ ] **Step 3: TS clean**

Run: `cd daily-triage/apps/desktop && npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "fix(today): rename 'Overdue' urgency group to 'Still open' per §1.1"
```

### Task A2: Rewrite `TriageSection` copy + variable

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:170-206`

- [ ] **Step 1: Rewrite the function**

Replace lines 170-206 with:

```tsx
function TriageSection({
  todoistTasks,
  onSnooze,
}: {
  todoistTasks: TodoistTaskRow[]
  onSnooze: (id: string) => void
}) {
  const carriedOver = todoistTasks.filter((t) => {
    const today = new Date().toISOString().slice(0, 10)
    return t.due_date != null && t.due_date < today
  })
  const highPriority = todoistTasks.filter((t) => t.priority >= 3)
  const stillOpen = [...carriedOver, ...highPriority.filter((t) => !carriedOver.includes(t))]

  if (stillOpen.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        Nothing left to triage.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      <Meta as="p" className="mb-2">
        {stillOpen.length} still open — clear or carry forward.
      </Meta>
      {stillOpen.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onSnooze={onSnooze}
        />
      ))}
    </div>
  )
}
```

Three changes: `overdue` → `carriedOver`; `needsAttention` → `stillOpen`; copy from "{n} items need attention. Complete or snooze to clear them." → "{n} still open — clear or carry forward."; positive empty state changed from "Nothing urgent — you're in good shape." (still performs urgency) to "Nothing left to triage." Both copy lines drop urgency framing per §1.1.

- [ ] **Step 2: TS clean**

Run: `cd daily-triage/apps/desktop && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "fix(today): triage copy uses 'still open' framing, not 'needs attention' (§1.1)"
```

### Task A3: Add evening greeting variant

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:26-31, 239`

- [ ] **Step 1: Extend `getGreeting()` with a subtitle**

Replace the helper at line 26 with:

```ts
function getGreeting(): { headline: string; subtitle: string } {
  const hour = new Date().getHours()
  if (hour < 12) return { headline: 'Good morning', subtitle: "Let's plan your day." }
  if (hour < 17) return { headline: 'Good afternoon', subtitle: "Pick up where you left off." }
  return { headline: 'Good evening', subtitle: 'Quick end-of-day pass?' }
}
```

- [ ] **Step 2: Update callsites**

Two callsites use `getGreeting()`: ReviewMode at `TodayPage.tsx:237-240`, DashboardMode at `:380-387`. Update both. In ReviewMode replace lines 237-240 with:

```tsx
{(() => { const g = getGreeting(); return (
  <div className="text-center space-y-1 py-4">
    <h2 className="text-heading">{g.headline}</h2>
    <p className="text-body text-muted-foreground pt-1">{g.subtitle}</p>
  </div>
)})()}
```

In DashboardMode replace lines 380-387 with:

```tsx
{(() => { const g = getGreeting(); return (
  <div className="mb-2 space-y-1">
    <h2 className="text-heading">{g.headline}</h2>
    {total > 0 ? (
      <p className="text-body text-muted-foreground">
        {remaining === 0 ? 'All done for today.' : `${remaining} item${remaining === 1 ? '' : 's'} remaining`}
      </p>
    ) : (
      <p className="text-body text-muted-foreground">{g.subtitle}</p>
    )}
  </div>
)})()}
```

(DashboardMode falls back to the subtitle only when there's nothing to summarize — otherwise the count is more useful.)

- [ ] **Step 3: TS clean**

Run: `cd daily-triage/apps/desktop && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "feat(today): time-aware greeting subtitle (morning/afternoon/evening)"
```

---

## Lane B — Calendar error chrome (2 tasks, blocker)

The right rail's red "Could not load calendar" + Retry block is flagged by all three audit lanes as the loudest mistake on the page. Independent.

### Task B1: Demote calendar error from destructive to muted

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/calendar/CalendarPanel.tsx:491-498`

- [ ] **Step 1: Rewrite the error branch**

Replace lines 491-498:

```tsx
{error && (
  <div className="flex items-center gap-2 mb-2 text-meta text-muted-foreground">
    <span>Calendar offline.</span>
    <Button
      variant="ghost"
      size="xs"
      onClick={refresh}
      className="h-5 px-1 text-muted-foreground hover:text-foreground"
    >
      Retry
    </Button>
  </div>
)}
```

Changes: drops `text-destructive`; sentence shortened from "Could not load calendar" to "Calendar offline." (less alarming, more factual); inline layout instead of `space-y-2` stack; Retry shrinks to `size="xs"` ghost so it stops competing with `Today` in the page header. §1.1 + §1.4 + §3.1.

- [ ] **Step 2: Playwright smoke check (must run with Vite dev server up)**

```bash
# Assumes Vite is already running at http://localhost:5173/
# Use Playwright MCP to navigate, bypass onboarding, screenshot.
```

Via Playwright MCP:
1. `browser_navigate` to `http://localhost:5173/`
2. `browser_evaluate` `window.__stores.useAppStore.getState().setSetupComplete(true)`
3. `browser_take_screenshot` saving to `daily-triage/docs/audit-findings/today/after-lane-b.png`
4. `browser_evaluate` `getComputedStyle(document.querySelector('[class*="text-destructive"]') ?? document.body).color` — expected: no element matches the destructive selector in the calendar rail.

- [ ] **Step 3: TS clean + commit**

```bash
cd daily-triage/apps/desktop && npm run build
git add daily-triage/apps/desktop/src/components/calendar/CalendarPanel.tsx daily-triage/docs/audit-findings/today/after-lane-b.png
git commit -m "fix(calendar): demote load failure from destructive red to muted text (§1.1, §1.4)"
```

### Task B2: Right-rail header — match optical weight of "May" and "Sun 10"

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/calendar/CalendarPanel.tsx` (DayNavigationHeader, ~line 483 — grep `DayNavigationHeader` definition to find the actual file/lines)

- [ ] **Step 1: Find the header component**

Run: `grep -rn "function DayNavigationHeader\|export.*DayNavigationHeader" daily-triage/apps/desktop/src --include="*.tsx"`. Open the file at the matching line.

- [ ] **Step 2: Align type scale**

In DayNavigationHeader, find the elements rendering the month label (`"May"`) and the date label (`"Sun 10"`). They likely use different type tokens. Replace both with the same token — `text-label text-muted-foreground` is the right pick (§1.4 chrome/restraint). Inline the collapse icon button into the same flex row instead of letting it sit unmoored top-right. Concrete shape (apply with judgement once you can see the actual JSX):

```tsx
<div className="flex items-center justify-between gap-2 mb-2">
  <span className="text-label text-muted-foreground">{monthLabel}</span>
  <div className="flex items-center gap-1">
    <button onClick={onPrev}>{/* chevron-left */}</button>
    <span className="text-label text-muted-foreground tabular-nums">{dateLabel}</span>
    <button onClick={onNext}>{/* chevron-right */}</button>
  </div>
  <button onClick={onCollapse} className="ml-auto">{/* collapse */}</button>
</div>
```

- [ ] **Step 3: TS clean + commit**

```bash
cd daily-triage/apps/desktop && npm run build
git add daily-triage/apps/desktop/src/components/calendar/CalendarPanel.tsx
git commit -m "fix(calendar): unify header type scale and inline collapse icon (§1.4)"
```

---

## Lane C — Color token cleanup (3 tasks, major)

Three recurring color violations: hardcoded Tailwind palette values, ad-hoc opacity scale, `font-semibold` instead of `text-body-strong`. Independent.

### Task C1: Replace `bg-accent-blue` / `bg-green-500` in `ProgressBar`

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:33-51`
- Modify: `daily-triage/apps/desktop/src/index.css` (add `--canary-success` token if not present)

- [ ] **Step 1: Check whether a success token exists**

Run: `grep -n "success\|--canary-" daily-triage/apps/desktop/src/index.css`. If a `--canary-success` or `--color-success` token exists, skip Step 2 and use it directly in Step 3. If not, do Step 2.

- [ ] **Step 2: Add semantic success token to theme**

In `index.css`, locate the `:root` block (warm palette). Add a `--canary-success` token defined in terms of an existing warm palette ramp (avoid pure `green-500`). Example shape:

```css
:root {
  /* ... existing tokens ... */
  --canary-success: oklch(0.62 0.14 145);
  --canary-success-fg: oklch(0.98 0 0);
}

.dark {
  --canary-success: oklch(0.70 0.16 150);
  --canary-success-fg: oklch(0.16 0 0);
}
```

Register the token in `lib/utils.ts` `extendTailwindMerge` arrays (per the 2026-04-18 lesson — every new `bg-*`/`text-*` token must register). Map `--canary-success` to a Tailwind utility (e.g. `bg-success`) in the theme block.

- [ ] **Step 3: Update `ProgressBar`**

Replace lines 33-51:

```tsx
function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="flex items-center gap-3 mb-4 animate-progress-enter">
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            pct === 100 ? 'bg-success' : 'bg-foreground/40',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-label text-muted-foreground tabular-nums">
        {completed}/{total}
      </span>
    </div>
  )
}
```

Changes: cool `bg-accent-blue` → neutral `bg-foreground/40` (progress is not semantic, just neutral); `bg-green-500` → `bg-success`; `transition-all` → `transition-[width]` (only width animates here).

- [ ] **Step 4: TS clean + commit**

```bash
cd daily-triage/apps/desktop && npm run build
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx daily-triage/apps/desktop/src/index.css daily-triage/apps/desktop/src/lib/utils.ts
git commit -m "fix(today): ProgressBar uses semantic tokens, not bg-accent-blue / bg-green-500 (§1.4, §3.4)"
```

### Task C2: Step-circle badge — use `bg-success` + drop `font-semibold`

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:109-115`

- [ ] **Step 1: Check for `text-meta-strong` token**

Run: `grep -n "text-meta-strong\|--text-meta" daily-triage/apps/desktop/src/index.css daily-triage/apps/desktop/src/components/shared/typography.tsx 2>/dev/null`. If `text-meta-strong` exists, use it directly. If not, fall through to using `text-body-strong` at a smaller scale, or define `text-meta-strong` in index.css mirroring the existing `text-body-strong` pattern.

- [ ] **Step 2: Update the badge**

Replace lines 109-116:

```tsx
<div className="flex items-center gap-2 mb-3">
  <span className={cn(
    'flex size-6 items-center justify-center rounded-full text-meta-strong',
    done ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
  )}>
    {done ? <Check className="size-3.5" /> : step}
  </span>
```

Drops the `font-semibold` deliberate carve-out, uses `text-meta-strong` for system-driven typography, swaps `bg-green-500/10 text-green-500` → `bg-success/10 text-success`.

- [ ] **Step 3: TS clean + commit**

```bash
cd daily-triage/apps/desktop && npm run build
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx daily-triage/apps/desktop/src/index.css
git commit -m "fix(today): step badge uses text-meta-strong + bg-success tokens (§3.4)"
```

### Task C3: Collapse the ad-hoc opacity scale

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:106, 397, 401, 418, 449`

The five instances of `bg-muted/5`, `bg-muted/30`, `border-border/30`, `border-border/20`, `divide-border/20`, `text-muted-foreground/40` are hand-picked mini-tokens. Collapse them into two named tiers.

- [ ] **Step 1: Decide the tier mapping**

Two tiers cover all five sites:

| Original | Used at | New utility |
|---|---|---|
| `bg-muted/5` | TodayPage.tsx:397 (brief container) | `bg-muted/30` (one tier — drop the extremely-subtle 5%) |
| `bg-muted/30` | TodayPage.tsx:106 (inactive step card) | `bg-muted/30` (keep) |
| `border-border/30` | TodayPage.tsx:106 | `border-border/30` (keep) |
| `border-border/20` | TodayPage.tsx:397 | `border-border/30` (collapse to one tier) |
| `divide-border/20` | TodayPage.tsx:418, :449 | `divide-border/30` (collapse to one tier) |
| `text-muted-foreground/40` | TodayPage.tsx:401 | `text-muted-foreground` (drop the doubled muting — `text-muted-foreground` is already muted) |

- [ ] **Step 2: Apply replacements**

Edit each site listed above. Use a single editor pass — keep diffs small. Example for line 106:

```tsx
// Before
active ? 'bg-card border-border' : 'bg-muted/30 border-border/30',
// After (no change at line 106 — already on the chosen tier; verify)
```

Line 397 — brief container:

```tsx
// Before
<div className="rounded-lg border border-border/20 bg-muted/5 p-4">
// After
<div className="rounded-lg border border-border/30 bg-muted/30 p-4">
```

Line 401 — empty brief copy:

```tsx
// Before
<p className="text-meta text-muted-foreground/40 text-center py-2">
// After
<p className="text-meta text-muted-foreground text-center py-2">
```

Lines 418, 449 — task list dividers:

```tsx
// Before
<div className="divide-y divide-border/20">
// After
<div className="divide-y divide-border/30">
```

- [ ] **Step 3: TS clean + visual diff**

```bash
cd daily-triage/apps/desktop && npm run build
```

Playwright smoke — screenshot Today page (with composition still pre-lane-D) and visually compare. Expected: subtle increase in border/bg contrast in the brief container and task divider areas. Save to `daily-triage/docs/audit-findings/today/after-lane-c.png`.

- [ ] **Step 4: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx daily-triage/docs/audit-findings/today/after-lane-c.png
git commit -m "fix(today): collapse ad-hoc opacity scale to two tiers (§1.4, §3.4)"
```

---

## Lane E — Button base polish (1 task, app-wide impact)

Fixes `transition-all` (§14) + adds `active:scale-[0.96]` press feedback (§12) in one edit. Affects every button in the app, so verify a couple of surfaces after, not just Today.

### Task E1: Replace `transition-all` with explicit transitions + add scale-on-press

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/ui/button.tsx:9`

- [ ] **Step 1: Update the base class**

Replace the base string in `buttonVariants` (line 9):

```ts
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-body-strong whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:scale-[0.97] motion-reduce:active:not-aria-[haspopup]:scale-100 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
```

Three changes from original:
- `transition-all` → `transition-[background-color,color,border-color,box-shadow,transform]` + explicit `duration-150`
- `active:not-aria-[haspopup]:translate-y-px` → `active:not-aria-[haspopup]:scale-[0.97]` (kept `not-aria-[haspopup]` so dropdown triggers don't bounce)
- Added `motion-reduce:active:not-aria-[haspopup]:scale-100` to respect prefers-reduced-motion

`0.97` chosen (not 0.96) because Button has variants from `h-6` (xs) to `h-9` (lg); 0.97 reads as tactile on small sizes without becoming a "fake button bounce" on default-size buttons.

- [ ] **Step 2: TS clean**

Run: `cd daily-triage/apps/desktop && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke — three surfaces, not just Today**

Via Playwright at `http://localhost:5173/` (with onboarding bypass):
1. Hover + click the `Next` button on Today review — should depress and return.
2. Navigate to Tasks (left rail icon) — click a button there.
3. Open Command Bar (likely Cmd+K) — confirm dropdown triggers do NOT bounce (the `not-aria-[haspopup]` guard prevents it).

Screenshot the Today page Next button in active state: `daily-triage/docs/audit-findings/today/after-lane-e.png`.

- [ ] **Step 4: Commit**

```bash
git add daily-triage/apps/desktop/src/components/ui/button.tsx daily-triage/docs/audit-findings/today/after-lane-e.png
git commit -m "fix(button): explicit transitions + scale-on-press; respects motion-reduce (§12, §14)"
```

---

## Lane G — Misc safety items (3 tasks)

Independent fixes: font smoothing, HelpPanel hit area, arbitrary spacing values.

### Task G1: Add `-webkit-font-smoothing` to root

**Files:**
- Modify: `daily-triage/apps/desktop/src/index.css:120-122`

- [ ] **Step 1: Update the body rule**

Replace the body rule:

```css
body {
  @apply bg-background text-foreground;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 2: Visual diff**

Screenshot Today page → save `daily-triage/docs/audit-findings/today/after-lane-g1.png`. Compare to baseline `smoke-today-after-bypass.png`. Geist glyphs should read crisper.

- [ ] **Step 3: Commit**

```bash
git add daily-triage/apps/desktop/src/index.css daily-triage/docs/audit-findings/today/after-lane-g1.png
git commit -m "fix(css): enable antialiased font smoothing app-wide on macOS"
```

### Task G2: HelpPanel hit-area to 40×40

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/shared/HelpPanel.tsx:181`

- [ ] **Step 1: Find current class string**

Read line 181. It will contain `'fixed bottom-4 right-4 z-30 flex size-9 ...'`.

- [ ] **Step 2: Extend the hit area via pseudo-element**

Keep the visual `size-9` (36px) — the icon button shouldn't grow visually. Extend the click target via a `before:` pseudo-element. Replace `size-9` part of the class string with:

```
size-9 before:absolute before:inset-[-2px] before:content-[''] before:rounded-full relative
```

(Adds `relative` so the pseudo-element positions correctly; `inset-[-2px]` extends 2px on each side → 40×40 total hit area.)

- [ ] **Step 3: TS clean + commit**

```bash
cd daily-triage/apps/desktop && npm run build
git add daily-triage/apps/desktop/src/components/shared/HelpPanel.tsx
git commit -m "fix(help-panel): extend hit area to 40x40 via pseudo-element (§3.6)"
```

### Task G3: Replace `max-h-[50vh]` and `pl-[62px]` with on-grid values

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:164, 256`

- [ ] **Step 1: Brief container max-height**

Replace line 256:

```tsx
// Before
<div className="max-h-[50vh] overflow-y-auto">
// After
<div className="max-h-[32rem] overflow-y-auto">
```

(`32rem` = 512px, on the 8px grid, fixed regardless of viewport.)

- [ ] **Step 2: "+N more" alignment**

Replace line 164:

```tsx
// Before
<Meta as="p" className="pl-[62px]">+{events.length - 5} more</Meta>
// After — align via flex column matching the time column above
<div className="flex items-center gap-3">
  <span className="w-14 shrink-0" />
  <Meta as="p">+{events.length - 5} more</Meta>
</div>
```

(`w-14` = 56px, matches the `w-14` time column at line 154.)

- [ ] **Step 3: TS clean + commit**

```bash
cd daily-triage/apps/desktop && npm run build
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "fix(today): replace arbitrary max-h-[50vh] / pl-[62px] with on-grid values (§3.5)"
```

---

## Merge checkpoint — lanes A/B/C/E/G

After all five independent lanes are done, merge worktree A back to main (or its base branch). Run final TS-clean + Playwright smoke. Then proceed to Gate 0.

- [ ] **Checkpoint 1: Worktree A → main**

```bash
cd /path/to/main/worktree
git merge audit-loop-1  # or whatever branch name
cd daily-triage/apps/desktop && npm run build
```

- [ ] **Checkpoint 2: Full smoke**

Restart Vite. Via Playwright:
1. Navigate, bypass onboarding.
2. Screenshot full page → `daily-triage/docs/audit-findings/today/after-checkpoint-1.png`.
3. Run `browser_console_messages` with `level: error` — expected: still only the 2 known Tauri `listen()` errors. Zero new errors.

- [ ] **Checkpoint 3: Gate 0 decision**

Marco fills in the four decisions in Gate 0 above. Without those, lanes D and F are blocked.

---

## Lane D — Composition (blocked until Gate 0) — 4-5 tasks

The exact shape of each task depends on Gate 0 answers. Below are the four decision branches, each with the resulting tasks.

### Decision 1 — Focal point

**If 1=(a) constrain column:**

#### Task D1a: Constrain review column to centered 520px

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:235` (ReviewMode wrapper)

- [ ] **Step 1: Wrap content**

Replace `<div className="px-5 py-6 space-y-4 w-full">` (line 235) with:

```tsx
<div className="px-5 py-6 w-full flex justify-center">
  <div className="w-full max-w-[520px] space-y-4">
```

Close the new inner `<div>` before the closing `</>` of ReviewMode.

- [ ] **Step 2: Verify dashboard mode is untouched**

DashboardMode (line 378) keeps full width — only Review mode gets the constraint.

**If 1=(b) elevate via bg layer:**

#### Task D1b: Elevate card surface

- [ ] **Step 1: Add subtle page background**

Apply `bg-muted/20` to the ReviewMode outer wrapper, keep `bg-card` on the step cards (already there). Lift card visual elevation via a subtle 1px border + bg differential rather than adding shadows (Linear-inspired restraint per §1.4).

### Decision 2 — Greeting alignment

**If 2=(a) left-align everywhere:**

#### Task D2a: Left-align both greeting blocks

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:237, 380`

- [ ] **Step 1: Remove `text-center`**

ReviewMode greeting (line 237): change `className="text-center space-y-1 py-4"` to `className="space-y-1 py-4"`.

DashboardMode greeting (line 380) is already left-aligned — no change.

**If 2=(b) center with breathing room:**

#### Task D2b: Commit to centered moment

- [ ] **Step 1: Add vertical space**

Change ReviewMode greeting wrapper `className="text-center space-y-1 py-4"` to `className="text-center space-y-2 py-8"`. Also center the DashboardMode greeting for continuity, OR accept the inconsistency as Review-mode-only.

### Decision 3 — PageHeader + greeting redundancy

**If 3=(a) keep PageHeader, drop greeting subtitle:**

#### Task D3a: Subtitle elision

The greeting headline stays ("Good evening"); the subtitle moves to PageHeader meta or disappears. PageHeader already shows "Today · Sunday, May 10" — that's the day context. Drop the `<p>` subtitle in ReviewMode entirely:

```tsx
<div className="space-y-1 py-4">
  <h2 className="text-heading">{g.headline}</h2>
</div>
```

**If 3=(b) drop PageHeader meta:**

#### Task D3b: Move date into greeting

PageHeader becomes title-only; greeting carries the date. Change `<PageHeader title="Today" meta={dateStr} />` to `<PageHeader title="Today" />`, and in greeting render `<p className="text-meta text-muted-foreground">{dateStr}</p>` below the headline.

**If 3=(c) keep both:** skip task.

### Decision 4 — Step runway

**If 4=(a) "Step 1 of 3" meta line:**

#### Task D4a: Add step meta

- [ ] **Step 1: Pass total to `ReviewStep`**

Add `totalSteps?: number` prop to `ReviewStep` signature. In each callsite (3 instances around lines 243, 270, 275), pass `totalSteps={3}`. Render under the badge:

```tsx
<span className="text-meta text-muted-foreground">Step {step} of {totalSteps}</span>
```

**If 4=(b) ghost upcoming steps:**

#### Task D4b: Render upcoming steps as ghost rows

- [ ] **Step 1: Modify the `if (!active && !done) return null` line**

`TodayPage.tsx:101`. Replace with:

```tsx
if (!active && !done) {
  return (
    <div className="rounded-lg p-4 opacity-40">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-meta-strong text-muted-foreground">
          {step}
        </span>
        <h3 className="text-body-strong text-muted-foreground">{title}</h3>
      </div>
    </div>
  )
}
```

(Renders the badge + title only, no body, half-opacity, no border — gives the runway without competing with the active card.)

### Task D5: Drop heavy card chrome on empty Step 1

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:243-267` (the first ReviewStep body)

- [ ] **Step 1: Conditional chrome for empty state**

When `brief === null` (no brief AND no calendar events were loaded), drop the heavy card surround. The simplest approach: keep `ReviewStep` chrome as-is but render the empty `CalendarGlance` with a leading icon to give it intentional presence. Combine with interface-craft finding from lane F (icon + copy row):

```tsx
// Inside CalendarGlance (line 142-148), replace:
if (events.length === 0) {
  return (
    <div className="flex items-center gap-2 text-body text-muted-foreground">
      <Coffee className="size-4 shrink-0" />
      <span>No meetings today — wide open for deep work.</span>
    </div>
  )
}
```

Import `Coffee` from `lucide-react`. The icon converts the empty state from "absent" to "intentional."

---

## Lane F — Page polish (blocked until Lane D completes) — 5 tasks

These tasks read the layout shape from Lane D. If composition shifts, F tasks re-evaluate.

### Task F1: Stagger `ReviewStep` enter animation

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:104-127`

- [ ] **Step 1: Split the enter animation across semantic chunks**

Replace the `ReviewStep` JSX (lines 104-127):

```tsx
return (
  <div className={cn(
    'rounded-lg border p-4 transition-all duration-300',
    active ? 'bg-card border-border' : 'bg-muted/30 border-border/30',
  )}>
    <div className="flex items-center gap-2 mb-3">
      <span className={cn(
        'flex size-6 items-center justify-center rounded-full text-meta-strong',
        done ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
        active && 'animate-row-enter',
      )}
      style={active ? { animationDelay: '0ms' } : undefined}>
        {done ? <Check className="size-3.5" /> : step}
      </span>
      <h3 className={cn(
        'text-body-strong',
        done && 'text-muted-foreground',
        active && 'animate-row-enter',
      )}
      style={active ? { animationDelay: '60ms' } : undefined}>
        {title}
      </h3>
    </div>
    {active && (
      <div className="animate-row-enter" style={{ animationDelay: '120ms' }}>
        {children}
      </div>
    )}
  </div>
)
```

(Removes the wrapper's `animate-in fade-in slide-in-from-bottom-2` — replaces with semantic stagger on badge / title / body. The Next button inside `children` rides the 120ms delay.)

- [ ] **Step 2: TS clean + visual smoke**

`npm run build`. Playwright: navigate, force a reload, screenshot ~250ms in (use `browser_evaluate` `setTimeout` if needed to capture mid-animation).

- [ ] **Step 3: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "feat(today): stagger ReviewStep enter — badge → title → body (§5)"
```

### Task F2: Greeting + subtitle independent enter

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:237` (ReviewMode greeting block)

- [ ] **Step 1: Stagger greeting and subtitle**

Replace the greeting block (after Gate 0 shape is settled — apply to whichever block survives lane D):

```tsx
<div className="space-y-1 py-4">
  <h2 className="text-heading animate-row-enter" style={{ animationDelay: '40ms' }}>
    {g.headline}
  </h2>
  <p className="text-body text-muted-foreground pt-1 animate-row-enter" style={{ animationDelay: '120ms' }}>
    {g.subtitle}
  </p>
</div>
```

(40ms before badge, 120ms after — places the greeting first in the eye's path, then the step card cascade.)

- [ ] **Step 2: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "feat(today): independent stagger for greeting + subtitle (§5, §1.6)"
```

### Task F3: Add `text-balance` to greeting, PageHeader, subtitle

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:238-239, 381-386`
- Modify: `daily-triage/apps/desktop/src/components/shared/PageHeader.tsx` (title line)

- [ ] **Step 1: Today greeting headlines**

Add `text-balance` to both `<h2 className="text-heading">` lines (Review + Dashboard greetings).

- [ ] **Step 2: Subtitles**

Add `[text-wrap:pretty]` to the `<p>` subtitle lines.

- [ ] **Step 3: PageHeader title**

Find the `<h1>` in PageHeader.tsx (around line 43-53). Add `text-balance` to its className. Add `relative top-px` to the meta `<span>` for optical baseline alignment.

- [ ] **Step 4: TS clean + commit**

```bash
cd daily-triage/apps/desktop && npm run build
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx daily-triage/apps/desktop/src/components/shared/PageHeader.tsx
git commit -m "fix: text-balance on headlines, optical baseline on PageHeader meta (§2, §10)"
```

### Task F4: Bump `ReviewStep` card radius for concentric corners

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:105, 397`

- [ ] **Step 1: Update both card wrappers**

Line 105:

```tsx
// Before
'rounded-lg border p-4 transition-all duration-300',
// After
'rounded-xl border p-4 transition-[background-color,border-color] duration-300',
```

Line 397:

```tsx
// Before
<div className="rounded-lg border border-border/30 bg-muted/30 p-4">
// After
<div className="rounded-xl border border-border/30 bg-muted/30 p-4">
```

(Also drops `transition-all` from the step card transition string — fixes §14 in passing.)

- [ ] **Step 2: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "fix(today): bump card radius to xl for concentric corners (§1)"
```

### Task F5: Wire Enter key + add `↵` glyph to Next button

**Files:**
- Modify: `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx:263-265, 281-283`
- Modify: ReviewMode — add a useEffect for the Enter handler

- [ ] **Step 1: Add the Enter handler**

In ReviewMode (around line 210), add:

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target?.matches('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
    if (step === 1) setStep(2)
    else if (step === 3 && priorities) onComplete(priorities)
    // Step 2 advances via PrioritiesSection's own button — leave it alone
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [step, priorities, onComplete])
```

- [ ] **Step 2: Update Next button copy with glyph**

Line 263-265:

```tsx
<Button size="sm" onClick={() => setStep(2)} className="gap-1.5">
  Next <span className="ml-1 inline-flex items-center justify-center rounded bg-foreground/10 px-1 text-meta tabular-nums">↵</span>
</Button>
```

(Replaces the `<ArrowRight />` with a keyboard glyph chip — also primes the user to learn the Enter shortcut. Drop the `ArrowRight` import if no other use remains.)

Line 281-283 — Ready to go button gets the same treatment:

```tsx
<Button size="sm" onClick={handleFinish} className="gap-1.5">
  <Check className="size-3.5" /> Ready to go
  <span className="ml-1 inline-flex items-center justify-center rounded bg-foreground/10 px-1 text-meta tabular-nums">↵</span>
</Button>
```

- [ ] **Step 3: Playwright smoke — test the Enter key**

Via Playwright:
1. Navigate + bypass onboarding.
2. `browser_press_key` with key `Enter`.
3. Expected: Step 1 advances to Step 2 (verify by re-snapshotting).

- [ ] **Step 4: Commit**

```bash
git add daily-triage/apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "feat(today): Enter advances review step + keyboard glyph on primary buttons (§1.5)"
```

---

## Final verification (after both worktrees merged)

- [ ] **Final 1: TS + Rust clean**

```bash
cd daily-triage && npm run build --workspaces
cd daily-triage && cargo check --workspace
```

Both expected to succeed.

- [ ] **Final 2: Playwright golden-flow smoke**

Per the playbook's golden flows (so far the loop covers Today only):
- First-open Today empty state — full screenshot.
- Press Enter twice to verify the review flow advances Step 1 → Step 2 → Step 3.
- Confirm console errors = the 2 cataloged Tauri `listen()` errors only. Zero new errors.

Save final screenshots to `daily-triage/docs/audit-findings/today/final-*.png`.

- [ ] **Final 3: Fresh-agent review**

Dispatch `superpowers:requesting-code-review` on the merged branch with the original audit findings as input. Reviewer agent confirms each finding is addressed or explicitly deferred (with reason recorded in the playbook's post-run notes).

- [ ] **Final 4: Update playbook post-run notes**

Edit `daily-triage/docs/audit-loop-playbook.md` → "Dry run #1 — Today page" section. Fill in:
- What worked (what the loop produced cleanly)
- What leaked (anything that needed mid-flight adjustment)
- Adjustments for next loop (process changes)

- [ ] **Final 5: Update auto-memory current state**

Save the audit-loop result + any pattern changes to `~/.claude/projects/.../memory/project_current_state.md` so the next session has full context.

---

## Self-Review Notes

- Gate 0 is explicit and blocks D + F only — A/B/C/E/G can ship without it.
- Every code step shows the actual code or the exact replacement.
- No "TODO / fill in / similar to" placeholders.
- Type/name consistency: `getGreeting()` returns `{ headline, subtitle }` (A3), used in lanes A3, F2, D2. The `bg-success` token introduced in C1 is reused in C2 and F1. `text-meta-strong` introduced in C2 used in F1.
- All findings from the three audit files have a corresponding task EXCEPT the two "Greeting + page header duplicate" / "Step card border feels web-default" items, which are folded into D3 and D1 decisions respectively rather than getting their own task.
- The two known Tauri `listen()` console errors are out of scope — they are a non-Tauri-browser artifact, not a UI defect, and were excluded from the audit brief.
