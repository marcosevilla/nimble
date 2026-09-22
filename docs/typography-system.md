# Typography System

Canonical reference for the Nimble type system. For design rationale, research, and migration history, see `docs/superpowers/specs/2026-04-18-typography-system-design.md`.

**CSS is the source of truth.** The scale is the `@theme` block in `apps/desktop/src/index.css` (size + line-height) plus the `.text-<name>` rules in its `@layer components` (family, weight, tracking). `lib/typography-tokens.ts` mirrors those values for the TypographyTuner and `components/shared/typography.tsx` wraps them as React primitives. When this table and `index.css` disagree, `index.css` wins and this file is wrong — fix the doc. (Reconciled 2026-09-22, facelift A4: an earlier version of this page described a 10-token scale with `caption`, `heading-sm`, `heading` and `display-xl`; those never shipped. `grep -rE "text-heading|text-caption|display-xl" apps/desktop/src | wc -l` → `0`.)

## The 8 tokens

Five sizes (11 / 12 / 13 / 15 / 20) plus the 48px timer, weights 400 / 500 / 600. `body` (13) and `meta` (12) are told apart by colour (foreground vs muted-foreground), never by size alone. Tailwind v4 generates `text-<name>` from the `--text-<name>` pairs; the `.text-<name>` component rule adds the rest behind `--typo-<name>-*` variables so the tuner can override at runtime.

| Token | Size | Line-height | Weight | Tracking | Family | Primary use | Usages |
|---|---|---|---|---|---|---|---|
| `text-label` | 11px (`0.6875rem`) | 1.3 | 500 | 0 | sans | Badges, kbd hints, section labels, counts | 112 |
| `text-meta` | 12px (`0.75rem`) | 1.4 | 400 | 0 | sans | Timestamps, due dates, secondary text | 151 |
| `text-meta-strong` | 12px (`0.75rem`) | 1.4 | 500 | 0 | sans | Emphasised meta (day pill, active segment) | 10 |
| `text-body` | 13px (`0.8125rem`) | 1.45 | 400 | -0.005em | sans | Primary body, rows, task titles | 209 |
| `text-body-strong` | 13px (`0.8125rem`) | 1.45 | 500 | -0.005em | sans | Emphasis (replaces `font-medium` stacks); editor H3 | 51 |
| `text-title` | 15px (`0.9375rem`) | 1.3 | 600 | -0.01em | heading | Page titles, dialog titles, greeting; editor H2 | 28 |
| `text-display` | 20px (`1.25rem`) | 1.2 | 600 | -0.015em | heading | Editor H1, celebration moments | 12 |
| `text-timer` | 48px (`3rem`) | 1 | 500 | -0.02em | mono, tabular | FocusView timer | 6 |

Usage counts are `grep -rhoE "\btext-<name>\b" apps/desktop/src | wc -l` on 2026-09-22 (includes the CSS and primitive definitions themselves).

## Family defaults

- `--font-heading`: `Geist Variable`
- `--font-sans`: `Geist Variable`
- `--font-mono`: `Geist Mono Variable`

Heading and sans stay as separate CSS vars even though both resolve to Geist by default — the TypographyTuner (Settings → Appearance) still lets users swap heading vs body fonts independently. Plus Jakarta Sans, Inter, Manrope, IBM Plex Sans, and DM Sans remain imported and selectable in the switcher.

## Rules

**Tokens are fully baked typography.** The `.text-<name>` class sets family, size, line-height, weight, and tracking. Do not stack on top:
- `font-*` (weight)
- `tracking-*`
- `leading-*`
- `uppercase`

If you need emphasis, use `text-body-strong` instead of `text-body font-medium`. If you need a different size, pick a different token — don't use `text-[Npx]` or raw Tailwind `text-sm`/`text-lg`/etc.

**Sentence case throughout.** No uppercase labels, no `.uppercase` utility, no positive letter-spacing anywhere.

**Tabular numerics everywhere.** `font-variant-numeric: tabular-nums` is applied on `<html>` in `@layer base`. Opt out per-element if proportional figures matter.

**Documented overrides.** A small number of sites use `leading-relaxed` on prose content (captures, descriptions, session entries, AI reasoning, editor body) — each carries a one-line inline comment justifying the override. Colored-background badges keep `font-semibold` or `font-bold` for legibility contrast, also with inline comments. When in doubt, don't add an exception; pick the closest token.

## React primitives (`components/shared/typography.tsx`)

Each primitive renders exactly one token class plus an optional `tone`; none stack `font-*`, `tracking-*` or `uppercase` on top, so the tuner's overrides still win.

| Primitive | Renders | Element | Tones |
|---|---|---|---|
| `<Label>` | `text-label` (+ `inline-flex items-center gap-1.5`) | `span` (`as`: div / p / h2 / h3 / h4) | muted (default), default |
| `<Meta>` | `text-meta` | `span` (`as`: div / p / time) | muted (default), default, faint\* |
| `<Caption>` | `text-label` — there is no separate caption size | `span` (`as`: div / p) | muted (default), default, faint\* |
| `<BodyStrong>` | `text-body-strong` | `span` (`as`: div / p / h2 / h3 / h4) | default, muted |
| `<FieldLabel>` | `text-body text-foreground` | `label` | — |
| `<SectionTitle>` | `text-title text-foreground` | `h3` (`as`: h2 / h4) | — |
| `<PageTitle>` | `text-title truncate` | `h1` | — |

\* `faint` currently resolves to the same `text-muted-foreground` as `muted`. The `--muted-foreground-subtle` token added in facelift A1 is the intended home for that role; wiring `faint` to it is Stage B work.

Use these when you're rendering a semantic element; use the raw class when composing with other layout.

## Tiptap editor

`.tiptap-editor h1 / h2 / h3` in `index.css` map onto **display / title / body-strong** — size and line-height from the `--text-*` pair, family / weight / tracking from the same `--typo-*` variables as the token classes — so editor headings move in lockstep with the tuner. (There are no `--typo-heading-*` variables.)

## TypographyTuner

The tuner (`components/shared/TypographyTuner.tsx`) reads from `lib/typography-tokens.ts` and writes to `--typo-<name>-*` CSS vars on `:root`. Any change to the token list must update both `index.css` (new `@theme` + `@layer components` rules) and `typography-tokens.ts` (TYPO_TOKENS array).

Toggle the tuner panel in DEV builds with `⌘⇧Y` — it shows live sliders per token and preview labels.

## Adding a new token

1. Add the size + line-height pair to `@theme` in `index.css`.
2. Add the `.text-<name> { ... }` rule to `@layer components`, using `var(--typo-<name>-*, default)` pattern so the tuner can override.
3. Add the `[data-highlight-type="<name>"] .text-<name>` selector to the TypographyTuner highlight block.
4. Add an entry to `TYPO_TOKENS` in `typography-tokens.ts` (mirrors the CSS values).
5. If the token has a React primitive (optional), add one to `typography.tsx` following the Caption/BodyStrong pattern.
6. Update this doc.

## Out-of-scope carve-outs

- **shadcn UI primitives** (`components/ui/*.tsx`) — a few still carry raw `text-[0.8rem]` / `text-base` (shell audit P2-9); retokenising them is queued for the facelift, not a rule change.
- **Mobile app** (`apps/mobile`) — different stack (React Native StyleSheet). Mirror when mobile type gets its own pass.

## Forbidden patterns (grep check list)

For CI / pre-commit hooks, the following greps should return zero matches in `apps/desktop/src` (excluding `components/ui/`):

```bash
# Hardcoded pixel sizes
grep -rn "text-\[.*px\]" apps/desktop/src --exclude-dir=components/ui

# Raw Tailwind text sizes
grep -rnE "text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)(\b|[^a-zA-Z-])" apps/desktop/src --exclude-dir=components/ui

# Tokens that never shipped (the old 10-token doc listed them)
grep -rnE "text-heading|text-caption|display-xl" apps/desktop/src

# Emphasis shortcuts
grep -rn "text-body font-medium" apps/desktop/src

# Redundant weight on label
grep -rn "text-label.*font-medium\|font-medium.*text-label" apps/desktop/src --exclude-dir=components/ui

# Uppercase anywhere applied (comments and tuner code constants are fine)
grep -rn "\buppercase\b" apps/desktop/src --exclude-dir=components/ui | grep -v "TypographyTuner\|typography-tokens\|typography.tsx\|index.css"
```
