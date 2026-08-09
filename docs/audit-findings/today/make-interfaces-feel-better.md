# Today page — make-interfaces-feel-better findings

**Surface:** Today page, empty state (Review mode, step 1 of 3 — "Your schedule" with no meetings).
**Source:** `nimble/apps/desktop/src/components/pages/TodayPage.tsx`, `nimble/apps/desktop/src/components/layout/Dashboard.tsx`, `nimble/apps/desktop/src/components/shared/PageHeader.tsx`, `nimble/apps/desktop/src/components/calendar/CalendarPanel.tsx`, `nimble/apps/desktop/src/components/shared/HelpPanel.tsx`, `nimble/apps/desktop/src/index.css`.

The Today page renders cleanly and the structural pieces (PageHeader, ReviewStep card, CalendarGlance) are in good shape. Most issues are polish-level: a missing `-webkit-font-smoothing` declaration on the root that affects every glyph on macOS, no `text-wrap: balance` on the centered greeting/title pair, the in-page review card and calendar rail both animating in as one block without staggered semantic chunks, the "Next" primary button lacking the tactile `scale(0.96)` press feedback the rest of the app would benefit from, a floating help button below the 40×40 hit-area minimum, an inner card whose border radius isn't concentric with its parent, and the calendar error block stacked with `space-y-2` instead of optically tuned spacing. Severity is almost entirely polish/minor — no blockers.

---

### Missing root font smoothing on macOS

- **Severity:** minor
- **File:** `nimble/apps/desktop/src/index.css:120-122` (`body { @apply bg-background text-foreground; }`)
- **Principle:** Font smoothing (`make-interfaces-feel-better` §8) — apply `-webkit-font-smoothing: antialiased` to the root layout on macOS for crisper text.
- **ux-intent:** §1.4 (Linear-inspired, warm, restrained — "earned attention" requires legible primary content) and §3.4 (visual / type violations).
- **What's off:** The body declaration sets bg + text color but never opts into antialiased font smoothing. On the macOS WebView every Geist glyph in the screenshot ("Good evening", "Today", "Your schedule", "Next") renders with the default subpixel-AA path, which on a Tauri webview reads slightly heavier than the Linear/Geist reference. App-wide effect — fixing once benefits every surface.
- **Implementation:** Add `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;` to the `body` rule in `@layer base` (between lines 120–122).

### Greeting + subtitle missing `text-wrap: balance`

- **Severity:** polish
- **File:** `nimble/apps/desktop/src/components/pages/TodayPage.tsx:237-240` (ReviewMode greeting block).
- **Principle:** Text wrapping (`make-interfaces-feel-better` §10) — `text-wrap: balance` on headings, `pretty` on body.
- **ux-intent:** §2.1 (Today done-right — guided morning surface, centered greeting is the user's first impression) and §1.4 (restrained, intentional typography).
- **What's off:** The `<h2 className="text-heading">{getGreeting()}</h2>` and the body `<p>Let's plan your day.</p>` are both center-aligned but free-wrap. Today the strings fit on one line, but `Good afternoon` plus a longer subtitle ("Let's plan your day.") can split awkwardly at narrow widths or after localisation, leaving an orphan word in the center column.
- **Implementation:** Add `text-balance` (Tailwind v4) to the `h2`, and `[text-wrap:pretty]` (or a `.text-pretty` utility) to the subtitle paragraph. Mirror the same on the DashboardMode greeting at `TodayPage.tsx:380-387`.

### `ReviewStep` card border radius isn't concentric with the badge inside it

- **Severity:** minor
- **File:** `nimble/apps/desktop/src/components/pages/TodayPage.tsx:104-116` (`ReviewStep` wrapper `rounded-lg p-4` + inner `size-6 rounded-full` step badge).
- **Principle:** Concentric border radius (`make-interfaces-feel-better` §1, "Common Mistakes — same border radius on parent and child").
- **ux-intent:** §1.4 (Linear-inspired, restrained) and §3.5 (density / spacing violations — chrome should not compete with content).
- **What's off:** The wrapping card uses `rounded-lg` (8px in this app's radius scale at default `--radius`) with `p-4` (16px). The interior step badge is fully `rounded-full` so it doesn't fight the parent, but the inner `<h3>` next to it sits inside a 16-pixel padded box whose corner radius (8px) is mathematically smaller than the badge's effective inset (16 − 12 = 4px gap to the corner). The visual rhythm reads as "card corners are tight relative to the airy interior" — a frequent cause of cards feeling cramped at the corners.
- **Implementation:** Bump the wrapper to `rounded-xl` (or `rounded-2xl`) so outer radius ≈ inner padding + 8px, matching the Linear-inspired surfaces elsewhere in the app. Same fix applies to the dashboard brief container at `TodayPage.tsx:397` (`rounded-lg border ... p-4`).

### Review step card animates as a single chunk (no semantic stagger)

- **Severity:** polish
- **File:** `nimble/apps/desktop/src/components/pages/TodayPage.tsx:104-127` (`active && 'animate-in fade-in slide-in-from-bottom-2 duration-200'`).
- **Principle:** Split and stagger enter animations (`make-interfaces-feel-better` §5) — don't animate a single container; break into semantic chunks with ~100ms delay.
- **ux-intent:** §1.6 (optimistic updates + instant feedback; ease-out animations) and §2.1 (guided morning — review should feel inviting, not snap into place).
- **What's off:** When step 1 activates, the entire `ReviewStep` (badge + title + content + Next button) slides up as a single 200ms tween. The semantic chunks — (a) the numbered badge "1", (b) the title "Your schedule", (c) the body copy, (d) the `Next` button — would feel intentional staggered ~80–100ms apart, the way the dashboard task list already does with `Math.min(i, 14) * 25ms` (`TodayPage.tsx:423,451`).
- **Implementation:** Replace the single `animate-in` on the wrapper with the existing `animate-row-enter` utility (`index.css:387-394`) applied to badge/title/body/footer with `animationDelay` of `0ms / 60ms / 120ms / 180ms`. Cap at the four chunks so the cascade stays under 250ms total.

### Primary `Next` button has no scale-on-press feedback

- **Severity:** polish
- **File:** `nimble/apps/desktop/src/components/ui/button.tsx:9` (base `buttonVariants` class) — affects the `Next` button at `TodayPage.tsx:263-265`.
- **Principle:** Scale on press (`make-interfaces-feel-better` §12) — `active:scale-[0.96]` for tactile feedback. Never below 0.95.
- **ux-intent:** §1.6 (every interaction produces immediate visual response) and §2.1 (guided mornings — the only forward affordance in step 1 should feel tactile).
- **What's off:** The current `Button` primitive uses `active:not-aria-[haspopup]:translate-y-px` for press feedback — a 1px Y-shift that's barely visible on a 28px-tall `size="sm"` button. The empty-state screenshot is dominated by the dark `Next` button (the only colored element on the page), so it's the highest-leverage spot to add tactile feel.
- **Implementation:** Add `active:scale-[0.96]` and `transition-[transform,colors,background-color,box-shadow]` to the base `buttonVariants` class (button.tsx:9), replacing the current `transition-all` (also fixes a separate §14 violation — never `transition: all`). Keep the existing `translate-y-px` or drop it in favor of the scale.

### `Button` uses `transition-all` instead of explicit properties

- **Severity:** minor
- **File:** `nimble/apps/desktop/src/components/ui/button.tsx:9` (`... whitespace-nowrap transition-all outline-none ...`).
- **Principle:** Never use `transition: all` (`make-interfaces-feel-better` §14) — always specify exact properties.
- **ux-intent:** §1.6 (optimistic updates + instant feedback — animation correctness matters when the button is the primary action), §3.4 indirectly.
- **What's off:** Tailwind's `transition-all` animates every animatable property, including `width`, `border-color`, and `box-shadow` simultaneously. On the `Next` button this couples the focus-ring transition to the background-color hover transition, and on hover-out you can see the ring fade lag the bg fade by ~50ms because they share the same easing curve over the same duration but start from different deltas.
- **Implementation:** Replace `transition-all` with `transition-[background-color,color,border-color,box-shadow,transform]` (Tailwind v4 arbitrary value). Duration / easing already inherited from the variant.

### `HelpPanel` floating button is 36×36, under the 40×40 hit-area minimum

- **Severity:** minor
- **File:** `nimble/apps/desktop/src/components/shared/HelpPanel.tsx:181` (`'fixed bottom-4 right-4 z-30 flex size-9 ...'`).
- **Principle:** Minimum hit area (`make-interfaces-feel-better` §16) — at least 40×40px; extend with a pseudo-element if the visible element is smaller.
- **ux-intent:** §1.5 (keyboard-first but mouse-second; common actions remain discoverable) and §3.6 (interaction gaps).
- **What's off:** `size-9` resolves to 36×36px. The button sits at `bottom-4 right-4` (16px from the corner), so there's plenty of room to extend the hit area without changing the visible size. Visible in the empty-state screenshot as the dark circle bottom-right.
- **Implementation:** Either bump to `size-10` (40×40) and accept the visual size, or keep `size-9` and add a `before:absolute before:inset-[-2px] before:content-['']` pseudo-element to extend the click target to 40×40 while preserving the visual chrome.

### Calendar error block uses generic vertical spacing where optical tuning would help

- **Severity:** polish
- **File:** `nimble/apps/desktop/src/components/calendar/CalendarPanel.tsx:491-498` (error branch with "Could not load calendar" + Retry button).
- **Principle:** Optical over geometric alignment (`make-interfaces-feel-better` §2) and Subtle exit animations / restrained chrome (§6 indirectly — error states should be quiet).
- **ux-intent:** §1.4 (earned attention — chrome and error metadata are dimmer, smaller, lower contrast than primary content) and §3.5 (density / spacing — chrome shouldn't compete).
- **What's off:** In the screenshot the "Could not load calendar" sits in the calendar rail at full destructive red with a Retry button immediately below at `text-label h-6` and left-aligned to the same x. The destructive text reads as primary content competing with the page title "Today" at the same horizontal scan line — the eye treats them as peers. The retry sits flush-left under the message rather than optically inset to match the message's leading.
- **Implementation:** Tone the error text from `text-destructive` to `text-destructive/70` (or move red into the icon only and keep the text muted), and inset the Retry button by `pl-0.5` to optically align its text leading with the message's x-height — small shift but kills the "two things shouting" feel.

### Empty-state subtitle could use a soft enter, not the parent's full slide

- **Severity:** polish
- **File:** `nimble/apps/desktop/src/components/pages/TodayPage.tsx:237-240` (greeting block) inside `animate-page-enter` (`Dashboard.tsx:223`).
- **Principle:** Split and stagger enter animations (`make-interfaces-feel-better` §5) and Subtle exit animations / softer enter rhythm (§6 logic applied to enters).
- **ux-intent:** §1.6 (ease-out animations, fast start, gentle landing) and §2.1 (guided morning — the greeting is the emotional anchor of the surface).
- **What's off:** Currently the greeting and subtitle ride the parent page enter animation as one unit (translateY 6px + fade, 320ms). On a guided morning surface the greeting is the line you want to land first and the subtitle should follow a beat later, the way the dashboard task rows already do. As shipped they snap into place together with the chrome.
- **Implementation:** Apply `animate-row-enter` to the `h2` and the `<p>` individually with `animationDelay: '40ms'` and `'120ms'` — uses existing motion tokens, no new keyframes needed. Skip on prefers-reduced-motion via the existing CSS guard.

### `PageHeader` title + meta lack `text-wrap: balance`, and meta sits flush without optical inset

- **Severity:** polish
- **File:** `nimble/apps/desktop/src/components/shared/PageHeader.tsx:43-53` (title + meta row).
- **Principle:** Optical over geometric alignment (`make-interfaces-feel-better` §2) and Text wrapping (§10).
- **ux-intent:** §1.4 (Linear-inspired restraint — header is chrome, should sit quietly).
- **What's off:** "Today" (`text-heading-sm`) and "Sunday, May 10" (`text-meta text-muted-foreground`) are baseline-aligned via `items-baseline`, but with the Geist x-height the meta sits ~1px optically high against the title's descender baseline. At this scale it reads as a slight float. Also, neither uses `text-balance`, so longer page titles on other surfaces will wrap unevenly with a long meta string.
- **Implementation:** Add `relative top-px` (or `mt-px`) to the meta `<span>` for optical baseline alignment, and `text-balance` to the `<h1>`. Pure polish — fix once, applies to every page.

---

## Out of scope (noted for sibling agents)

- The `1` numbered step badge using `font-semibold` (`text-meta font-semibold`) where the rest of the app uses `text-body-strong` for emphasis — that's a design-system token violation, belongs to design-qa.
- Calendar empty-state message tone ("Nothing scheduled — deep work time.") — content/copy, belongs to interface-craft critique.
- The two `Dashboard.tsx:122` Tauri `listen()` console errors — already cataloged, skipped per the brief.
