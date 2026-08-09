# Typography System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 10-token typography system defined in `docs/superpowers/specs/2026-04-18-typography-system-design.md` — new tokens, Geist default, sentence case throughout, and ~50 callsite migrations with zero raw Tailwind text sizes left in app code.

**Architecture:** Three foundation files (`index.css`, `typography-tokens.ts`, `typography.tsx`) define the token system; ~45 component files migrate callsites via mechanical pattern replacements. Each task is one commit, verified via type-check + targeted grep + visual smoke on the running Tauri dev server.

**Tech Stack:** Tailwind v4 (`@theme` + `@layer components`), CSS custom properties (`--text-*`, `--typo-*`), React 19 + TypeScript, Zustand, Geist Variable + Geist Mono Variable via `@fontsource-variable`.

**Non-goals:** shadcn `ui/*.tsx` primitives keep their raw `text-sm`/`text-xs` (except where they already use `text-body` — those migrate). Mobile app untouched. No test suite exists in this repo; "tests" in this plan means type-check + grep + visual smoke.

**Working directory:** `/Users/marcosevilla/Developer/personal triage and briefing app/nimble`

**Precondition:** repo has 86+ unrelated dirty files from the recent cleanup marathon. Each task commits ONLY its own files — never `git add -A`.

---

## Task 1: Rewrite `@theme` tokens in `index.css`

**Files:**
- Modify: `apps/desktop/src/index.css:20-46` (the `@theme` font/text block)

- [ ] **Step 1: Read the current `@theme` block for context**

Run: `sed -n '20,46p' apps/desktop/src/index.css`
Expected: the existing 8-token block with Plus Jakarta / Inter defaults.

- [ ] **Step 2: Replace the `@theme` block**

Replace lines 20-46 with:

```css
@theme {
    /* Geist is the default family for heading, sans, and mono. Heading +
       sans point at the same face so both token tiers render in Geist by
       default — the TypographyTuner can still swap each independently at
       runtime (Plus Jakarta, Inter, Manrope, IBM Plex, DM Sans all remain
       imported and selectable in Settings). */
    --font-heading: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
    --font-sans:    'Geist Variable', ui-sans-serif, system-ui, sans-serif;
    --font-mono:    'Geist Mono Variable', ui-monospace, 'SF Mono', monospace;

    /* Canonical type scale — 10 tokens, sentence case throughout.
       Tailwind v4 generates text-<name> utilities from these pairs.
       Spec: docs/superpowers/specs/2026-04-18-typography-system-design.md */
    --text-caption:      0.625rem;    /* 10 — micro-badges, overflow counts */
    --text-caption--line-height: 1.2;
    --text-label:        0.6875rem;   /* 11 — section labels, chips */
    --text-label--line-height: 1.15;
    --text-meta:         0.75rem;     /* 12 — timestamps, due dates, secondary */
    --text-meta--line-height: 1.35;
    --text-body:         0.875rem;    /* 14 — primary body, rows, task titles */
    --text-body--line-height: 1.4286;
    --text-body-strong:  0.875rem;    /* 14 — emphasis variant (replaces font-medium stacks) */
    --text-body-strong--line-height: 1.4286;
    --text-heading-sm:   1rem;        /* 16 — page titles, dialog titles, editor H3 */
    --text-heading-sm--line-height: 1.3;
    --text-heading:      1.125rem;    /* 18 — greeting, section emphasis, editor H2 */
    --text-heading--line-height: 1.25;
    --text-display:      1.5rem;      /* 24 — editor H1, celebration moments */
    --text-display--line-height: 1.15;
    --text-display-xl:   2rem;        /* 32 — focus celebrations */
    --text-display-xl--line-height: 1.05;
    --text-timer:        3rem;        /* 48 — FocusView timer */
    --text-timer--line-height: 1;
}
```

- [ ] **Step 3: Verify with grep — no `heading-xs` left in @theme, new tokens present**

Run: `grep -n "text-caption\|text-body-strong\|text-timer\|text-heading-xs" apps/desktop/src/index.css | head`
Expected: `caption`, `body-strong`, `timer` present (2 lines each for size + line-height), `heading-xs` only appears in the `@layer components` + highlight rules (not the `@theme` block) — those get fixed in Task 2.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/index.css
git commit -m "feat(type): swap @theme tokens to 10-token Geist scale

- Add caption, body-strong, timer tokens
- Remove heading-xs (absorbed into body-strong)
- Swap --font-heading + --font-sans defaults to Geist
- Bump display-xl 30 -> 32, update LH on meta/heading/etc. per spec

Refs: docs/superpowers/specs/2026-04-18-typography-system-design.md"
```

---

## Task 2: Rewrite `@layer components` typography rules + highlight selectors

**Files:**
- Modify: `apps/desktop/src/index.css:127-205` (the `@layer components` block + the `[data-highlight-type="..."]` rules)

- [ ] **Step 1: Replace the `@layer components` block (lines 127-182)**

```css
@layer components {
  /* Each text-<name> utility is a FULL typography style, not just size.
     Tailwind's @theme generates the font-size + line-height pair; these
     rules add the rest — font-family, weight, letter-spacing — each behind
     a --typo-<name>-* CSS variable with a default. The TypographyTuner
     panel writes to those vars on :root at runtime, so the whole app
     responds to tuning without component-level changes.

     No token uses text-transform: uppercase or positive letter-spacing —
     sentence case throughout. Emphasis is a weight shift (body -> body-
     strong), never an inline font-medium stack. */
  .text-caption {
    font-family: var(--typo-caption-family, var(--font-sans));
    font-weight: var(--typo-caption-weight, 500);
    letter-spacing: var(--typo-caption-tracking, 0);
  }
  .text-label {
    font-family: var(--typo-label-family, var(--font-sans));
    font-weight: var(--typo-label-weight, 600);
    letter-spacing: var(--typo-label-tracking, 0);
  }
  .text-meta {
    font-family: var(--typo-meta-family, var(--font-sans));
    font-weight: var(--typo-meta-weight, 400);
    letter-spacing: var(--typo-meta-tracking, 0);
  }
  .text-body {
    font-family: var(--typo-body-family, var(--font-sans));
    font-weight: var(--typo-body-weight, 400);
    letter-spacing: var(--typo-body-tracking, -0.006em);
  }
  .text-body-strong {
    font-family: var(--typo-body-strong-family, var(--font-sans));
    font-weight: var(--typo-body-strong-weight, 600);
    letter-spacing: var(--typo-body-strong-tracking, -0.006em);
  }
  .text-heading-sm {
    font-family: var(--typo-heading-sm-family, var(--font-heading));
    font-weight: var(--typo-heading-sm-weight, 600);
    letter-spacing: var(--typo-heading-sm-tracking, -0.015em);
  }
  .text-heading {
    font-family: var(--typo-heading-family, var(--font-heading));
    font-weight: var(--typo-heading-weight, 600);
    letter-spacing: var(--typo-heading-tracking, -0.018em);
  }
  .text-display {
    font-family: var(--typo-display-family, var(--font-heading));
    font-weight: var(--typo-display-weight, 600);
    letter-spacing: var(--typo-display-tracking, -0.022em);
  }
  .text-display-xl {
    font-family: var(--typo-display-xl-family, var(--font-heading));
    font-weight: var(--typo-display-xl-weight, 600);
    letter-spacing: var(--typo-display-xl-tracking, -0.028em);
  }
  .text-timer {
    font-family: var(--typo-timer-family, var(--font-mono));
    font-weight: var(--typo-timer-weight, 500);
    letter-spacing: var(--typo-timer-tracking, -0.02em);
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 2: Replace the TypographyTuner highlight selectors (lines 189-205)**

Replace the old highlight block with:

```css
/* TypographyTuner highlight — when a style is actively being tuned,
   outline every instance of that class on screen. data-highlight-type
   is set on <html> by the tuner; one style is highlighted at a time.
   Tiptap h1/h2/h3 mirror display/heading/heading-sm — highlighting the
   token also highlights the corresponding editor heading. */
[data-highlight-type="caption"] .text-caption,
[data-highlight-type="label"] .text-label,
[data-highlight-type="meta"] .text-meta,
[data-highlight-type="body"] .text-body,
[data-highlight-type="body-strong"] .text-body-strong,
[data-highlight-type="heading-sm"] .text-heading-sm,
[data-highlight-type="heading-sm"] .tiptap-editor h3,
[data-highlight-type="heading"] .text-heading,
[data-highlight-type="heading"] .tiptap-editor h2,
[data-highlight-type="display"] .text-display,
[data-highlight-type="display"] .tiptap-editor h1,
[data-highlight-type="display-xl"] .text-display-xl,
[data-highlight-type="timer"] .text-timer {
  outline: 2px dashed oklch(from var(--accent) l c h / 0.9);
  outline-offset: 3px;
  background: oklch(from var(--accent) l c h / 0.08);
  border-radius: 3px;
  transition: outline 150ms var(--ease-entrance), background 150ms var(--ease-entrance);
}
```

- [ ] **Step 3: Verify no leftover `heading-xs` in the file**

Run: `grep -n "heading-xs" apps/desktop/src/index.css`
Expected: zero matches.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/index.css
git commit -m "feat(type): rewrite .text-* component rules for 10-token system

- Drop text-transform: uppercase from label
- Drop positive letter-spacing (uppercase-only aid)
- Apply -0.006em tracking to body + body-strong
- Retune heading tracking per spec
- Remove .text-heading-xs rule
- Add .text-caption, .text-body-strong, .text-timer rules
- Update TypographyTuner highlight selectors"
```

---

## Task 3: Mirror the new spec in `typography-tokens.ts`

**Files:**
- Modify: `apps/desktop/src/lib/typography-tokens.ts` (complete rewrite of `TYPO_TOKENS` array)

- [ ] **Step 1: Replace the `TYPO_TOKENS` array (lines 33-130)**

```ts
export const TYPO_TOKENS: TypoToken[] = [
  {
    name: 'caption',
    label: 'Caption',
    description: 'Micro-badges, overflow counts, tiny pills',
    family: 'sans',
    size: 10,
    weight: 500,
    lineHeight: 1.2,
    tracking: 0,
    case: 'none',
    preview: '+12 overflow',
  },
  {
    name: 'label',
    label: 'Label',
    description: 'Section labels, chips, sidebar groups',
    family: 'sans',
    size: 11,
    weight: 600,
    lineHeight: 1.15,
    tracking: 0,
    case: 'none',
    preview: 'Tasks · 3',
  },
  {
    name: 'meta',
    label: 'Meta',
    description: 'Timestamps, due dates, secondary text, metadata',
    family: 'sans',
    size: 12,
    weight: 400,
    lineHeight: 1.35,
    tracking: 0,
    case: 'none',
    preview: 'Due Apr 18 · 2 min ago',
  },
  {
    name: 'body',
    label: 'Body',
    description: 'Primary body text, task titles, list rows, form values',
    family: 'sans',
    size: 14,
    weight: 400,
    lineHeight: 1.4286,
    tracking: -0.006,
    case: 'none',
    preview: 'Write the design critique draft',
  },
  {
    name: 'body-strong',
    label: 'Body Strong',
    description: 'Emphasis variant — form labels, panel titles, selected rows',
    family: 'sans',
    size: 14,
    weight: 600,
    lineHeight: 1.4286,
    tracking: -0.006,
    case: 'none',
    preview: "Today's priorities",
  },
  {
    name: 'heading-sm',
    label: 'Heading Small',
    description: 'Page titles, dialog titles, section titles, editor H3',
    family: 'heading',
    size: 16,
    weight: 600,
    lineHeight: 1.3,
    tracking: -0.015,
    case: 'none',
    preview: 'Inbox',
  },
  {
    name: 'heading',
    label: 'Heading',
    description: 'Greeting, section emphasis, editor H2',
    family: 'heading',
    size: 18,
    weight: 600,
    lineHeight: 1.25,
    tracking: -0.018,
    case: 'none',
    preview: 'Good morning',
  },
  {
    name: 'display',
    label: 'Display',
    description: 'Editor H1, moderate celebration moments',
    family: 'heading',
    size: 24,
    weight: 600,
    lineHeight: 1.15,
    tracking: -0.022,
    case: 'none',
    preview: 'Weekly goals',
  },
  {
    name: 'display-xl',
    label: 'Display XL',
    description: 'Focus-session celebration, once-in-a-session moments',
    family: 'heading',
    size: 32,
    weight: 600,
    lineHeight: 1.05,
    tracking: -0.028,
    case: 'none',
    preview: 'Nice work.',
  },
  {
    name: 'timer',
    label: 'Timer',
    description: 'FocusView timer — mono, tabular-nums',
    family: 'mono',
    size: 48,
    weight: 500,
    lineHeight: 1,
    tracking: -0.02,
    case: 'none',
    preview: '24:32',
  },
]
```

- [ ] **Step 2: Type-check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/typography-tokens.ts
git commit -m "feat(type): mirror new spec in TYPO_TOKENS array

- Add caption, body-strong, timer entries
- Remove heading-xs
- Update values on label/meta/body/heading-sm/heading/display/display-xl"
```

---

## Task 4: Add `<BodyStrong>` and `<Caption>` primitives

**Files:**
- Modify: `apps/desktop/src/components/shared/typography.tsx`

- [ ] **Step 1: Add primitives below the existing `Meta` export (after line 50)**

Insert before `type FieldLabelProps`:

```tsx
const captionVariants = cva('text-caption', {
  variants: {
    tone: {
      muted: 'text-muted-foreground',
      default: 'text-foreground',
      faint: 'text-muted-foreground/60',
    },
  },
  defaultVariants: { tone: 'muted' },
})

type CaptionProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof captionVariants> & {
    as?: 'span' | 'div' | 'p'
  }

export function Caption({ className, tone, as: Tag = 'span', ...props }: CaptionProps) {
  return <Tag className={cn(captionVariants({ tone }), className)} {...props} />
}

const bodyStrongVariants = cva('text-body-strong', {
  variants: {
    tone: {
      muted: 'text-muted-foreground',
      default: 'text-foreground',
    },
  },
  defaultVariants: { tone: 'default' },
})

type BodyStrongProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof bodyStrongVariants> & {
    as?: 'span' | 'div' | 'p' | 'h2' | 'h3' | 'h4'
  }

export function BodyStrong({ className, tone, as: Tag = 'span', ...props }: BodyStrongProps) {
  return <Tag className={cn(bodyStrongVariants({ tone }), className)} {...props} />
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/shared/typography.tsx
git commit -m "feat(type): add Caption + BodyStrong primitives

Matching the existing Label / Meta / SectionTitle / PageTitle pattern —
each primitive applies its text-<name> token class and accepts tone +
polymorphic 'as' props."
```

---

## Task 5: Checkpoint — verify foundation before migrations

- [ ] **Step 1: Type-check the whole app**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Ensure dev server is running (or start it)**

Run: `cd apps/desktop && npm run tauri dev`  *(if not already up — the background Tauri task from earlier in this session may still be running; check first)*
Expected: app window opens; Today page renders.

- [ ] **Step 3: Visual smoke — confirm font is Geist**

- Open Today page, Inbox, Tasks, Settings — observe that all text renders in Geist (not Plus Jakarta / Inter).
- `text-heading-xs` callsites will look broken (no .text-heading-xs class exists yet) — that's expected; Task 6 fixes them.
- Label-using sites (e.g., PageHeader sub-labels, sidebar "Projects") will show sentence case instead of uppercase — that's expected.

- [ ] **Step 4: No commit (checkpoint only)**

---

## Task 6: Migrate `text-heading-xs` → `text-body-strong` (5 app sites)

**Files:**
- Modify: `apps/desktop/src/components/pages/GoalsPage.tsx:105`
- Modify: `apps/desktop/src/components/priorities/PrioritiesSection.tsx:130, 199`
- Modify: `apps/desktop/src/components/goals/HabitsSection.tsx:362`
- Modify: `apps/desktop/src/components/ui/card.tsx:41` (shadcn — but already references token)

- [ ] **Step 1: `GoalsPage.tsx:105` — replace the heading-xs class**

Change:
```tsx
<h3 className="text-heading-xs font-semibold truncate">{goal.name}</h3>
```
To:
```tsx
<h3 className="text-body-strong truncate">{goal.name}</h3>
```

(Drop `font-semibold` — `text-body-strong` is already weight 600.)

- [ ] **Step 2: `PrioritiesSection.tsx:130` and `:199`**

Change both:
```tsx
<h3 className="text-heading-xs">...</h3>
```
To:
```tsx
<h3 className="text-body-strong">...</h3>
```

- [ ] **Step 3: `HabitsSection.tsx:362`**

Change:
```tsx
<h3 className="text-heading-xs">Habits</h3>
```
To:
```tsx
<h3 className="text-body-strong">Habits</h3>
```

- [ ] **Step 4: `ui/card.tsx:41`**

Change:
```tsx
"text-heading-sm leading-snug group-data-[size=sm]/card:text-heading-xs"
```
To:
```tsx
"text-heading-sm leading-snug group-data-[size=sm]/card:text-body-strong"
```

- [ ] **Step 5: Verify no `text-heading-xs` left in `apps/desktop/src`**

Run: `grep -rn "text-heading-xs" apps/desktop/src`
Expected: zero matches.

- [ ] **Step 6: Type-check and visual smoke**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors. In the running dev server, open Goals, Priorities panel, Habits section, and a size=sm Card — confirm panel titles render at 14/600 in Geist (look substantial but not heading-sized).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/pages/GoalsPage.tsx \
        apps/desktop/src/components/priorities/PrioritiesSection.tsx \
        apps/desktop/src/components/goals/HabitsSection.tsx \
        apps/desktop/src/components/ui/card.tsx
git commit -m "refactor(type): migrate text-heading-xs -> text-body-strong

Token removed from design system; all 5 callsites now use the
semantically-equivalent text-body-strong (14/600/sans)."
```

---

## Task 7: Migrate `text-body font-medium` → `text-body-strong` (30 sites)

**Files (14 total):**
- `apps/desktop/src/components/tasks/TaskEditor.tsx:101`
- `apps/desktop/src/components/pages/SettingsPage.tsx:129, 296, 344, 352, 363, 618, 677, 685, 695, 713, 737, 755, 974, 985` (14 sites)
- `apps/desktop/src/components/pages/SessionPage.tsx:133`
- `apps/desktop/src/components/ui/toggle.tsx:7`
- `apps/desktop/src/components/ui/button.tsx:9`
- `apps/desktop/src/components/ui/progress.tsx:55`
- `apps/desktop/src/components/ui/input-group.tsx:24`
- `apps/desktop/src/components/ui/tabs.tsx:59`
- `apps/desktop/src/components/setup/SetupDialog.tsx:100`
- `apps/desktop/src/components/focus/FocusResumeDialog.tsx:58`
- `apps/desktop/src/components/layout/NavSidebar.tsx:74, 141`
- `apps/desktop/src/components/priorities/PrioritiesSection.tsx:60, 160, 183`
- `apps/desktop/src/components/shared/BulkActionBar.tsx:205`
- `apps/desktop/src/components/pages/TodayPage.tsx:117`

- [ ] **Step 1: Mechanical find-and-replace (literal)**

For every file above, replace the literal string `text-body font-medium` with `text-body-strong`. Use Edit tool with `replace_all: true` per file. Preserves all surrounding classes.

Example:
- Before: `className="text-body font-medium truncate"`
- After:  `className="text-body-strong truncate"`

- [ ] **Step 2: Handle the `SessionPage.tsx:133` edge case**

That site has `className="text-body font-medium leading-snug"` — after step 1 it becomes `"text-body-strong leading-snug"`. `leading-snug` (1.375) is close to token's 1.4286 — drop it for consistency:

Change:
```tsx
<h3 className="text-body-strong leading-snug">{entry.title}</h3>
```
To:
```tsx
<h3 className="text-body-strong">{entry.title}</h3>
```

- [ ] **Step 3: Handle the `PrioritiesSection.tsx:60` edge case similarly**

Before: `'text-body font-medium leading-snug'` → after step 1: `'text-body-strong leading-snug'` → drop `leading-snug`:

```tsx
'text-body-strong'
```

- [ ] **Step 4: Verify no `text-body font-medium` remains**

Run: `grep -rn "text-body font-medium" apps/desktop/src`
Expected: zero matches.

- [ ] **Step 5: Type-check + visual smoke**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors. In dev: visit Settings (biggest user, 14 sites), NavSidebar labels, Focus dialog, Today highlights — all formerly-emphasized body text should render at 14/600 in Geist (no weight shift when the tuner changes `body-strong` — previously `font-medium` would win).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "refactor(type): migrate text-body font-medium -> text-body-strong

30 callsites across 14 files. Restores tuner control over emphasis
weight — previously Tailwind's font-medium utility won over the
--typo-body-weight CSS var."
```

---

## Task 8: Migrate `text-[8px]` / `text-[9px]` → `text-caption` (7 sites)

**Files:**
- `apps/desktop/src/components/pages/InboxPage.tsx:397`
- `apps/desktop/src/components/goals/GoalTimeline.tsx:157`
- `apps/desktop/src/components/goals/HabitsSection.tsx:153, 262`
- `apps/desktop/src/components/detail/TaskDetailPage.tsx:268`
- `apps/desktop/src/components/calendar/CalendarPanel.tsx:281, 295`

- [ ] **Step 1: `InboxPage.tsx:397` — overflow count pill**

Change:
```tsx
<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
```
To:
```tsx
<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
```

(Drop `font-medium` — caption is weight 500 by default.)

- [ ] **Step 2: `GoalTimeline.tsx:157` — amber marker pill**

Change:
```tsx
<div className="absolute top-1 -translate-x-1/2 bg-amber-500 text-[9px] font-semibold text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">
```
To:
```tsx
<div className="absolute top-1 -translate-x-1/2 bg-amber-500 text-caption font-semibold text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">
```

(Keep `font-semibold` — pill-on-color needs extra weight for legibility; this is a deliberate override.)

- [ ] **Step 3: `HabitsSection.tsx:153` — check overlay**

Change:
```tsx
className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
```
To:
```tsx
className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full flex items-center justify-center text-caption font-bold text-white"
```

(Keep `font-bold` — tiny checkmark glyph on color needs max weight.)

- [ ] **Step 4: `HabitsSection.tsx:262` — ruler label**

Change:
```tsx
className="text-[9px] text-muted-foreground absolute"
```
To:
```tsx
className="text-caption text-muted-foreground absolute"
```

- [ ] **Step 5: `TaskDetailPage.tsx:268` — kbd hint**

Change:
```tsx
<kbd className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[9px]">{'\u2318'}B</kbd>
```
To:
```tsx
<kbd className="rounded bg-muted/40 px-1 py-0.5 font-mono text-caption">{'\u2318'}B</kbd>
```

- [ ] **Step 6: `CalendarPanel.tsx:281` — calendar event subtext**

Change:
```tsx
<p className="text-[9px] text-muted-foreground/60 leading-tight truncate">
```
To:
```tsx
<p className="text-caption text-muted-foreground/60 truncate">
```

(Drop `leading-tight` — caption token leading 1.2 already covers this.)

- [ ] **Step 7: `CalendarPanel.tsx:295` — overlap pill**

Change:
```tsx
className="absolute bottom-0.5 right-0.5 h-5 px-1.5 text-[9px] font-medium opacity-90"
```
To:
```tsx
className="absolute bottom-0.5 right-0.5 h-5 px-1.5 text-caption opacity-90"
```

(Drop `font-medium` — caption's 500 is sufficient.)

- [ ] **Step 8: Verify no `text-[8px]` / `text-[9px]` remain in app code**

Run: `grep -rn "text-\[8px\]\|text-\[9px\]" apps/desktop/src`
Expected: zero matches.

- [ ] **Step 9: Type-check + visual smoke**

Visit Inbox overflow, Goals timeline amber markers, Habits ruler, TaskDetail kbd hints, Calendar event pills — verify micro-text renders legibly at 10px.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src
git commit -m "refactor(type): migrate hardcoded micro-sizes to text-caption

7 sites across 6 files previously using text-[8px] / text-[9px]
now use the caption token (10px/500/sans)."
```

---

## Task 9: Migrate FocusView timer → `text-timer` (2 sites)

**Files:**
- `apps/desktop/src/components/focus/FocusView.tsx:96, 114`

- [ ] **Step 1: Main timer at line 114**

Change:
```tsx
<span className={cn(
  'text-5xl font-mono tabular-nums tracking-tight',
  isPaused && 'animate-pulse text-muted-foreground',
  timerDone && 'text-green-500',
)}>
```
To:
```tsx
<span className={cn(
  'text-timer',
  isPaused && 'animate-pulse text-muted-foreground',
  timerDone && 'text-green-500',
)}>
```

(Drop `text-5xl font-mono tabular-nums tracking-tight` — token covers all four properties.)

- [ ] **Step 2: Break timer at line 96**

The break timer uses `text-4xl` (36px) — smaller than `text-timer` (48px). Two options:
- **(a)** Reuse `text-timer` — break timer will visually match main timer. Simpler.
- **(b)** Keep as a distinct smaller size via raw className.

Pick (a) for consistency. Change:
```tsx
<div className="text-4xl font-mono tabular-nums text-muted-foreground">
```
To:
```tsx
<div className="text-timer text-muted-foreground">
```

If visual QA shows the break timer at 48px reads too heavy (this screen is a soft moment, not the main focus), revert to `text-display-xl font-mono tabular-nums` (32px mono).

- [ ] **Step 3: Verify no raw `text-4xl` or `text-5xl` in FocusView**

Run: `grep -n "text-4xl\|text-5xl" apps/desktop/src/components/focus/FocusView.tsx`
Expected: zero matches.

- [ ] **Step 4: Visual smoke**

Start a focus session, confirm timer renders at 48px Geist Mono. Watch a session end → "Take a break" screen, confirm break timer matches.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/focus/FocusView.tsx
git commit -m "refactor(type): FocusView timer uses text-timer token

Replaces text-5xl (main) and text-4xl (break) + font-mono +
tabular-nums + tracking-tight stacks with the single text-timer
token (48/500/Geist Mono)."
```

---

## Task 10: Migrate remaining raw Tailwind sizes (8 sites)

**Files:**
- `apps/desktop/src/components/activity/ActivityTimeline.tsx:99` — `text-lg`
- `apps/desktop/src/components/goals/HabitsSection.tsx:119` — `text-lg` (emoji, decorative)
- `apps/desktop/src/components/shared/DateStrip.tsx:92` — `text-base`
- `apps/desktop/src/components/detail/CaptureDetailPage.tsx:118` — `text-lg leading-relaxed`

*(shadcn `input.tsx` and `textarea.tsx` raw sizes stay — out of scope per spec)*

- [ ] **Step 1: `ActivityTimeline.tsx:99` — stat value**

Change:
```tsx
<p className="text-lg font-semibold tabular-nums">{value}</p>
```
To:
```tsx
<p className="text-heading font-semibold tabular-nums">{value}</p>
```

Rationale: stat values are small emphatic numbers — `text-heading` (18/600) fits. Keep `font-semibold` as a deliberate deviation since stats should read stronger than default heading weight 600 (they'll now be 600 via token).

Actually drop `font-semibold`: it's a no-op given `text-heading` is already 600. Final:
```tsx
<p className="text-heading tabular-nums">{value}</p>
```

- [ ] **Step 2: `HabitsSection.tsx:119` — emoji holder**

Change:
```tsx
'relative size-10 rounded-full flex items-center justify-center text-lg transition-all duration-200 cursor-pointer select-none'
```
To:
```tsx
'relative size-10 rounded-full flex items-center justify-center text-heading transition-all duration-200 cursor-pointer select-none'
```

(Emoji is decorative; 18px matches `text-lg`'s 18 exactly. Keeps size but uses token.)

- [ ] **Step 3: `DateStrip.tsx:92` — day digit**

Change:
```tsx
<span className="text-base font-semibold tabular-nums">{day}</span>
```
To:
```tsx
<span className="text-body-strong tabular-nums">{day}</span>
```

(Day digit is emphasized body-sized text. 14/600 fits the strip's density better than 16.)

- [ ] **Step 4: `CaptureDetailPage.tsx:118` — capture content**

Change:
```tsx
<p className="text-lg leading-relaxed">{capture.content}</p>
```
To:
```tsx
<p className="text-heading">{capture.content}</p>
```

Rationale: capture content is meant to read prominently. `text-heading` at 18/600/heading-family is right. `leading-relaxed` (1.625) is close to the heading token's 1.25 — but captures are prose-y, so leave heading's 1.25 for now and revisit if QA shows it too tight.

Actually, for prose, `leading-relaxed` (1.625) is genuinely needed. Compromise: use `text-heading` + `leading-relaxed`. But spec forbids stacking `leading-*` on tokens. Resolution: keep `leading-relaxed` here as an explicit documented exception for prose content (comment it).

Final:
```tsx
{/* leading-relaxed for prose readability — deliberate override of text-heading's 1.25 leading */}
<p className="text-heading leading-relaxed">{capture.content}</p>
```

- [ ] **Step 5: Verify no raw `text-lg` / `text-base` / `text-4xl` / `text-5xl` remain outside shadcn primitives**

Run: `grep -rn "text-\(lg\|base\|4xl\|5xl\)" apps/desktop/src --exclude-dir=components/ui`
Expected: zero matches.

Run: `grep -rn "text-\(lg\|base\|4xl\|5xl\)" apps/desktop/src/components/ui`
Expected: only shadcn primitives that were already out of scope (input.tsx, textarea.tsx).

- [ ] **Step 6: Visual smoke**

Visit Activity timeline stats, Habits emoji grid, DateStrip header, a Capture detail page — verify each site renders correctly.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "refactor(type): migrate raw Tailwind sizes to tokens

- ActivityTimeline stat: text-lg -> text-heading
- HabitsSection emoji: text-lg -> text-heading
- DateStrip day digit: text-base -> text-body-strong
- CaptureDetailPage prose: text-lg -> text-heading (leading-relaxed
  kept as documented prose override)

shadcn ui/input.tsx + ui/textarea.tsx raw sizes intentionally untouched
per spec scope."
```

---

## Task 11: Remove all `uppercase` utility usage (~15 app sites)

**Files (app code only — not TypographyTuner tuner-options or typography-tokens.ts type defs):**
- `apps/desktop/src/components/pages/SettingsPage.tsx:1302, 1327`
- `apps/desktop/src/components/calendar/CalendarPanel.tsx:73`
- `apps/desktop/src/components/tasks/ProjectSidebar.tsx:110`
- `apps/desktop/src/components/detail/TaskActivityLog.tsx:90`
- `apps/desktop/src/components/detail/DetailSidebar.tsx:71`
- `apps/desktop/src/components/docs/DocEditor.tsx:120`
- `apps/desktop/src/components/docs/FolderTree.tsx:140, 219`
- `apps/desktop/src/components/activity/ActivityTimeline.tsx:200`
- `apps/desktop/src/components/shared/HelpPanel.tsx:292`
- `apps/desktop/src/components/shared/DateStrip.tsx:91`
- `apps/desktop/src/components/shared/BriefDisplay.tsx:64`
- `apps/desktop/src/components/shared/CommandBarResults.tsx:143, 168`

- [ ] **Step 1: Strip `uppercase tracking-wider font-medium` from all sites above**

Policy: drop `uppercase`, `tracking-wider`, and `font-medium` in every site. Keep `text-label` (if present) — it now bakes weight 600 and no case transform. If site used `text-meta ... uppercase tracking-wider` (treating meta as an eyebrow), upgrade to `text-label` so sentence-case hierarchy still reads as a label.

**Example 1 — `SettingsPage.tsx:1302`:**
```tsx
// Before
<Label htmlFor="heading-font" className="text-label font-medium uppercase tracking-wider text-muted-foreground/70">
// After
<Label htmlFor="heading-font" className="text-label text-muted-foreground/70">
```

**Example 2 — `ProjectSidebar.tsx:110`:**
```tsx
// Before (uses text-meta as label)
<span className="text-meta font-medium text-muted-foreground/60 uppercase tracking-wider">Projects</span>
// After (upgrade to text-label)
<span className="text-label text-muted-foreground/60">Projects</span>
```

**Example 3 — `DateStrip.tsx:91`:**
```tsx
// Before
<span className="text-label font-medium uppercase">{weekday}</span>
// After
<span className="text-label">{weekday}</span>
```

Apply this treatment per-file for all 15 sites listed above. Read each site's current line to preserve any legitimate surrounding classes (`shrink-0`, `truncate`, `group-hover:*`).

- [ ] **Step 2: Verify no `uppercase` utility remains in app code (excluding code-level type constants)**

Run: `grep -rn "\buppercase\b" apps/desktop/src --exclude-dir=components/ui | grep -v "TypographyTuner\|typography-tokens\|typography.tsx"`
Expected: zero matches. (The remaining references in the TypographyTuner code, typography-tokens.ts TypoCase union, and typography.tsx comments are legitimate code constants, not applied styling.)

- [ ] **Step 3: Type-check + visual smoke**

Visit Settings Appearance, Calendar day header, Project/Docs sidebars, HelpPanel sections, CommandBarResults section headers, BriefDisplay section titles — every "eyebrow label" should render in sentence case at 11/600 Geist.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src
git commit -m "refactor(type): remove all uppercase utility usage

Sentence case throughout per design redline. Every eyebrow/section
label now renders via text-label (11/600) in Geist. Sites previously
using 'text-meta uppercase tracking-wider' upgraded to text-label
so the label role still reads."
```

---

## Task 12: Remove ad-hoc `tracking-*` / `leading-*` on token-class elements

- [ ] **Step 1: Audit remaining `tracking-*` stacked on `text-*` tokens**

Run: `grep -rn "text-\(label\|meta\|body\|body-strong\|caption\|heading\|heading-sm\|display\|display-xl\|timer\)[^a-z-]" apps/desktop/src | grep "tracking-" | grep -v components/ui`

Expected output: a list of sites stacking `tracking-*`.

- [ ] **Step 2: For each site in Step 1's output**

- If the site uses `tracking-tight` / `tracking-tighter` / `tracking-wide` / `tracking-wider` stacked on a token class → delete the tracking utility. The token handles tracking.
- If the site has a truly bespoke numeric need (e.g., `tracking-[0.08em]` on a specific heading), leave it and add an inline comment explaining why.

Open each file and delete.

- [ ] **Step 3: Audit remaining `leading-*` on `text-*` tokens**

Run: `grep -rn "text-\(label\|meta\|body\|body-strong\|caption\|heading\|heading-sm\|display\|display-xl\|timer\)[^a-z-]" apps/desktop/src | grep "leading-" | grep -v components/ui`

Expected: a few sites. One is the documented `leading-relaxed` on CaptureDetailPage from Task 10 — keep that. Delete the rest.

- [ ] **Step 4: For each, apply the same policy**

- Delete `leading-none` / `leading-tight` / `leading-snug` / `leading-normal` / `leading-relaxed` / `leading-loose` stacked on tokens, unless an inline comment says it's a prose-content override (CaptureDetailPage case).

- [ ] **Step 5: Type-check + visual smoke**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors. Visit the pages whose files you edited — no visual regressions from the tracking/leading removals.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "refactor(type): remove tracking-*/leading-* stacked on tokens

Tokens are fully baked typography — their tracking and line-height
live in the token definitions. Only documented prose overrides
(CaptureDetailPage) remain."
```

---

## Task 13: Audit remaining `font-*` weight overrides (subset of ~79)

- [ ] **Step 1: Generate the audit list**

Run: `grep -rn "text-\(label\|meta\|body\|body-strong\|caption\|heading\|heading-sm\|display\|display-xl\|timer\)[^a-z-].*font-\(medium\|semibold\|bold\)" apps/desktop/src --exclude-dir=components/ui`

Expected: a list of sites stacking `font-medium/semibold/bold` on token classes (not on `text-body` — those were handled in Task 7).

- [ ] **Step 2: For each site, apply the decision rule**

- Stacked on `text-meta` + emphasis intent → remove `font-medium` (meta stays weight 400 by design — upgrade the site to `text-body-strong` or `text-label` if it genuinely needs emphasis).
- Stacked on `text-label` → remove `font-medium` (label is already 600).
- Stacked on `text-heading-sm` / `text-heading` / `text-display` / `text-display-xl` → remove (all are 600 by default).
- Stacked on `text-caption` in pill-on-color contexts (e.g., GoalTimeline amber marker already kept `font-semibold` in Task 8) → keep with an inline comment documenting why.
- Everything else → remove.

Open each file and apply the rule. Expect a mix of straight deletions and 1-2 token upgrades (`text-meta font-medium` → `text-body-strong` when the site's intent is "emphasized body-ish text").

- [ ] **Step 3: Verify the final count**

Run: `grep -rn "text-\(label\|meta\|body\|body-strong\|caption\|heading\|heading-sm\|display\|display-xl\|timer\)[^a-z-].*font-\(medium\|semibold\|bold\)" apps/desktop/src --exclude-dir=components/ui`
Expected: only sites with an inline comment explaining the deliberate override (e.g., pill-on-color contrast).

- [ ] **Step 4: Type-check + visual sweep**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors. Sweep the whole app (Today, Inbox, Tasks, Goals, Session, Settings, Focus, Docs) — look for any weight regressions; fix by token upgrade.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "refactor(type): remove remaining font-* overrides on tokens

Weight now flows exclusively through the token system. Sites that
need stronger weight migrate to text-body-strong; sites with pill-
on-color contrast needs keep font-* with an inline justification
comment."
```

---

## Task 14: Write `docs/typography-system.md`

**Files:**
- Create: `apps/desktop/docs/typography-system.md` OR `nimble/docs/typography-system.md` — pick the latter (project-level, matches `roadmap.md`, `theming-research.md`).

- [ ] **Step 1: Create `nimble/docs/typography-system.md`**

```markdown
# Typography System

Canonical reference for the Nimble type system. For design rationale and migration history, see `docs/superpowers/specs/2026-04-18-typography-system-design.md`.

## The 10 tokens

| Token | Size | Weight | Line-height | Tracking | Family | Use |
|---|---|---|---|---|---|---|
| `text-caption` | 10px | 500 | 1.2 | 0 | sans | Micro-badges, overflow counts, tiny pills |
| `text-label` | 11px | 600 | 1.15 | 0 | sans | Section labels, chips, sidebar groups |
| `text-meta` | 12px | 400 | 1.35 | 0 | sans | Timestamps, due dates, secondary text |
| `text-body` | 14px | 400 | 1.43 | -0.006em | sans | Primary body, task titles, rows |
| `text-body-strong` | 14px | 600 | 1.43 | -0.006em | sans | Emphasis — form labels, panel titles, selected rows |
| `text-heading-sm` | 16px | 600 | 1.3 | -0.015em | heading | Page titles, dialogs, editor H3 |
| `text-heading` | 18px | 600 | 1.25 | -0.018em | heading | Greeting, section emphasis, editor H2 |
| `text-display` | 24px | 600 | 1.15 | -0.022em | heading | Editor H1, moderate celebrations |
| `text-display-xl` | 32px | 600 | 1.05 | -0.028em | heading | Focus celebrations |
| `text-timer` | 48px | 500 | 1.0 | -0.02em | mono | FocusView timer |

## Family defaults

- `--font-heading`: `Geist Variable`
- `--font-sans`: `Geist Variable`
- `--font-mono`: `Geist Mono Variable`

Heading and sans stay as separate CSS vars even though they point at the same face by default — the TypographyTuner (Settings → Appearance) still lets users swap heading vs body fonts independently.

## Rules

**Tokens are fully baked typography.** The `.text-<name>` class sets family, size, line-height, weight, and tracking. Do not stack:
- `font-*` (weight)
- `tracking-*`
- `leading-*`
- `uppercase`

on top of a token class. If you need emphasis, use `text-body-strong` instead of `text-body font-medium`. If you need a different size, pick a different token — don't `text-[Npx]`.

**Sentence case throughout.** No uppercase labels, no `.uppercase` utility, no positive letter-spacing anywhere.

**Tabular numerics everywhere.** `font-variant-numeric: tabular-nums` is applied on `<html>` in `@layer base`. Opt out per-element if proportional figures matter.

**Documented prose exceptions.** A small number of sites (e.g., `CaptureDetailPage`) use `leading-relaxed` on prose content — they carry an inline comment justifying the override. When in doubt, don't add an exception; pick the closest token.

## React primitives (`components/shared/typography.tsx`)

- `<Caption>` — `text-caption` + tone (muted / default / faint)
- `<Label>` — `text-label` + tone
- `<Meta>` — `text-meta` + tone
- `<BodyStrong>` — `text-body-strong` + tone
- `<FieldLabel>` — `<label>` element with `text-body`
- `<SectionTitle>` — `<h3>` with `text-heading-sm`
- `<PageTitle>` — `<h1>` with `text-heading-sm` + `truncate`

Use these when you're creating a semantic element; use the raw class when composing with other layout.

## Tiptap editor

`.tiptap-editor h1/h2/h3` in `index.css` reference `--typo-display-*`, `--typo-heading-*`, `--typo-heading-sm-*` — all three tokens still exist, so editor headings move in lockstep with the design system.

## TypographyTuner

The tuner (`components/shared/TypographyTuner.tsx`) reads from `lib/typography-tokens.ts` and writes to `--typo-<name>-*` CSS vars on `:root`. Any change to the token list must update both places.

## Out-of-scope carve-outs

- **shadcn UI primitives** (`components/ui/*.tsx`) — may use raw `text-sm` / `text-xs`. They're a separate system; a future pass can retokenize.
- **Mobile app** (`apps/mobile`) — different stack; mirror when mobile type gets its own pass.
```

- [ ] **Step 2: Commit**

```bash
git add nimble/docs/typography-system.md
git commit -m "docs: add typography-system.md canonical reference"
```

(Note: if run from inside `nimble/`, the path is `docs/typography-system.md`.)

---

## Task 15: Final sanity sweep + visual regression pass

- [ ] **Step 1: Forbidden-pattern grep suite**

Run each — all should return zero in app code (outside `components/ui/` for shadcn carve-out):

```bash
# Hardcoded pixel sizes in app code
grep -rn "text-\[.*px\]" apps/desktop/src --exclude-dir=components/ui

# Raw Tailwind text sizes in app code (full set — spec §4.3 forbids all)
grep -rnE "text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)(\b|[^a-zA-Z-])" apps/desktop/src --exclude-dir=components/ui

# text-heading-xs (removed token)
grep -rn "text-heading-xs" apps/desktop/src

# text-body font-medium (replaced by text-body-strong)
grep -rn "text-body font-medium" apps/desktop/src

# uppercase utility (excluding TypographyTuner code constants)
grep -rn "\buppercase\b" apps/desktop/src --exclude-dir=components/ui | grep -v "TypographyTuner\|typography-tokens\|typography.tsx"
```

**shadcn exception:** `components/ui/*.tsx` is out of scope per the spec — raw `text-xs`/`text-sm`/`text-2xl` in those files is acceptable. The `--exclude-dir=components/ui` flag on each grep enforces that carve-out.

Expected: zero matches on each.

- [ ] **Step 2: Type-check the whole app**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build the frontend**

Run: `cd apps/desktop && npm run build`
Expected: clean build.

- [ ] **Step 4: Visual regression sweep — 8 surfaces**

In the running Tauri dev server, visit each page and confirm no unintended shifts:

1. **Today** — greeting, calendar panel, priorities, task rows
2. **Tasks (All + Project Detail)** — list density, subtask indentation, pills
3. **Inbox** — captures, overflow count pill
4. **Goals** — GoalTimeline markers, HabitsSection ruler, goal names
5. **Session** — session entries, prose
6. **Settings** — Appearance (TypographyTuner still works live), Calendar feeds, Capture routes, Turso
7. **Focus** — main timer (48px), break screen, celebration (display-xl)
8. **Docs** — Tiptap editor H1/H2/H3, folder tree

Flag any site where type looks wrong and fix inline (usually a token upgrade).

- [ ] **Step 5: Open TypographyTuner and tune live**

Open Settings → (wherever the tuner mounts, or the keyboard shortcut). Change `body-strong` weight from 600 → 700 in the tuner; confirm form labels and panel titles across the app respond immediately. Reset via "Reset all (reload)".

- [ ] **Step 6: Commit the residue**

If the visual sweep surfaced fixes, commit them:

```bash
git add apps/desktop/src
git commit -m "fix(type): visual regression fixes from sanity sweep"
```

- [ ] **Step 7: Final grep log for the record**

Copy the output of the forbidden-pattern suite from Step 1 (expected: all zeros) into the terminal for the record. This is the proof of completion.

---

## Task 16: Mark complete, clean up brainstorming server

- [ ] **Step 1: Verify the spec's success criteria**

Re-read `docs/superpowers/specs/2026-04-18-typography-system-design.md` §10:

- [ ] Zero raw `text-xs/sm/base/lg/xl/*` in `apps/desktop/src` (excluding `ui/`). ✅ verified in Task 15 Step 1.
- [ ] Zero `text-[Npx]` in `apps/desktop/src`. ✅ verified.
- [ ] Zero `uppercase` utilities in `apps/desktop/src`. ✅ verified.
- [ ] `font-medium`/`font-semibold` overrides on `text-body` reduced from 30 → 0. ✅ verified in Task 7.
- [ ] `TypographyTuner` reflects new tokens. ✅ verified in Task 15 Step 5.
- [ ] No unintended visual shifts. ✅ visual sweep done.

- [ ] **Step 2: Stop the brainstorming visual server**

Run: `"/Users/marcosevilla/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/brainstorming/scripts/stop-server.sh" "/Users/marcosevilla/Developer/personal triage and briefing app/.superpowers/brainstorm/6109-1776524837"`

Expected: server stopped; session HTML files persist in `.superpowers/brainstorm/` for future reference.

- [ ] **Step 3: Handoff complete**

Report back to Marco: all 15 tasks complete, commit count, final grep output. No changes required on his side.

---

## Rollback plan

If any task commit introduces a regression that's not immediately fixable:

1. Identify the bad commit: `git log --oneline -20`
2. Revert just that commit: `git revert <sha>` (preserves history; avoids destructive reset)
3. Continue with subsequent tasks — each task is independent except Task 3 depends on Task 1+2 (tuner data mirrors tokens).

The index.css and typography-tokens.ts changes are interdependent; revert both together if the token foundation needs a redo. All callsite migration tasks (6-13) can be reverted independently.

---

## Files touched — final inventory

**Foundation (3 files):**
- `apps/desktop/src/index.css`
- `apps/desktop/src/lib/typography-tokens.ts`
- `apps/desktop/src/components/shared/typography.tsx`

**Migrations (~30 files):** (exact count pending Tasks 12-13 completions)
- Everything surfaced by the Task 6-13 grep outputs.

**New docs:**
- `nimble/docs/typography-system.md`

**Total expected commits:** 13 (Tasks 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, optional 15). Task 5 and 16 are checkpoints, not commits.
