# Today Page — Design QA Findings (Empty State, Review Mode)

**Audit date:** 2026-05-10
**Surface:** Today page, empty state (no brief, no calendar events, no tasks), Review mode Step 1.
**Sources audited:** `daily-triage/apps/desktop/src/components/pages/TodayPage.tsx`, `daily-triage/apps/desktop/src/components/layout/Dashboard.tsx`, screenshot `smoke-today-after-bypass.png`.
**Rubric:** `daily-triage/docs/ux-intent.md`.

## Summary

12 findings: **3 blocker**, **4 major**, **4 minor**, **1 polish**. The Today page broadly honors the rubric — review mode flow, skeleton placeholders, sentence case, no spinners. The blockers cluster around one root cause: the urgency-grouping vocabulary still contains literal "Overdue" labels and high-urgency triage framing, in direct contradiction of §1.1 / §3.1 ("no guilt UI, neutral 'still open' framing"). The right rail also surfaces a red error state visible in the screenshot that performs urgency at the user. Beyond the guilt-framing issues, the recurring secondary theme is **hardcoded / non-semantic color tokens** (`bg-accent-blue`, `text-green-500`, ad-hoc opacity scales like `/5`, `/20`, `/30`, `/40`) that bypass the warm theme system described in §1.4 / §3.4. A handful of minor spacing oddities (`pl-[62px]`, `max-h-[50vh]`) and a Dashboard/Review greeting alignment inconsistency round out the list.

---

### 1. "Overdue" label string violates the no-guilt rule

**Severity:** blocker
**File:** `TodayPage.tsx:78`
**Citation:** ux-intent §1.1, §3.1
**What's wrong:** `groupByUrgency` constructs a literal `title: 'Overdue'` group label. Section 1.1 explicitly prohibits "overdue" labels — the rubric mandates the neutral phrase "still open." Even though this group is in Dashboard mode (not the empty-state path captured in the screenshot), the string lives in the audited file and will render the moment the user has any past-due Todoist task.
**Suggested fix:** Rename the group key/title to `'Still open'` (or `'Carried over'`). Audit all surfaces that render `urgencyGroups[].title` to confirm.

### 2. `TriageSection` calls past-due items "overdue" via variable + copy

**Severity:** blocker
**File:** `TodayPage.tsx:177-195`
**Citation:** ux-intent §1.1, §3.1
**What's wrong:** Variable name `overdue` and the copy `"{n} items need attention"` together frame past-due work as urgent/punitive. Section 1.1 says the app "nudges the evening review; it does not nag." "Need attention" performs urgency.
**Suggested fix:** Rename the variable to `carriedOver` and reword the copy to something pull-based: `"{n} still open — clear or carry forward."` Remove the `[...overdue, ...highPriority]` concatenation that implies a single "urgent" bucket.

### 3. Right rail shows red "Could not load calendar" error

**Severity:** blocker
**File:** Right rail (out of audited file scope) — visible in `smoke-today-after-bypass.png`
**Citation:** ux-intent §1.1, §1.4 ("earned attention"), §3.1
**What's wrong:** The empty-state screenshot shows a bright red `Could not load calendar` / `Retry` block in the right rail. Red error chrome on the morning surface — at the exact moment the user is meant to feel "wide open for deep work" — directly contradicts §1.1 (no guilt UI) and §1.4 (chrome should be dimmer than primary content, color reserved for semantic meaning). Calendar permissions failure is not user-correctable from this view.
**Suggested fix:** Neutralize the failure state to muted gray with text like `"Calendar offline."` Move the Retry action to a tooltip or settings deep-link. Save red strictly for destructive-action confirmations.

### 4. Hardcoded `bg-accent-blue` for progress fill

**Severity:** major
**File:** `TodayPage.tsx:41`
**Citation:** ux-intent §1.4, §3.4
**What's wrong:** `bg-accent-blue` is a cool-blue token in a palette the rubric describes as "warm gray... not cool blue." It is also used for a non-semantic state (mere progress %), violating §1.4's "color is reserved for semantic meaning only."
**Suggested fix:** Use a warm progress color from the theme (e.g., the amber heatmap referenced in §2.6) or a neutral foreground tint. Same fix for `bg-green-500` on line 41 — should be a semantic theme variable, not a Tailwind palette value.

### 5. `text-green-500` hardcoded on the completed-step badge

**Severity:** major
**File:** `TodayPage.tsx:113`
**Citation:** ux-intent §3.4
**What's wrong:** `bg-green-500/10 text-green-500` on the completed step's circle skips the theme system. Section 3.4 lists "hardcoded colors instead of frame theme vars" as an anti-pattern.
**Suggested fix:** Define a semantic `--canary-success` (or equivalent) token in the theme and reference it via `bg-success/10 text-success`.

### 6. Ad-hoc opacity scale (`/5`, `/20`, `/30`, `/40`) bypasses the token system

**Severity:** major
**File:** `TodayPage.tsx:106` (`bg-muted/30 border-border/30`), `397` (`bg-muted/5`), `401` (`text-muted-foreground/40`), `418, 449` (`divide-border/20`)
**Citation:** ux-intent §1.4, §3.4
**What's wrong:** Five different opacity steps applied to muted/border tokens, all hand-picked, none registered. This is the same class of violation Marco was already burned by on 2026-04-18 (`text-<color>` not in `extendTailwindMerge`). Each instance is a hidden mini-token.
**Suggested fix:** Introduce three named tiers (`subtle`, `quiet`, `chrome`) in the theme and replace the inline opacity modifiers. At minimum, collapse `/5` + `/20` + `/30` into one token; they're imperceptibly distinct.

### 7. Step circle uses `font-semibold` instead of `text-body-strong`

**Severity:** major
**File:** `TodayPage.tsx:111-112`
**Citation:** ux-intent §3.4
**What's wrong:** Section 3.4 explicitly calls out `font-medium` / `font-semibold` stacks instead of `text-body-strong`. The inline comment on line 110 acknowledges this is a deliberate kept exception, but the rubric doesn't grant the carve-out — and using the token would carry the kerning/leading the design system intends.
**Suggested fix:** Replace `text-meta font-semibold` with the existing `text-meta-strong` (or define one if missing) so the badge typography is system-driven.

### 8. Greeting alignment differs between Review and Dashboard mode

**Severity:** minor
**File:** `TodayPage.tsx:237` (`text-center` in ReviewMode) vs `TodayPage.tsx:380` (left-aligned in DashboardMode)
**Citation:** ux-intent §1.7 (guided morning → dashboard transition should feel continuous)
**What's wrong:** Review mode centers "Good evening / Let's plan your day"; Dashboard mode left-aligns the same greeting. The transition between the two modes is meant to be a smooth handoff (§1.7), not a layout jump.
**Suggested fix:** Pick one — recommend left-aligned in both, matching the rest of the app's left-rail visual rhythm. Centered text on a wide left-padded canvas reads as "splash screen," which is the opposite of the §1.7 dashboard intent.

### 9. `max-h-[50vh]` is an off-grid arbitrary value

**Severity:** minor
**File:** `TodayPage.tsx:256`
**Citation:** ux-intent §3.5
**What's wrong:** Section 3.5 mandates spacing on the 8px grid (4 / 8 / 16 / 32 / 64). `50vh` is viewport-relative and not on any documented scale.
**Suggested fix:** Cap the brief preview at a token like `max-h-[32rem]` (512px, on grid) or expose the value through theme so it's tunable.

### 10. `pl-[62px]` arbitrary inline spacing

**Severity:** minor
**File:** `TodayPage.tsx:164`
**Citation:** ux-intent §3.5
**What's wrong:** `pl-[62px]` on the "+N more" line breaks the 8px grid (the nearest valid steps are 56 or 64). The 62 is presumably visually aligning under the time column above, but it's load-bearing magic.
**Suggested fix:** Either align via flex container with the same `w-14` (56px) column the time uses, or formalize the alignment offset as a token.

### 11. Step 1 card uses heavy chrome for a single sentence in the empty state

**Severity:** minor
**File:** `TodayPage.tsx:104-126`, visible in screenshot
**Citation:** ux-intent §1.4 ("earned attention"), §3.5
**What's wrong:** When the empty state shows only `"No meetings today — wide open for deep work."`, the surrounding `rounded-lg border p-4` card chrome is heavier than the primary content. Per §1.4, "chrome and metadata are dimmer, smaller, lower contrast than primary content."
**Suggested fix:** In the empty-brief / empty-calendar variant of Step 1, drop the card border and let the copy + the step circle carry the layout. Alternatively, render this single sentence as the inline body of Step 2's energy selector so the user doesn't need to click Next on nothing.

### 12. "Let's plan your day" reads awkwardly in the evening

**Severity:** polish
**File:** `TodayPage.tsx:239`
**Citation:** ux-intent §2.1 ("Today walks the user through a daily review on first open of the day"), §1.7
**What's wrong:** Screenshot shows `"Good evening"` paired with `"Let's plan your day."` Section 2.1 frames Today as the *morning* surface; the evening-open case is currently un-special-cased. Telling someone at 9pm to "plan your day" is mildly dissonant.
**Suggested fix:** Add a third copy variant for evening: `"Let's wrap up."` or `"Quick end-of-day pass?"` — keying off the same `getGreeting()` hour buckets that already exist on line 27.
