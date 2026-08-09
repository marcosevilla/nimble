# Typography System Redesign — Design Spec

**Date:** 2026-04-18
**Author:** Marco Sevilla (w/ Claude Opus 4.7)
**Status:** Approved, ready for implementation plan
**Surface:** Nimble desktop app (`apps/desktop`) — mobile out of scope

---

## 1. Why

The existing typography system is already sophisticated — 8 canonical tokens in Tailwind v4 `@theme`, a live `TypographyTuner` that writes `--typo-*` CSS vars, Tiptap editor mirroring, and a runtime font switcher. The foundation is solid.

But an audit of 170 component files surfaced five real breakdowns:

1. **Emphasis escape hatch is the biggest leak.** `font-medium` is stacked on `text-body` in 14 files (30 occurrences) for form labels, route labels, and inline emphasis. The broader picture: 109 `font-*` utility overrides app-wide across 41 files, stacked on various tokens — every one of which bypasses the tuner's `--typo-*-weight` var.
2. **Micro-text has no home.** `text-[9px]` and `text-[8px]` appear in 6 files for badges, overflow counts, ruler markers, and kbd hints — below the 11px floor.
3. **Hero numerics have no token.** FocusView's timer uses raw `text-4xl` (36px) and `text-5xl` (48px) — clearly intentional, but outside the scale.
4. **shadcn primitives use raw Tailwind sizes.** ~12 files. Out of scope for this pass but documented.
5. **`text-heading-xs` and `text-body` are both 14px.** Semantic distinction (heading-family vs sans) is real, but inconsistent in practice.

**Plus:** 109 `font-*`, 20 `tracking-*`, 23 `leading-*`, and 22 `uppercase` utility overrides across the app — every one of which bypasses the tuner.

## 2. Scope + Direction

Locked during brainstorming (2026-04-18):

- **Direction:** Linear-tight — sharpen what we have, don't pivot to Stripe-elegant or Notion-warm.
- **Scope:** Core tokens + callsites only. No shadcn primitives, no Tiptap internals, no mobile, no tuner rebuild beyond mirroring the new token list.
- **Approach:** Sharpen the scale — rebalance the existing 8 tokens, add 2 missing ones (`caption`, `timer`), repurpose 1 (`body-strong` absorbs the role of the old `heading-xs`).
- **Typeface:** Geist as default everywhere. `--font-heading` and `--font-sans` both resolve to Geist by default. Mono stays Geist Mono.
- **Case:** Sentence case throughout. No uppercase, no positive letter-spacing (positive tracking exists to tune uppercase readability; it has no purpose in sentence case).

## 3. Research synthesis

Confirmed numbers collected from Linear (design system mirror), Vercel Geist docs, Notion help center, Stripe Sail, Raycast, Figma. Full report in memory at `reference_typography_research.md`.

**Patterns Linear + Stripe + Notion agree on:**
- Inter or an Inter-class humanist sans for body (or Geist, in Vercel's case).
- Body weight 400–510, never lighter in dense UI.
- Body line-height 1.45–1.60.
- Page titles 18–24px, rarely above 32 in-app.
- Body emphasis is a weight shift (500→600), not a separate size.

**They differ on:**
- **Uppercase:** Linear uses it only on mono 12px labels; Stripe at ~11px with positive tracking; Notion refuses it in doc surfaces. Nimble follows Notion's lead.
- **Tracking sign:** Linear is aggressively negative at every size ≥13px (-0.022em → -0.010em). Nimble adopts mild negative tracking (-0.006em on body).

## 4. The Token System — 10 tokens

Every token below is a FULL typography style (family + size + weight + line-height + tracking), baked via `@theme` + `@layer components`. Tokens are consumed via `text-<name>` Tailwind utility classes. The `--typo-<name>-*` CSS var layer lets the `TypographyTuner` override each property live.

| Token | Size | Weight | Line-height | Tracking | Family | Primary use |
|---|---|---|---|---|---|---|
| `text-caption` **NEW** | 10px / 0.625rem | 500 | 1.2 | 0 | sans | Micro-badges, overflow counts, tiny pills. Replaces `text-[8px]` / `text-[9px]`. |
| `text-label` CHG | 11px / 0.6875rem | 600 | 1.15 | 0 | sans | Section labels, chip labels, sidebar groups. Weight 500 → 600 for presence at 11px without uppercase. |
| `text-meta` KEPT | 12px / 0.75rem | 400 | 1.35 | 0 | sans | Timestamps, due dates, secondary row metadata. Line-height 1.25 → 1.35 for better wrapping. |
| `text-body` CHG | 14px / 0.875rem | 400 | 1.4286 | -0.006em | sans | Primary body text, task titles, list rows. Subtle negative tracking added for Linear-density. |
| `text-body-strong` **NEW** | 14px / 0.875rem | 600 | 1.4286 | -0.006em | sans | Emphasis variant. Replaces the 109 `text-body font-medium` stacks AND the former `text-heading-xs`. |
| `text-heading-sm` CHG | 16px / 1rem | 600 | 1.3 | -0.015em | heading | Page titles, dialog titles, editor H3. LH tightened 1.35 → 1.3. |
| `text-heading` CHG | 18px / 1.125rem | 600 | 1.25 | -0.018em | heading | Greeting, section emphasis, editor H2. |
| `text-display` CHG | 24px / 1.5rem | 600 | 1.15 | -0.022em | heading | Editor H1, moderate celebrations. |
| `text-display-xl` CHG | 32px / 2rem | 600 | 1.05 | -0.028em | heading | Focus celebrations, once-in-a-session moments. +2px from 30 to match Linear H1. |
| `text-timer` **NEW** | 48px / 3rem | 500 | 1.0 | -0.02em | mono | FocusView main timer. Replaces `text-5xl font-mono tracking-tight`. |

**Removed:** `text-heading-xs`. With heading-family = sans-family = Geist, the old 14/500/heading token is visually identical to the new 14/600/sans `text-body-strong`. All callsites migrate to `text-body-strong`.

### 4.1 Family defaults

```css
--font-heading: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
--font-sans:    'Geist Variable', ui-sans-serif, system-ui, sans-serif;
--font-mono:    'Geist Mono Variable', ui-monospace, 'SF Mono', monospace;
```

Heading and sans stay as separate CSS vars even though they point to the same family by default — this preserves the `TypographyTuner`'s ability to swap heading and body fonts independently. The font switcher in Settings continues to offer Plus Jakarta, Inter, Manrope, IBM Plex, DM Sans, and System as alternatives.

### 4.2 Global rules in `@layer base`

```css
html {
  font-family: var(--font-sans);
  font-variant-numeric: tabular-nums;   /* unchanged */
  /* Inter-specific font-feature-settings removed — Geist has its own optical tuning */
}
```

### 4.3 Enforced anti-patterns

These are forbidden in app code going forward:

| Forbidden | Use instead |
|---|---|
| `text-body font-medium` | `text-body-strong` |
| `text-body font-semibold` | `text-body-strong` |
| `text-[8px]` / `text-[9px]` / `text-[Npx]` | `text-caption` or nearest token |
| `text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl` / `text-2xl` / `text-4xl` / `text-5xl` | Named token |
| `uppercase` utility | Just don't — sentence case everywhere |
| `tracking-*` / `leading-*` stacked on a `text-<name>` class | Remove — the token handles it |

shadcn primitives (`ui/button.tsx`, `ui/input.tsx`, etc.) are **out of scope** and keep their current raw sizes. A follow-up pass can retokenize them.

## 5. Migration patterns

| Old pattern | New pattern | Occurrences |
|---|---|---|
| `text-body font-medium` | `text-body-strong` | 30 in 14 files |
| `text-heading-xs` | `text-body-strong` | 9 total: 5 in 3 component files + 4 refs in `index.css` |
| `text-[9px]` / `text-[8px]` | `text-caption` | 8 in 6 files |
| `text-5xl font-mono tabular-nums tracking-tight` (focus main timer) | `text-timer` | 1 in FocusView |
| `text-4xl font-mono tabular-nums` (focus break timer) | `text-timer` (or keep as a separate `text-timer-sm` if the size feels off) | 1 in FocusView |
| `text-lg` | Case-by-case: `text-heading` or `text-body-strong` | 6 in 5 files |
| `text-base` | `text-body` or `text-heading-sm` | 1 (DateStrip) |
| Other `font-medium` / `font-semibold` / `font-bold` stacked on a `text-<name>` token | Audit per-callsite: either move emphasis into the token itself (if structurally emphasized) or absorb into a renamed variant | ~79 remaining (109 total − 30 above) |
| Raw `uppercase` utility | Delete | 22 in 16 files |
| Ad-hoc `tracking-*` / `leading-*` stacked on tokens | Delete | 43 in 29 files |

## 6. Files touched

**Core system (3 files):**
- `apps/desktop/src/index.css` — add 2 new `@theme` tokens (`caption`, `timer`), refine 6 existing defaults (`label`, `meta`, `body`, `heading-sm`, `heading`, `display-xl`), remove `text-heading-xs`, swap default families to Geist, extend `@layer components` rules for new tokens, drop Inter-specific `font-feature-settings`.
- `apps/desktop/src/lib/typography-tokens.ts` — mirror the new 10-token spec so the `TypographyTuner` picks up new tokens and drops removed ones.
- `apps/desktop/src/components/shared/typography.tsx` — add `<BodyStrong>` and `<Caption>` primitives alongside existing `<Label>`, `<Meta>`, `<FieldLabel>`, `<SectionTitle>`, `<PageTitle>`.

**Component migrations (~45 files):** every file surfaced by the audit patterns above. Mechanical find/replace for the most part; case-by-case judgment for the `text-lg` / `text-base` sites where intent is ambiguous.

**Documentation:**
- `nimble/docs/typography-system.md` (NEW) — canonical token reference for future work (lives alongside `roadmap.md`, `theming-research.md`).

## 7. Non-goals

- **shadcn primitives.** Out of scope. A follow-up pass can retokenize `ui/*.tsx`.
- **Mobile app.** Out of scope. Mirror when mobile type gets its own pass.
- **TypographyTuner UI rebuild.** Tuner gets its `TYPO_TOKENS` data array updated but the UI stays as-is.
- **Tiptap editor internals.** The `.tiptap-editor h1/h2/h3` rules in `index.css` reference `--typo-display-*`, `--typo-heading-*`, `--typo-heading-sm-*` — all three tokens still exist in the new system, so these rules keep working without edits.
- **Semantic renames.** `text-heading-xs` → `text-body-strong` is a migration (token deletion), not a rename. Other token names stay.
- **Theme / color tokens.** Separate concern, untouched.

## 8. Risks

- **`text-label` at 11/600 in muted color may feel too close to `text-body-strong` at 14/600.** Mitigation: the 3px size delta plus the muted color give enough contrast. If it reads flat after implementation, drop label color from `text-muted-foreground` to a slightly darker shade — no token change needed.
- **Body tracking -0.006em is subtle but universal.** Every body-text site will shift slightly. Likely imperceptible at 14px, but review the densest surfaces (task list, calendar panel) after migration.
- **Removing `text-heading-xs` is a breaking rename.** Every callsite must migrate to `text-body-strong` or the site loses its styling. Catch via grep before committing.
- **The `TypographyTuner`'s "Copy CSS overrides" output format may need an update** to reflect the new token list. Not a gate.

## 9. Implementation order (preview — real plan lives in `writing-plans` output)

1. Update `index.css` — tokens + rules + family defaults.
2. Update `typography-tokens.ts` to mirror.
3. Add `<BodyStrong>` + `<Caption>` primitives.
4. Mechanical migrations in order of leverage: `text-body font-medium` → `text-body-strong` (biggest win), then `text-heading-xs` → `text-body-strong`, then micro-text, then raw Tailwind sizes, then uppercase sweep, then tracking/leading sweep.
5. FocusView timer migration.
6. Write `docs/typography-system.md`.
7. Sanity pass: `grep -r "text-\[" apps/desktop/src`, `grep -r "uppercase" apps/desktop/src`, `grep -r "font-medium" apps/desktop/src` — expect near-zero results.

## 10. Success criteria

- Zero raw `text-xs/sm/base/lg/xl/*` in `apps/desktop/src` (excluding `ui/` primitives).
- Zero `text-[Npx]` in `apps/desktop/src`.
- Zero `uppercase` utilities in `apps/desktop/src`.
- `font-medium`/`font-semibold` overrides on `text-body` reduced from 109 → 0.
- `TypographyTuner` reflects the new token list; tuning any token changes the app live.
- Visual regression check on Today, Tasks, Inbox, Goals, Settings, Focus, Session, Docs — no unintended shifts beyond the intentional tracking/LH refinements.

---

## Appendix A — Token spec as Tailwind v4 `@theme`

```css
@theme {
  --font-heading: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  --font-sans:    'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  --font-mono:    'Geist Mono Variable', ui-monospace, 'SF Mono', monospace;

  --text-caption:       0.625rem;  /* 10 */
  --text-caption--line-height: 1.2;
  --text-label:         0.6875rem; /* 11 */
  --text-label--line-height: 1.15;
  --text-meta:          0.75rem;   /* 12 */
  --text-meta--line-height: 1.35;
  --text-body:          0.875rem;  /* 14 */
  --text-body--line-height: 1.4286;
  --text-body-strong:   0.875rem;  /* 14 */
  --text-body-strong--line-height: 1.4286;
  --text-heading-sm:    1rem;      /* 16 */
  --text-heading-sm--line-height: 1.3;
  --text-heading:       1.125rem;  /* 18 */
  --text-heading--line-height: 1.25;
  --text-display:       1.5rem;    /* 24 */
  --text-display--line-height: 1.15;
  --text-display-xl:    2rem;      /* 32 */
  --text-display-xl--line-height: 1.05;
  --text-timer:         3rem;      /* 48 */
  --text-timer--line-height: 1;
}
```

## Appendix B — Tunable defaults in `@layer components`

```css
@layer components {
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

All `text-transform: uppercase` declarations and positive `letter-spacing` values from the old system are removed.
