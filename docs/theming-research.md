# Theming & Typography System — Research & Implementation Plan

> Research doc for Nimble theming overhaul.
> Written 2026-03-29. Implementation in a follow-up session.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Typography — Font Pairing Research](#2-typography--font-pairing-research)
3. [Color Theme System — Architecture Research](#3-color-theme-system--architecture-research)
4. [Implementation Plan](#4-implementation-plan)
5. [File Change Inventory](#5-file-change-inventory)

---

## 1. Current State Analysis

### What exists today

**Font:** Geist Variable via `@fontsource-variable/geist`. Loaded as a CSS import in `index.css`. Applied as `--font-sans: 'Geist Variable', sans-serif` with `--font-heading: var(--font-sans)` (same font for everything). No secondary or monospace font is explicitly set — the app falls back to the browser's default `ui-monospace, SFMono-Regular, monospace` in the Tiptap editor.

**Theme:** Light/dark only. CSS variables are defined in `:root` (light) and `.dark` (dark) in `index.css` using oklch color space. The `useTheme` hook reads from SQLite via `getSetting('theme')`, falls back to localStorage, and toggles the `.dark` class on `<html>`. A FOUC-prevention script in `index.html` applies `.dark` before React hydrates.

**shadcn/ui:** Using the `base-nova` style with `cssVariables: true`. All components reference the standard variable set (`--background`, `--foreground`, `--primary`, `--accent`, etc.). Tailwind v4 with CSS-first config — no `tailwind.config.ts` file; everything lives in `index.css` via `@theme inline`.

**Color palette:** Warm-shifted oklch values (hue ~60-75, low chroma) for backgrounds and surfaces. Custom `--accent-blue` for focus/selection highlights. All colors are in oklch, which is ideal for perceptual uniformity and makes theme generation much easier.

**Settings UI:** The Appearance section in `SettingsPage.tsx` currently only has a light/dark/system toggle (3-button segmented control).

---

## 2. Typography — Font Pairing Research

### Candidate Fonts Evaluated

#### Primary (Headings, page titles, goal names)

| Font | Character | x-height | Licensing | Weight Range | Notes |
|------|-----------|----------|-----------|-------------|-------|
| **Inter** | Geometric, neutral, Swiss-inspired | Tall | OFL (free) | 100-900 | Linear's choice. Extremely readable. Perhaps too ubiquitous — every SaaS tool uses it now. |
| **Satoshi** | Modern geometric, slightly warmer than Inter | Tall | Free for commercial use (Indian Type Foundry) | 300-900 | Trending heavily in 2025-26 design tools. Has personality without being loud. Slightly rounded terminals give warmth. |
| **General Sans** | Warm geometric, friendly | Tall | Free for commercial use (Indian Type Foundry) | 200-700 | Rounded terminals, generous letter spacing. Very approachable. Good for ADHD readability — letters are distinct and open. |
| **Plus Jakarta Sans** | Geometric, warm, premium feel | Tall | OFL (free) | 200-800 | Designed for UI. Excellent readability at all sizes. Slightly wider than Inter, which helps with scanning. Available on Fontsource. |
| **Geist** (current) | Monospace-influenced proportional | Medium | MIT (Vercel) | 100-900 | Clean and modern. Slightly narrow letter spacing can make dense text harder to scan quickly. Better for code-adjacent UIs than warm productivity tools. |
| **Cabinet Grotesk** | Editorial, distinctive | Tall | Free personal use only | 100-900 | Beautiful for headlines. Too editorial/magazine for a daily-use productivity tool — the personality would get tiring. |

#### Secondary (Body text, task content, UI labels)

| Font | Character | Small-size readability | Licensing | Notes |
|------|-----------|----------------------|-----------|-------|
| **Inter** | Neutral workhorse | Excellent | OFL | The safe choice. Designed specifically for screens. Great at 12-14px. |
| **DM Sans** | Clean geometric | Excellent | OFL | Slightly softer than Inter. Great on Google Fonts / Fontsource. Works well at 11-13px for UI labels. |
| **Nunito Sans** | Rounded, warm | Very good | OFL | The rounded terminals reduce visual sharpness, which some ADHD readers find easier to track. Slightly wider spacing. |
| **IBM Plex Sans** | Professional, neutral-warm | Excellent | OFL | One of the best-engineered typefaces for UI. Superb hinting. Feels slightly more "serious" than the others. |

#### Monospace (Code blocks, timestamps, keyboard shortcuts)

| Font | Character | Licensing | Notes |
|------|-----------|-----------|-------|
| **JetBrains Mono** | Developer-focused, ligatures | OFL | Excellent readability. Has coding ligatures (optional). Well-established. |
| **Geist Mono** | Minimal, clean | MIT | Already part of the Geist family (currently installed). Pairs perfectly if keeping Geist. |
| **Berkeley Mono** | Premium, beautiful | Paid license ($75) | The nicest-looking monospace font. Not viable for bundling without a license purchase. |

### Recommended Pairings

#### Pairing 1: Plus Jakarta Sans + Inter + Geist Mono (Recommended)

- **Primary:** Plus Jakarta Sans — warm, geometric, excellent x-height, designed for UI. The slight extra width compared to Inter improves scannability. The letterforms feel premium without being trendy.
- **Secondary:** Inter — unbeatable for body text readability at small sizes. As the body font (not the heading font), it won't feel overused.
- **Mono:** Geist Mono — already in the project's dependency tree. Clean and minimal.
- **Why it works:** Plus Jakarta's warmth matches the app's amber/gold palette. Inter as body text means rock-solid readability for task lists where you're scanning dozens of items. The contrast between Plus Jakarta's slightly playful geometry and Inter's precision creates visual hierarchy without being jarring. Both have tall x-heights, which helps ADHD readability.
- **macOS feel:** Both fonts have the geometric clarity of San Francisco without copying it. They'll feel at home on macOS.
- **Fontsource packages:** `@fontsource-variable/plus-jakarta-sans`, `@fontsource/inter` (or `@fontsource-variable/inter`), `@fontsource/geist-mono` (already have `@fontsource-variable/geist`).

#### Pairing 2: Satoshi + DM Sans + JetBrains Mono

- **Primary:** Satoshi — the "designer's font" of 2025-26. Warm, distinctive, modern.
- **Secondary:** DM Sans — softer than Inter, pairs naturally with Satoshi's geometric warmth.
- **Mono:** JetBrains Mono — well-established, excellent at all sizes.
- **Why it works:** Both Satoshi and DM Sans share rounded terminals, creating a cohesive warmth. This pairing would give the app a more contemporary, design-tool feel (think Framer, Raycast).
- **Caveat:** Satoshi is not on Fontsource. You'd need to self-host from the Indian Type Foundry download. The license is free for commercial use but requires manual font file management.

#### Pairing 3: General Sans + Nunito Sans + Geist Mono

- **Primary:** General Sans — the warmest, friendliest option. Open letterforms.
- **Secondary:** Nunito Sans — rounded, wide, very approachable. Excellent ADHD readability.
- **Mono:** Geist Mono — minimal, doesn't clash with the rounded body fonts.
- **Why it works:** This is the most ADHD-optimized pairing. Both fonts have generous spacing, rounded forms, and highly distinct letterforms (important for readers who skip/swap letters). The downside is it skews slightly "friendly app" rather than "premium tool."
- **Caveat:** General Sans also requires manual download from Indian Type Foundry. Not on Fontsource.

### Recommendation

**Go with Pairing 1 (Plus Jakarta Sans + Inter + Geist Mono).**

Rationale:
- Both primary and secondary fonts are available on Fontsource (trivial to install and bundle)
- Plus Jakarta Sans was literally designed for UI work — it handles every size from 10px labels to 32px page titles
- Inter as a body font is the most tested, most readable screen font available
- Geist Mono is already in the project (zero new dependencies for monospace)
- The warm-but-professional feel matches a Linear-inspired productivity app
- Both fonts have tall x-heights and open apertures, which are the two most impactful features for ADHD readability
- Licensing is clean: both are OFL (Open Font License), free for any use

### Typography Scale

Recommended scale to accompany the font pairing (CSS custom properties):

```css
--font-size-xs: 0.6875rem;    /* 11px — timestamps, metadata */
--font-size-sm: 0.8125rem;    /* 13px — UI labels, secondary text */
--font-size-base: 0.875rem;   /* 14px — body text, task content */
--font-size-lg: 1rem;          /* 16px — section headers */
--font-size-xl: 1.25rem;       /* 20px — page titles */
--font-size-2xl: 1.5rem;       /* 24px — large headings */

--leading-tight: 1.3;
--leading-normal: 1.5;
--leading-relaxed: 1.65;       /* ADHD-friendly line height for body text */

--tracking-tight: -0.025em;   /* headings */
--tracking-normal: 0em;        /* body */
--tracking-wide: 0.025em;     /* small caps, labels */
```

This is slightly larger than typical SaaS defaults (which use 13px base). The 14px base + 1.5-1.65 line height is a deliberate ADHD readability choice — more whitespace between lines reduces line-skipping.

---

## 3. Color Theme System — Architecture Research

### How Other Apps Handle Theming

#### Linear
- **Light + Dark** modes with a clean toggle
- **Custom accent color** — users pick from a palette of ~12 preset accent colors (blue, purple, red, orange, yellow, green, teal, etc.)
- Implementation: CSS custom properties on `:root`. The accent color changes `--color-primary` and its derivatives. Background/surface colors stay fixed per light/dark mode.
- Key insight: Linear does NOT change the entire color scheme per theme — they only change the accent. This is simpler and less error-prone.

#### Notion
- **Light + Dark** only. No accent customization.
- Implementation: CSS variables, class-based toggle (`.notion-dark-theme`).
- Very conservative approach. Colors are hardcoded in component styles for brand elements.

#### Obsidian
- **Full theme marketplace** — community CSS themes that override hundreds of CSS variables.
- Implementation: Obsidian exposes ~400 CSS custom properties. Themes are `.css` files that override these variables. Users can install themes from a directory.
- Key insight: This level of customization is powerful but creates a maintenance nightmare. Themes break on updates. Not suitable for our scope.

#### Arc Browser
- **Space-specific color themes** — each "space" (workspace) has its own accent color that tints the entire chrome.
- Implementation: The accent color is used to generate a full palette programmatically (lighter/darker variants, foreground contrast colors).
- Key insight: Generating a palette from a single accent hue is smart. oklch makes this trivial — keep L and C consistent, rotate H.

#### Raycast
- **Multiple built-in themes** — ~8 preset themes (Default, Candy, Midnight, etc.)
- Implementation: Each theme is a set of CSS variables. Themes define background, text, accent, and border colors.
- Key insight: Raycast themes feel distinct because they change BOTH the accent AND the background temperature (warm vs. cool grays). This is the sweet spot — more personality than "just change the accent" but less chaos than full Obsidian-style theming.

### Recommended Architecture: Accent Themes + Light/Dark

The best approach for Nimble is a **two-axis system**:

1. **Mode axis:** Light / Dark / System (already exists)
2. **Accent theme axis:** Warm / Ocean / Rose / Mono / Forest

Each accent theme defines:
- An accent hue (used for `--primary`, `--accent-blue` replacement, selection colors)
- A background temperature (warm grays vs. cool grays vs. neutral grays)
- A chart/status color palette that complements the accent

This means each theme needs **both** a `:root` (light) and `.dark` (dark) variant = 10 total variable sets (5 themes x 2 modes).

### Why CSS Variables (Not Class-Based)

For this app, CSS-variable swapping is clearly the right approach:

1. **shadcn/ui already uses CSS variables** — every component references `var(--background)`, `var(--primary)`, etc. Changing these variables automatically re-themes all components.
2. **Tailwind v4's `@theme inline` block** maps CSS variables to utility classes (`bg-background` maps to `var(--background)`). Swapping the variable value is all that's needed.
3. **oklch makes palette generation trivial** — to create a new theme, adjust hue and background warmth while keeping lightness/chroma consistent.
4. **No component changes needed** — components already use `bg-primary`, `text-muted-foreground`, etc. Theme changes are pure CSS.

### Theme Definitions

Here are the 5 theme palettes. All values are in oklch. The key parameters that change per theme are:

- **Accent hue:** The primary hue angle (H in oklch)
- **Background warmth:** The hue of neutral surfaces (0 = pure gray, 60 = warm, 220 = cool)
- **Chroma on neutrals:** How saturated the grays are (0 = pure gray, 0.005-0.01 = tinted)

#### Warm (Current — Amber/Gold)
```
Accent hue: ~75 (amber/gold)
Background hue: 60-75
Neutral chroma: 0.003-0.008
Personality: Cozy, inviting, like reading by lamplight
```

#### Ocean (Blue/Teal)
```
Accent hue: ~230 (blue) / ~200 (teal for secondary)
Background hue: 230-240
Neutral chroma: 0.005-0.010
Personality: Calm, focused, like a clear sky
```

#### Rose (Pink/Rose)
```
Accent hue: ~350 (rose) / ~10 (warm red)
Background hue: 350-10
Neutral chroma: 0.005-0.008
Personality: Soft, personal, like a journal
```

#### Mono (Pure Grayscale)
```
Accent hue: 0 (n/a)
Background hue: 0
Neutral chroma: 0
Personality: Distraction-free, typography-focused, pure information
```

#### Forest (Green/Emerald)
```
Accent hue: ~155 (emerald/green)
Background hue: 140-160
Neutral chroma: 0.005-0.008
Personality: Natural, grounding, like a forest walk
```

### CSS Variable Structure

Each theme defines these variables (matching the existing shadcn set + additions):

```css
/* Surfaces */
--background          /* page background */
--foreground          /* primary text */
--card                /* card/panel background */
--card-foreground     /* text on cards */
--popover             /* dropdown/popover background */
--popover-foreground  /* text in popovers */

/* Interactive */
--primary             /* primary buttons, active states */
--primary-foreground  /* text on primary buttons */
--secondary           /* secondary surfaces, hover states */
--secondary-foreground
--accent              /* subtle emphasis backgrounds */
--accent-foreground

/* Semantic */
--muted               /* disabled/inactive surfaces */
--muted-foreground    /* disabled/secondary text */
--destructive         /* error/delete actions */

/* Structural */
--border              /* borders, dividers */
--input               /* input field borders */
--ring                /* focus ring */

/* Custom (app-specific) */
--accent-blue         /* RENAME to --accent-highlight — used for focus, selection, links */

/* Sidebar (shadcn sidebar component) */
--sidebar, --sidebar-foreground, --sidebar-primary, etc.

/* Charts */
--chart-1 through --chart-5
```

### Full Theme CSS Example (Ocean, Light Mode)

```css
.theme-ocean:not(.dark) {
  --background: oklch(0.985 0.005 230);
  --foreground: oklch(0.15 0.015 230);
  --card: oklch(0.995 0.003 230);
  --card-foreground: oklch(0.15 0.015 230);
  --popover: oklch(0.995 0.003 230);
  --popover-foreground: oklch(0.15 0.015 230);
  --primary: oklch(0.45 0.2 230);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.955 0.008 230);
  --secondary-foreground: oklch(0.205 0.015 230);
  --muted: oklch(0.955 0.008 230);
  --muted-foreground: oklch(0.48 0.015 230);
  --accent: oklch(0.95 0.008 230);
  --accent-foreground: oklch(0.205 0.015 230);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.905 0.008 230);
  --input: oklch(0.905 0.008 230);
  --ring: oklch(0.55 0.15 230);
  --accent-blue: oklch(0.55 0.18 230);
  /* ... sidebar, charts */
}
```

---

## 4. Implementation Plan

### Step 1: Install and Bundle Fonts

**What:** Add Plus Jakarta Sans and Inter as self-hosted fonts via Fontsource. Keep Geist Mono from the existing Geist package.

**Commands:**
```bash
npm install @fontsource-variable/plus-jakarta-sans @fontsource-variable/inter
```

**Font loading in `index.css`:**
```css
@import "@fontsource-variable/plus-jakarta-sans";
@import "@fontsource-variable/inter";
@import "@fontsource-variable/geist";  /* keep for Geist Mono fallback */
```

**Why Fontsource for a Tauri app:** Fontsource packages bundle the actual `.woff2` files as npm dependencies. Vite resolves the CSS imports and copies the font files into the build output. No CDN calls, no network dependency. The fonts ship inside the `.app` binary. This is the standard approach for Tauri apps — identical to how `@fontsource-variable/geist` already works in this project.

**Font file location:** Fontsource puts `.woff2` files in `node_modules/@fontsource-variable/*/files/`. Vite's asset pipeline handles these automatically — no manual copying needed.

### Step 2: Define Typography CSS Variables

**In `index.css`, inside `@theme inline`:**

```css
@theme inline {
  --font-heading: 'Plus Jakarta Sans Variable', 'Inter Variable', system-ui, sans-serif;
  --font-sans: 'Inter Variable', system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'SF Mono', ui-monospace, monospace;
}
```

This replaces the current:
```css
--font-heading: var(--font-sans);
--font-sans: 'Geist Variable', sans-serif;
```

**Usage in components:** No component changes needed for body text — everything already uses `font-sans` via Tailwind's defaults. For headings, add `font-heading` class (Tailwind v4 auto-generates this from the `--font-heading` variable).

**Specific places to add `font-heading`:**
- Page titles in `Dashboard.tsx` header (`<h1>`)
- Section headers (`<h2>` elements in TodayPage, TasksPage, etc.)
- Goal names (when implemented)
- Settings section titles

**Monospace usage:** The Tiptap editor already uses `ui-monospace` for code blocks. Update that to `font-mono` to use Geist Mono consistently. Also use it for:
- Keyboard shortcut badges in HelpPanel
- Timestamp displays
- Version number in Settings
- Code elements in Tiptap

### Step 3: Create Theme CSS File

**Create `src/themes.css`** — a dedicated file for all theme variable definitions. Import it in `index.css`.

Structure:
```css
/* src/themes.css */

/* ── Warm (default) ── */
:root,
.theme-warm:not(.dark) {
  /* ... light warm variables (move from current :root) ... */
}
.dark,
.theme-warm.dark {
  /* ... dark warm variables (move from current .dark) ... */
}

/* ── Ocean ── */
.theme-ocean:not(.dark) {
  /* ... light ocean ... */
}
.theme-ocean.dark {
  /* ... dark ocean ... */
}

/* ── Rose ── */
.theme-rose:not(.dark) { /* ... */ }
.theme-rose.dark { /* ... */ }

/* ── Mono ── */
.theme-mono:not(.dark) { /* ... */ }
.theme-mono.dark { /* ... */ }

/* ── Forest ── */
.theme-forest:not(.dark) { /* ... */ }
.theme-forest.dark { /* ... */ }
```

**Why a separate file:** Keeps `index.css` focused on Tailwind config, base styles, and animations. Theme definitions are ~200 lines and will grow. Separation makes it easy to find and edit themes.

**Class application:** Theme classes (`theme-warm`, `theme-ocean`, etc.) go on `<html>` alongside the existing `dark` class. The `.dark` class continues to handle light/dark. The `.theme-*` class handles the accent palette.

### Step 4: Update the Theme Hook

**Modify `src/hooks/useTheme.ts`:**

```typescript
type Mode = 'light' | 'dark' | 'system'
type AccentTheme = 'warm' | 'ocean' | 'rose' | 'mono' | 'forest'

interface ThemeConfig {
  mode: Mode
  accent: AccentTheme
}
```

The hook needs to manage two values:
1. `mode` — stored as `setting:theme` (already exists)
2. `accent` — stored as `setting:accent_theme` (new)

**`applyTheme` function update:**
```typescript
function applyTheme(mode: Mode, accent: AccentTheme) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)

  // Mode
  root.classList.toggle('dark', isDark)
  localStorage.setItem('theme', mode)

  // Accent — remove all theme classes, add the active one
  root.classList.remove('theme-warm', 'theme-ocean', 'theme-rose', 'theme-mono', 'theme-forest')
  root.classList.add(`theme-${accent}`)
  localStorage.setItem('accent_theme', accent)
}
```

**FOUC prevention — update `index.html` script:**
```html
<script>
  ;(function(){
    var t=localStorage.getItem('theme');
    var a=localStorage.getItem('accent_theme')||'warm';
    var d=window.matchMedia('(prefers-color-scheme:dark)').matches;
    if(t==='dark'||(t!=='light'&&d))document.documentElement.classList.add('dark');
    document.documentElement.classList.add('theme-'+a);
  })()
</script>
```

### Step 5: Update Settings UI

**In `SettingsPage.tsx`, expand the Appearance section:**

```
Appearance
├── Mode: [Light] [Dark] [System]      (existing)
├── Theme: [grid of 5 color swatches]  (new)
└── Font: [dropdown or segmented]       (future, optional)
```

**Theme picker design:**
- 5 circular or rounded-square swatches, each showing the theme's accent color
- Active theme has a ring/checkmark
- Hover shows theme name as tooltip
- Clicking immediately applies the theme (instant feedback, no "Save" button)

**Font pairing picker (stretch goal):**
- If we ever support font switching, the same pattern works: a dropdown with 3 preset pairings
- Each option shows a font sample preview
- For v1, hardcode the recommended pairing (Plus Jakarta Sans + Inter). Defer the font picker to later.

### Step 6: Persist Theme Choice

**Storage strategy:**
- Primary: SQLite `settings` table (key: `accent_theme`, value: `warm`/`ocean`/`rose`/`mono`/`forest`)
- Fallback: localStorage (for the FOUC-prevention script before Tauri backend is ready)
- The existing `useTheme` hook already does this dual-storage pattern for the mode setting. Mirror the same approach for accent.

**No new Rust commands needed.** The existing `getSetting`/`setSetting` commands handle arbitrary key-value pairs.

### Step 7: Font Pairing Switching (Optional / Future)

If font switching is desired later:

**Approach:** Define font pairing presets as CSS custom properties that can be swapped. Each pairing overrides `--font-heading`, `--font-sans`, `--font-mono`.

```css
.font-default {
  --font-heading: 'Plus Jakarta Sans Variable', system-ui, sans-serif;
  --font-sans: 'Inter Variable', system-ui, sans-serif;
}
.font-geometric {
  --font-heading: 'Satoshi', system-ui, sans-serif;
  --font-sans: 'DM Sans', system-ui, sans-serif;
}
.font-system {
  --font-heading: system-ui, -apple-system, sans-serif;
  --font-sans: system-ui, -apple-system, sans-serif;
}
```

**Caveat:** Each additional font pairing adds ~50-200KB to the app bundle (variable fonts). Keep the number small. The "System" option uses macOS San Francisco at zero cost.

### Accessibility: Contrast Ratios

Every theme must meet **WCAG AA** (4.5:1 for normal text, 3:1 for large text).

**oklch makes this straightforward.** The L (lightness) channel directly controls perceived brightness. For any theme:

| Element | Light mode L values | Dark mode L values | Minimum contrast |
|---------|-------------------|-------------------|-----------------|
| Body text on background | foreground L=0.15, background L=0.985 | foreground L=0.93, background L=0.14 | > 15:1 (excellent) |
| Muted text on background | muted-fg L=0.48, background L=0.985 | muted-fg L=0.58, background L=0.14 | > 5:1 (passes AA) |
| Primary button text | primary-fg L=0.985, primary L=0.205 | primary-fg L=0.205, primary L=0.922 | > 10:1 (excellent) |
| Destructive on background | destructive L=0.577 | destructive L=0.577 | Check per-theme |

**Theme-specific concerns:**
- **Mono:** Easiest — pure grays have maximum contrast range
- **Forest:** Green hues at L=0.5 can be harder to read — push accent to L=0.4 or L=0.6
- **Rose:** Pink/rose at low chroma can look washed out — keep C >= 0.15 for the accent
- **Ocean:** Blue is naturally lower-contrast than warm colors at the same L value — may need L=0.42 instead of 0.45 for primary in light mode

**Testing plan:** After implementation, run each theme through the Chrome DevTools contrast checker (inspect any text element, it shows the ratio). Also test with the "Emulate vision deficiency" DevTools panel (protanopia, deuteranopia, tritanopia).

---

## 5. File Change Inventory

### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `@fontsource-variable/plus-jakarta-sans` and `@fontsource-variable/inter` dependencies |
| `src/index.css` | Add font imports, update `@theme inline` font variables, import `themes.css`, remove theme variables from `:root`/`.dark` (moved to themes.css) |
| `index.html` | Update FOUC script to also apply accent theme class |
| `src/hooks/useTheme.ts` | Add `AccentTheme` type, `accent` state, dual-storage for accent, `setAccent` callback |
| `src/components/pages/SettingsPage.tsx` | Add theme swatch picker in Appearance section |
| `src/components/layout/Dashboard.tsx` | Add `font-heading` class to `<h1>` page title |
| `src/components/layout/NavSidebar.tsx` | No changes needed (uses `text-sm font-medium` which maps to `--font-sans`) |

### Files to Create

| File | Purpose |
|------|---------|
| `src/themes.css` | All 5 accent theme definitions (light + dark variants each = 10 blocks) |

### Files That Need Font Class Updates (Heading Font)

These files contain heading-level text that should use `font-heading`:

| File | Elements |
|------|----------|
| `src/components/layout/Dashboard.tsx` | `<h1>` page title |
| `src/components/pages/SettingsPage.tsx` | `SectionHeader` `<h2>` elements |
| `src/components/pages/TodayPage.tsx` | Section headings, brief title |
| `src/components/pages/TasksPage.tsx` | Project group headings |
| `src/components/pages/InboxPage.tsx` | Section headings |
| `src/components/pages/DocsPage.tsx` | Doc titles in the tree and editor |
| `src/components/detail/TaskDetailPage.tsx` | Task title |
| `src/components/detail/InlineTitle.tsx` | Inline editable title |
| `src/components/priorities/PrioritiesSection.tsx` | Section header |

These are low-risk changes — just adding `font-heading` to existing className strings.

### Files That Need Monospace Updates

| File | Elements |
|------|----------|
| `src/index.css` (Tiptap styles) | `.tiptap-editor code` — change `font-family` to `var(--font-mono)` |
| `src/components/shared/HelpPanel.tsx` | Keyboard shortcut badges |
| `src/components/pages/SettingsPage.tsx` | Version number, capture route prefix `<code>` |

---

## Summary of Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Font pairing | Plus Jakarta Sans + Inter + Geist Mono | Best balance of warmth, readability, and ease of bundling |
| Theme architecture | CSS variable swap via class on `<html>` | Matches existing shadcn/ui pattern, zero component changes for colors |
| Number of themes | 5 (Warm, Ocean, Rose, Mono, Forest) | Enough variety without maintenance burden |
| Theme axis | Mode (light/dark/system) x Accent (5 themes) | Two independent axes, like Linear |
| Color space | oklch (keep existing) | Perceptually uniform, easy to generate consistent palettes |
| Font loading | Fontsource npm packages | Self-hosted, offline-capable, works with Vite/Tauri, same as current Geist |
| Persistence | SQLite (primary) + localStorage (FOUC fallback) | Mirrors existing `useTheme` pattern |
| Font switching UI | Defer to v2 | Ship with one pairing first, add picker later if users want it |

### Implementation Order

1. **Install fonts + update CSS variables** (30 min) — immediate visual improvement
2. **Create `themes.css` with all 5 themes** (1 hr) — the core work, generating oklch palettes
3. **Update `useTheme` hook** (20 min) — add accent state management
4. **Update Settings UI** (30 min) — add theme swatch picker
5. **Update `index.html` FOUC script** (5 min)
6. **Add `font-heading` to heading elements** (20 min) — find-and-update across ~10 files
7. **Accessibility audit** (15 min) — contrast check each theme in both modes
8. **Update monospace references** (10 min) — Tiptap, HelpPanel, Settings

**Estimated total: ~3 hours.**
