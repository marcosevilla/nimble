# Today page — Interface Craft critique (empty state)

**Mode:** Design Critique (Josh Puckett methodology)
**Surface:** Today page, review mode, Step 1 visible, no calendar/brief data
**Inputs:** `smoke-today-after-bypass.png`, `TodayPage.tsx`, `Dashboard.tsx`, `CalendarPanel.tsx:480-510`
**Rubric:** `nimble/docs/ux-intent.md`

## Summary — overall craft level: 2/5

The page reads as scaffolding, not a designed surface. The intent (Section 2.1) is a *guided morning* that walks the user through review on first open — but what renders is a near-empty canvas with one solitary card floating in the upper-left third of the workspace, while the right rail screams a red error and "Retry" button at the user's eye. The typographic system is competing with itself (a centered display-style greeting just above a left-aligned step card), the focal point is the wrong element (an error message, not the user's review), and there is no entry rhythm — no animation, no easing-in of the day. For an ADHD-friendly low-friction surface (Section 1.2) the first frame of the day should feel calming and obvious; this one feels broken. The good news: the row-level craft inside the step card (numbered badge, clean type, subtle muted copy, decent button) is competent. The failure is layout-scale, not pixel-scale.

---

### Greeting placement breaks the page's visual entry point
**Severity:** major
**File:** `TodayPage.tsx:236-240` (review mode), `TodayPage.tsx:378-387` (dashboard)
**Cites:** ux-intent §1.4 ("earned attention"), §2.1 ("guided mornings")

"Good evening / Let's plan your day." is centered, while every other element on the page is left-aligned. It sits in a `space-y-1 py-4` block with no surrounding container, so it floats orphaned above the step card and reads as a pop-up alert, not a header. Centered display type on an otherwise left-aligned dashboard violates the earned-attention principle by drawing the eye to copy that carries the least information density (a generic greeting).

**Direction:** Left-align the greeting, drop the `text-center`, and treat it as page-intro copy (one heading-sm + meta line) tucked under the PageHeader. Or, if the centered "moment" is intentional, commit to it with vertical space above and below and remove the PageHeader's title duplication.

---

### Right rail error is the loudest element on the page
**Severity:** blocker
**File:** `CalendarPanel.tsx:491-498`
**Cites:** ux-intent §1.1 (no guilt UI / no performing urgency), §3.1 (anti-pattern: performing urgency), §1.6 (instant feedback, no spinners but also no panic)

`text-destructive` (red) renders "Could not load calendar" as the highest-contrast text on the entire canvas. In the empty state, with no other tasks or events competing, the red text + Retry button steal the focal point from the actual review step. For a calm morning surface this is the opposite of the intended emotional register — the app is performing failure at the user before they've even started their day. Also: the failure mode in a non-Tauri browser context is expected, not exceptional, so destructive coloring is editorializing.

**Direction:** Demote calendar-load failures to muted-foreground text with no color, no border. Move the Retry to a small ghost icon button or auto-retry silently. Reserve `text-destructive` for genuinely user-actionable destructive states (delete confirmations, sync conflicts).

---

### No focusing mechanism — empty canvas dilutes the one card that matters
**Severity:** major
**File:** `TodayPage.tsx:235-286`
**Cites:** ux-intent §2.1 ("walks through review"), §1.2 (reduce decision overhead)

The review card occupies ~25% of the viewport width and sits in the upper-left, leaving roughly 60% of the main column empty below it. There's no visual mechanism that says "this is the thing — focus here." The page reads as "something is missing" rather than "here is your one task." Linear, Stripe, and Things would all narrow the column, vertically center the active step, or use an enter animation to plant the focal point.

**Direction:** Either constrain the review column to a centered ~520px max-width with vertical centering on first open, or add a soft `bg-muted/20` page background with the card on `bg-card` so the active surface is visually elevated. Animate the step card in with a fade + small slide-up so the eye is led to it.

---

### Step 1 of N — but N is invisible
**Severity:** major
**File:** `TodayPage.tsx:243-285` (3 ReviewSteps), `TodayPage.tsx:111-115` (badge renders only the active step number)
**Cites:** ux-intent §2.1 (intended flow has 4 steps: brief → energy → priorities → triage), §1.6 (expectation setting)

The badge reads "1" but there's no "of 3" or "of 4," and inactive steps are hidden entirely (`if (!active && !done) return null`). The user has no idea whether they're about to commit to a 30-second flow or a 5-minute one. ADHD users especially need scope set before they start (§1.2). The buildplan/UX intent specifies 4 phases; the code ships 3 — the discrepancy is invisible to the user but worth flagging.

**Direction:** Render upcoming steps as collapsed/ghosted rows (title only, no body, dimmer) so the user sees the runway. Or add a "Step 1 of 3" meta line next to the badge. Either way: show the path.

---

### "Your schedule" empty-state copy is fine, but the section gives back nothing
**Severity:** minor
**File:** `TodayPage.tsx:142-148`
**Cites:** ux-intent §1.1 (positive empty states), §1.6 (feedback & reward)

"No meetings today — wide open for deep work." is genuinely good copy — positive framing, useful interpretation. But it sits as a single muted paragraph with no visual reward for the empty state. There's no small icon, no gentle illustration moment, no "earned" feeling — it's just text-and-button. The first thing the user sees on an empty-calendar day should feel like a small win, not a sentence and a Next button.

**Direction:** Add a small lucide icon (Sun, Coffee, or Sparkles) inline before the copy, or render the empty-state as a single 32px-tall row with an icon-left + copy-right pattern so it reads as intentional rather than absent.

---

### Next button has no keyboard hint and no implicit Enter affordance
**Severity:** minor
**File:** `TodayPage.tsx:263-265`
**Cites:** ux-intent §1.5 (keyboard-first), §3.6 (a common action without a single-key shortcut)

The review flow is the most predictable single-path interaction in the app — every user will press Next, Next, Next, Ready to go. There is no `kbd` shortcut shown on the button (no `↵` / Enter glyph), and Enter doesn't appear to be wired as the default action for the step. For a keyboard-first product (§1.5), the most linear flow shouldn't require mouse travel.

**Direction:** Add `<kbd>↵</kbd>` inside the button (mirroring command-bar style) and wire Enter to advance the active step. Optionally show "↵ Next · Esc to skip" in a small meta line below the button.

---

### No motion on entry — the page just appears
**Severity:** polish
**File:** `Dashboard.tsx:221-227` (`animate-page-enter` on the page wrapper), `TodayPage.tsx:104-108` (step card fade-in)
**Cites:** ux-intent §1.6 (ease-out animations, gentle landing)

The page-enter animation is applied to the outer `<main>`, but the centered greeting and the step card animate in together as one block, which means the eye has nothing to follow. A guided morning should feel like the day *opens* — greeting first, then the step card landing under it, with the badge ticking from blank to "1". Right now everything arrives simultaneously, which reads as "rendered" rather than "presented."

**Direction:** Storyboard the entry: 0ms page bg, 80ms greeting fades in, 200ms step card slides up + fades in, 350ms badge number scales in from 0.8 → 1.0. Total under 500ms so it doesn't feel slow. (Interface Craft Storyboard Animation pattern is a natural fit here when you choose to implement.)

---

### Right rail "May / Sun 10 / [collapse icon]" header has uneven optical weight
**Severity:** polish
**File:** `CalendarPanel.tsx` (DayNavigationHeader area, ~line 483)
**Cites:** ux-intent §1.4 (Linear-inspired, restrained), §3.4 (raw size violations)

"May" sits left, "Sun 10" sits right, with chevron arrows between — but "May" appears heavier/larger than "Sun 10" while the latter is the more specific (and therefore more important) piece of information. The collapse icon in the top-right corner is also visually unmoored from the rest of the header row, sitting on its own line. Three pieces of chrome competing in a 24px-tall header area.

**Direction:** Match the type scale between "May" and "Sun 10" (both should be the same token — likely `text-label`), and either inline the collapse icon with the header row or move it to a consistent corner across all right-rail panels.

---

### Greeting + page header duplicate the date moment
**Severity:** minor
**File:** `TodayPage.tsx:234` (PageHeader meta=dateStr) + `TodayPage.tsx:236-240` (greeting block)
**Cites:** ux-intent §1.4 (restraint), critique-methodology "Redundancy"

`PageHeader` already shows "Today · Sunday, May 10" at the top. Two lines below, a centered "Good evening / Let's plan your day." carries no new information — the user already knows it's evening (the title bar told them the date, the OS told them the time). It's friendly filler.

**Direction:** Pick one. Either remove the PageHeader meta date and let the greeting carry the day-context (with the time-aware copy doing the work), or drop the greeting entirely and let PageHeader + the step card stand alone. Choosing the second is more Linear; choosing the first is more "guided morning."

---

### Step card border + padding combination feels web-default, not Linear
**Severity:** polish
**File:** `TodayPage.tsx:104-108` (`rounded-lg border p-4`)
**Cites:** ux-intent §1.4 (Linear-inspired, restrained), §3.5 (chrome shouldn't compete with primary content)

The card uses `rounded-lg border p-4 bg-card` — a generic shadcn default. The border is full-opacity `border-border`, which gives the card more visual weight than its content warrants on an otherwise quiet page. Linear's equivalent surfaces typically use either no border + subtle bg differentiation, or a very low-opacity border (`border-border/40`). At this density, the card edge competes with the content inside it.

**Direction:** Try `border-border/30` or drop the border entirely and lean on `bg-card` with a 1px top-border-only divider style. Test against the step number badge to make sure the badge still reads as the entry point of the card.
