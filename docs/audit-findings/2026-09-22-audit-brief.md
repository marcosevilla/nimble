# Design facelift audit brief — 2026-09-22 (shared by every audit agent)

You are one of nine read-only audit agents auditing Nimble, a Tauri + React desktop app. You own ONE surface (named in your dispatch prompt). You do not edit code. You write one findings file and return a short summary.

## The app in five lines

1. Nimble is a macOS desktop app for daily triage: one keyboard-first interface that merges native tasks, Google Calendar and an Obsidian vault.
2. It is built for exactly one user: Marco, an ADHD product designer. Morning triage (Today page guided review → dashboard), quick capture (Inbox), and task-detail editing are the three flows that matter.
3. It is Linear-inspired: warm gray oklch palette, color only for semantic meaning, "earned attention" (chrome dimmer than content), 8px grid, 10-token type scale, Geist.
4. No-guilt: no streaks, no "overdue", no "you've been away". Neutral "still open" framing. Positive empty states. Skeletons, never spinners.
5. "Done" for this facelift = the seven pages read as one designed object, both light and dark themes, with every existing keyboard shortcut intact and every visible change token-based.

## Rubric — mandatory citation

`docs/ux-intent.md` is the only rubric. Read Section 1 in full, the Section 2 entry for your surface, and skim Section 3. **Every finding cites a section number (e.g. "§1.4", "§3.5").** No citation → it is a preference, not a finding → drop it. Low-severity polish items additionally cite a `make-interfaces-feel-better` principle by name.

Severity mapping: P1 = Section 3 anti-pattern or Section 1 violation. P2 = Section 2 surface intent missing/broken, or a cross-surface inconsistency. P3 = polish with a craft-principle citation.

## Skills to load (in this order, before reading code)

1. `design-qa` — **audit-only mode**: no Linear tickets, no Slack posts, no fixes. Use its sizing/token/typography/a11y sweep checklist.
2. `interface-craft` — Design Critique mode.
3. `make-interfaces-feel-better` — full review mode.
4. `better-ui`, `better-typography`, `better-colors`.

Skills override your instincts. If a skill wants to write tickets or code, refuse — you are read-only.

## Dimensions (score each 1–5, with one line of evidence per score)

- **UI / visual:** tokens vs hardcoded values, type scale, color and contrast (both themes), spacing rhythm, radius, borders/shadows, icon weight and size, optical alignment, tabular numbers, density.
- **Interaction:** keyboard coverage and focus rings, hover/active/pressed states, hit areas, transitions and motion restraint, optimistic updates, loading/empty/error states, undo where destructive.
- **UX:** does the surface serve the morning triage flow, capture flow, and task-detail editing flow with minimal decisions; no-guilt language; discoverability of the editor and shortcuts; consistency with the other surfaces; information hierarchy.
- **Accessibility:** roles, labels, contrast, reduced-motion, focus order.

Scoring anchor: 3 = competent and consistent with intent; 4 = would pass a Linear design review with minor notes; 5 = nothing to add. 2 = clear rubric violations; 1 = broken.

## What already exists — do NOT re-report

- Type tokens: `docs/typography-system.md` (10 tokens: caption/label/meta/body/body-strong/heading-sm/heading/display/display-xl/timer). Note the LIVE `apps/desktop/src/index.css` `@theme` block currently defines `--text-label/meta/meta-strong/body/body-strong/title/display/timer` — if the doc and the CSS disagree, that drift IS a finding (P2, §3.4) but report it once, under "type scale drift", not per usage.
- Motion tokens exist in `index.css`: `--transition-fast/base/slow`, `--ease-entrance/exit`. Hardcoded `duration-*` that bypass them are findings; the token absence is not.
- Prior Today-page loop (2026-05-10, `docs/audit-findings/today/*.md`) fixed: Overdue→still-open group labels, red calendar error chrome, centered-520px review column, Enter advances steps. Verify against current code before reporting anything from those files.
- `docs/polish-pass-audit.md` inventoried animation durations. Don't re-inventory; report only durations that still bypass the tokens.
- Known dev-only artifacts: the `TypeSystemOverlay`, the Agentation toolbar (dark 44px circle bottom-right), and `window.__stores` are NOT app UI. Do not report them.
- Known non-fatal console warnings in the browser harness: Tauri `listen()`/`transformCallback`. Ignore.

## Locked decisions — do not re-litigate, do not "fix"

- Cmd+K is actions-only (no vault search in it). Vault editing stays disabled (Tiptap round-trip corrupts Obsidian markdown). C1–C5 build order stands. Task-detail inline editors are being redesigned by Marco in Figma — you may report problems with them, but the fix line must say `QUEUED FOR MARCO`.
- Every existing keyboard shortcut is preserved. Report missing ones; never propose removing one.
- Frontend only (`apps/desktop/src`). If a fix needs Rust, schema, sync or Tauri command changes, the proposed fix line must say `NEEDS RUST → queue for Marco`.
- Ignore `apps/mobile` entirely.

## Evidence rules (from the previous loop's post-mortem)

- **Every finding has a code anchor: `path:line`.** Findings from screenshot inspection alone must be traced to a component before reporting. If you can't find the code, don't report it.
- **Both themes.** Cite the light AND dark screenshot path for any visual finding. Dark theme = `document.documentElement.classList.add('dark')`.
- Read the actual token layer (`apps/desktop/src/index.css`, `apps/desktop/src/themes.css`) before calling anything "hardcoded". `themes.css` defines six accent themes; only `warm` (default) is in scope.
- Use `grep` counts for systemic issues (e.g. "17 sites use `text-muted-foreground/60` opacity hacks") and list at most 5 representative anchors; don't pad the file.

## Screenshots

Baselines live in `docs/audit-findings/screenshots/loop1-before/` — read its `INDEX.md` first for what exists and the exact reproduction recipe. Take additional shots ONLY if you need a state not captured (hover, focus ring, a popover, an empty state). Recipe: Vite dev server is already running at `http://localhost:5173/`; inject `tools/mock-tauri.js` with `page.context().addInitScript({ path })`, navigate to `http://localhost:5173/?page=<today|tasks|inbox|goals|session|docs|settings>`, viewport 1280×800. Save any new shot next to the baselines as `<surface>-<state>-<light|dark>.png`. The Playwright browser is shared — keep your session short, and never close the browser.

## Output file

`docs/audit-findings/<surface>/2026-09-22-loop1.md` (create the folder). Structure exactly:

```
# <Surface> — Loop 1 audit (2026-09-22)

Files audited: ...
Screenshots: ...

## Scorecard
| Dimension | Score | Evidence |
| UI / visual | n/5 | one line |
| Interaction | n/5 | ... |
| UX | n/5 | ... |
| Accessibility | n/5 | ... |
Average: n.n

## Findings (P1 first, then P2, then P3; cap 25, prefer fewer and sharper)

### P1-1 <title>
- Anchor: `path:line`
- Rubric: §x.y (+ craft principle for P3)
- Screens: light `...png`, dark `...png`
- What's wrong: 1–3 sentences
- Fix: one line. Prefix `QUEUED FOR MARCO` or `NEEDS RUST` where applicable. Mark `CROSS-SURFACE` if the same defect exists on other surfaces (name them).

## Cross-surface notes
Anything you saw that belongs to the shell or another surface — one line each, no severity.
```

Return to the orchestrator: the four scores, the count of P1/P2/P3, and the three findings you'd fix first. Nothing else.
