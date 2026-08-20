# Design Critique — Nimble (Figma mirror)

**Date:** 2026-08-01 · **Source:** figma.com/design/LOMNIeeWkvouIHKnugKm0d (all 8 screens + Spec Sheet + Components page)
**Goal:** Linear-esque aesthetic, standardize on Geist, cleaner typography, fewer size steps.
**Status:** APPROVED 2026-08-01 — decisions: body **13px** (Linear density), weights **400/500/600**, **drop display-xl**, **neutral habit chrome**. Body(13) vs meta(12) distinction = color (foreground vs muted-foreground), not size.

---

## Context

Personal macOS app for daily triage (Tauri). Morning-routine emotional context: low-friction, no-guilt, ADHD-friendly. The bar it gets compared against: Linear, Things, Notion Calendar.

## First impressions

The bones are genuinely good — the shell (48px icon rail, 40px header, 288px calendar) is disciplined and already Linear-shaped, spacing is consistent, and the warm near-white canvas is distinctive. What keeps it from reading "Linear" is concentrated in two places: **the type scale has too many nearly-identical steps** (9 sizes, three of them within 2px of each other; 15px and 16px titles coexisting), and **decoration is loudest where meaning is lowest** — pastel habit rings, amber pencil icons repeated down the Inbox, emoji category chips on Goals. Linear's calm comes from ruthless suppression of everything that isn't data; this UI still lets ornament vote.

## Typography findings

Current scale (from Spec Sheet): caption 10/500 · label 11/500 · meta 12/400 · meta-strong 12/500 · body 14/400/-0.6% · body-strong 14/500 · heading-sm 15/550/-1.5% · heading 16/550/-1.8% · display 20/550/-2.2% · display-xl 26/550/-2.8% · timer 48 mono. Runtime font = SF Pro ("system"), CSS declares Geist; Figma styles built in SF Pro with Medium(510) approximating code's 550.

1. **15 vs 16 is not a hierarchy step.** heading-sm (15) and heading (16) differ by 1px — indistinguishable in situ. Two tokens doing one job.
2. **10 vs 11 same problem.** caption (10) and label (11) are both "tiny medium gray"; 10px is below comfortable floor anyway.
3. **Three fonts in flight.** Code says Geist, runtime says SF Pro, Figma says SF Pro-with-510-hack. The 550 weight literally cannot render as designed in SF Pro named styles. Standardizing on Geist kills the hack: Geist variable covers any weight.
4. **550 weight is a half-step.** 400/500/550 puts emphasis (500) and titles (550) one perceptual notch apart. A 400/500/600 ladder gives titles a real step up and works even with static font fallbacks.
5. **Tracking ramp has 5 distinct values** (0, -0.6, -1.5, -1.8, -2.2, -2.8%). Simplify to 3.
6. **Contrast violation via opacity:** muted-foreground #625c58 passes AA solid (≈5.5:1), but the documented "often at 40–80% opacity" pattern blends to ≈2.6–3.5:1 on white — fails WCAG for 12px meta text. Dim with tokens, never opacity.

## Visual design findings

- **Habit circles (Today)** — 4 saturated pastel rings + colored fills + green badges are the visually heaviest element on the page; they're the least important. Neutralize the chrome, keep the user's emoji + green check.
- **Inbox pencil column** — identical amber pencil on 6/7 rows carries zero information and adds an accent color to every row. Muted foreground (or icon only for non-default types).
- **Goals cards stack 4 accents each** — emoji chip + pastel chip fill + colored progress bar + amber "Active". One accent per card: keep the life-area colored progress bar, chip → colored dot + text (matches Tasks sidebar), "Active" → muted meta.
- **Emoji vs lucide** — nav/status icons are disciplined lucide (1.75/2 stroke); Goals chips and Settings accent swatches introduce emoji/decoration. Emoji is fine as *user data* (habit icons), not as system chrome.
- **Activity page leaks internals** — `capture_created`, `habit_logged` as raw snake_case; layout centered unlike every other page; gray stat slab. Humanize copy, left-align to standard page grid, stats → inline meta row.
- **Filled black "All" pill** vs outline-ish siblings — heavier than Linear's selected-filter treatment; secondary fill + foreground text is quieter.

## Interface findings (light — structure is mostly right)

- Today header shows "Today · Saturday, August 1", greeting block repeats the state, calendar repeats the date. Drop the header date (keep in calendar).
- Priorities card is the strongest module in the app — reasoning lines under each priority are excellent. No change.
- Empty bottom two-thirds on Inbox/Activity: positive empty states are a stated principle but not designed. (Backlog item, not this pass.)

## What stays (explicitly)

Shell dimensions (48/40/288), warm palette + 26-token semantic color system, oklch, card language (1px border, white fill, radius 12), status color semantics, data-driven project/life-area colors, no-guilt copy, motion tokens.

---

# Proposed changes

> **Phase 1 (Figma) executed 2026-08-01.** All styles, screens, components, and the Spec Sheet updated in the file; QA passed (0 non-Geist text nodes; all 8 screens visually verified). Refactor Plan frame lives on the Design System page next to the Spec Sheet. Phase 2 (production) pending.

## A. Type scale: 10 tokens → 7, 9 sizes → 5, one font

Target font: **Geist** (variable) everywhere — Figma styles, CSS, and runtime default. Geist Mono stays for timer/code.

| Token | Now | Proposed | Notes |
| --- | --- | --- | --- |
| caption (10/500) | ✂︎ merged | → label | 10px below floor; one tiny-label token |
| label | 11/1.15/500/0 | **11/1.3/500/0** | badges, kbd, section labels |
| meta | 12/1.35/400/0 | **12/1.4/400/0** | timestamps, counts |
| meta-strong | 12/1.35/500/0 | **12/1.4/500/0** | emphasis pair |
| body | 14/1.43/400/-0.6% | **14/1.45/400/-0.5%** | task rows, primary content |
| body-strong | 14/1.43/500/-0.6% | **14/1.45/500/-0.5%** | emphasis pair |
| heading-sm (15/550) | ✂︎ merged | → title | 15 vs 16 was not a step |
| heading (16/550) | 16/1.25/550/-1.8% | **title 15/1.3/600/-1%** | page titles, dialogs, greeting, editor H2 |
| display | 20/1.15/550/-2.2% | **20/1.2/600/-1.5%** | editor H1, celebrations |
| display-xl (26/550) | ✂︎ dropped | → display | used once (focus celebration) |
| timer | 48/1/500 mono | unchanged | Geist Mono |

Weights: **400/500/600** (drop 550 + the SF Pro 510 hack). Tracking: **0 / -0.5% / -1% / -1.5%** by size. Editor headings: H1 display 20 · H2 title 15 · H3 body-strong 14. Contrast rule: **no opacity-dimmed text** — muted-foreground is the floor.

## B. Color/decoration diet

| Surface | Now | Proposed |
| --- | --- | --- |
| Inbox row icons | amber pencil ×7 | muted-foreground; icon varies only for non-default type |
| Habit circles | pastel ring + tinted fill per habit | neutral border circle (border token), emoji inside, green check badge stays |
| Goals category chip | emoji + pastel fill | colored dot + label text (same pattern as Tasks sidebar projects) |
| Goals "Active" | amber text | meta muted (status only colored when ≠ active) |
| Filter pill selected | primary-filled black | secondary fill + foreground text |
| Activity events | `capture_created` raw | "Captured a note" etc.; page left-aligned; stat slab → inline meta |
| Today header | "Today · Saturday, August 1" | "Today" only (date lives in calendar panel) |

## C. Execution order (approved plan → done)

1. Add "Refactor Plan" section to Figma Spec Sheet — AI-agent-readable change list mapping every token/component change to code targets (index.css @theme, themes.css, components).
2. Update Figma: text styles → Geist 7-token scale; components (NavRail, PageHeader, TaskRow, CalendarPanel); all 8 screens; Spec Sheet tables.
3. Update production: fonts.ts default → Geist, index.css @theme type tokens, component classes, the B-list visual changes.

## Decision points (Marco)

1. Body size: keep 14 (recommended) or drop to 13 for Linear-density?
2. Weights: 400/500/600 (recommended) or keep 550?
3. display-xl: drop (recommended) or keep for celebrations?
4. Habit circles: neutral chrome (recommended) or keep colored rings?
