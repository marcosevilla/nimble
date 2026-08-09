# Typography System

Canonical reference for the Nimble type system. For design rationale, research, and migration history, see `docs/superpowers/specs/2026-04-18-typography-system-design.md`.

## The 10 tokens

| Token | Size | Weight | Line-height | Tracking | Family | Primary use |
|---|---|---|---|---|---|---|
| `text-caption` | 10px | 500 | 1.2 | 0 | sans | Micro-badges, overflow counts, tiny pills |
| `text-label` | 11px | 500 | 1.15 | 0 | sans | Section labels, chips, sidebar groups |
| `text-meta` | 12px | 400 | 1.35 | 0 | sans | Timestamps, due dates, secondary text |
| `text-body` | 14px | 400 | 1.43 | -0.006em | sans | Primary body, task titles, list rows |
| `text-body-strong` | 14px | 500 | 1.43 | -0.006em | sans | Emphasis — form labels, panel titles, selected rows |
| `text-heading-sm` | 15px | 550 | 1.3 | -0.015em | heading | Page titles, dialogs, editor H3 |
| `text-heading` | 16px | 550 | 1.25 | -0.018em | heading | Greeting, section emphasis, editor H2 |
| `text-display` | 20px | 550 | 1.15 | -0.022em | heading | Editor H1, moderate celebrations |
| `text-display-xl` | 26px | 550 | 1.05 | -0.028em | heading | Focus celebrations |
| `text-timer` | 48px | 500 | 1.0 | -0.02em | mono | FocusView timer |

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

- `<Caption>` — `text-caption` + tone (muted / default / faint)
- `<Label>` — `text-label` + tone (muted / default)
- `<Meta>` — `text-meta` + tone (muted / default / faint)
- `<BodyStrong>` — `text-body-strong` + tone (muted / default)
- `<FieldLabel>` — `<label>` element with `text-body`
- `<SectionTitle>` — `<h3>` with `text-heading-sm`
- `<PageTitle>` — `<h1>` with `text-heading-sm` + `truncate`

Use these when you're rendering a semantic element; use the raw class when composing with other layout.

## Tiptap editor

`.tiptap-editor h1/h2/h3` in `index.css` reference `--typo-display-*`, `--typo-heading-*`, `--typo-heading-sm-*` — all three tokens exist and the fallback defaults are kept in sync with the component-layer defaults. Editor headings move in lockstep with the design system.

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

- **shadcn UI primitives** (`components/ui/*.tsx`) — may use raw `text-sm` / `text-xs`. A future pass can retokenize; this round intentionally left them for stability.
- **Mobile app** (`apps/mobile`) — different stack (React Native StyleSheet). Mirror when mobile type gets its own pass.

## Forbidden patterns (grep check list)

For CI / pre-commit hooks, the following greps should return zero matches in `apps/desktop/src` (excluding `components/ui/`):

```bash
# Hardcoded pixel sizes
grep -rn "text-\[.*px\]" apps/desktop/src --exclude-dir=components/ui

# Raw Tailwind text sizes
grep -rnE "text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)(\b|[^a-zA-Z-])" apps/desktop/src --exclude-dir=components/ui

# Removed tokens
grep -rn "text-heading-xs" apps/desktop/src

# Emphasis shortcuts
grep -rn "text-body font-medium" apps/desktop/src

# Redundant weight on label
grep -rn "text-label.*font-medium\|font-medium.*text-label" apps/desktop/src --exclude-dir=components/ui

# Uppercase anywhere applied (comments and tuner code constants are fine)
grep -rn "\buppercase\b" apps/desktop/src --exclude-dir=components/ui | grep -v "TypographyTuner\|typography-tokens\|typography.tsx\|index.css"
```
