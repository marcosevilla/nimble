# Settings + setup — Loop 1 re-score (2026-09-23)

Baseline: `2026-09-22-loop1.md` · Screenshots: `loop1-rescore/settings-light.png`, `loop1-rescore/settings-dark.png` (top of page only) vs `loop1-before/settings-{light,dark,light-full}.png`, `loop1-before/setup-{light,dark}.png`. Code: main at `988d048`.

No new screenshots were taken (no browser, per dispatch). Everything below the fold on Settings, the SetupDialog, hover/focus states and error states are judged from code. The right rail is **not** a factor on this surface: `lib/rightRail.ts:8` hides the tabbed rail on `settings`. Files read: `components/pages/SettingsPage.tsx` (1,851 lines), `components/settings/*.tsx`, `components/setup/SetupDialog.tsx`, `lib/{settingsSections,settingsMessage,setupGate,rightRail,labelColors}.ts`, `components/shared/{PageFrame,PageHeader,IconButton,SyncHealthBanner,typography}.tsx`, `components/ui/{button,input,label}.tsx`, `components/layout/Dashboard.tsx:280-345`, `index.css`, `themes.css` (warm).

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 2/5 | 3/5 | Sentence case throughout, status dots on `bg-success`/`bg-warning` (`SettingsPage.tsx:1116`), font selects show "Geist", baseline off-grid spacing 39 → 19 sites with none left in the page file. Still: 13 hex swatch literals in three palettes, a 28px Save beside a 32px input on every field row, two section-header systems, inverted radii on form boxes, 14 three-dot ellipses. |
| Interaction | 2/5 | 3/5 | All five baseline interaction breaks fixed: `--hover` fills, Show/Hide tabbable, focused trash visible, sticky header holds, confirms added for Disconnect and demo restart. Still: label/route delete is a modal with no undo (Rust-deferred), 8 raw-error toasts left in child sections, four identical "Sync now" buttons driving three different syncs. |
| UX | 2/5 | 3/5 | One registry drives nav + order + scroll-spy with `aria-current`. Vault merged into Obsidian. Ops verbs under a collapsed Maintenance section, stub deleted, height 5,559 → 4,663px. Still: 14 sections in one scroll (sub-pages deferred), setup still gates on the dead iCal field (Rust-deferred), accent swatches for 3 of 6 themes look identical, and the layout crushes the content column at the 800px minimum window. |
| Accessibility | 3/5 | 4/5 | Accent picker is a real `radiogroup` with arrow keys and roving tabindex (`:263-313`), every swatch and icon picker is named, nav has `aria-label` and `aria-current`, dark `--input` border is 3.12:1 and dark muted text is 6.39:1. Notes: 6 form inputs have no associated label, light input border is still about 1.27:1, 2 `/70` opacity hacks remain, and color radios announce hex codes. |

Average: 2.3 → 3.3

## Baseline findings status
| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | Title Case strings + `capitalize` | **Fixed** | Field labels `SettingsPage.tsx:80,87,97`; nav labels `lib/settingsSections.ts:24-38`; buttons `:1184,1210,1283,1689`; `THEME_LABELS` `:1351` replaces CSS capitalize (0 `capitalize` hits); `SetupDialog.tsx:32,39,45,51,136`. Remaining capitals are proper nouns ("Keep Nimble", "Google Calendar") or quoted third-party UI ("API Keys"). |
| P1-2 | Status colors on Tailwind palette | **Partly** | Status half fixed: `SettingsPage.tsx:1095,1116,1134,1191` use `bg-success`/`bg-warning`/`text-warning`/`border-warning`; `COLOR_OPTIONS` stub gone; 0 palette classes in settings. Still open: 13 hex literals `FEED_COLORS` `:317-324` + `ROUTE_COLORS` `:610-618` next to `LABEL_COLOR_OPTIONS` (`lib/labelColors.ts:52`), so there are still three unrelated category palettes (§3.4). |
| P1-3 | Secret reveal / focused trash invisible | **Fixed** | `SettingsPage.tsx:165-171` Show/Hide has no `tabIndex` and picks up the global `:focus-visible` ring (`index.css:133`); `IconButton.tsx:42` `focus-visible:opacity-100` beats the `opacity-0` reveal at `LabelManager.tsx:241`. |
| P1-4 | Setup blocks on unread iCal field | **Deferred** (NEEDS RUST) | `SetupDialog.tsx:38-42` field still present; `:69` `isSetupReady` requires all four keys (`lib/setupGate.ts:6-11`, pinned to `REQUIRED_SETTINGS` in `nimble-core/src/db/settings.rs`). Queued in NEXT.md "Small Rust batch". |
| P2-1 | Flat IA, nav ≠ page, no active state | **Partly** (structural half Deferred) | `lib/settingsSections.ts:24-39` single array → nav `SettingsPage.tsx:1817` + render `:1842`; scroll-spy `:1312-1346` sets `aria-current` `:1823`; Maintenance collapsed `:1755-1806`; Status Colors stub deleted. Sub-pages (14 sections → 4–5 pages) queued for loop 2. |
| P2-2 | Vault / Obsidian split, "above" copy | **Fixed** | `SettingsPage.tsx:1610-1628`: path field, then `<VaultSection />` in one section at position 3. "Set your vault path above" (`VaultSection.tsx:40`) is now true. |
| P2-3 | Header stops sticking; nav offset guess | **Fixed** (see N-P3-1) | `Dashboard.tsx:306` scroller is `flex flex-col`; nav `SettingsPage.tsx:1814` and `scroll-mt` `:1293,1841` read `--page-header-h`. The variable itself is now stale after the page-title recipe (N-P3-1). |
| P2-4 | Control heights / radii / hand-rolled segments | **Partly** | Fixed: `button.tsx:28` `sm` → `text-meta-strong`. Open: field Save still `size="sm"` (h-7, radius `min(radius-md,12px)` = 8px) beside `Input` h-8 / `rounded-lg` 10px (`SettingsPage.tsx:174-181`, `input.tsx:12`); Mode and route-type segments still hand-rolled (`:1486-1503`, `:842-854`, 0 `ToggleGroup` imports). |
| P2-5 | Two section systems | **Partly** | Fixed: one title size (`SectionTitle size="lg"` everywhere, `SettingsPage.tsx:200`, `BackupSection.tsx:95`); `ui/label.tsx:12` no longer bakes `font-medium`. Open: standalone sections are still `h3` + `Meta` 12px + `border-t pt-6` (`BackupSection.tsx:93-96`, `ReminderSection.tsx:29-31`, `GoogleCalendarSection.tsx:43-45`), now codified as `standalone: true` (`settingsSections.ts:33-35`) vs `h2` + `text-body` + `<Separator/>`. Three field-label styles remain (`Label text-body-strong` `:151`, bare `label text-body` `ReminderSection.tsx:40`, `text-label text-muted-foreground` `:1521`). Values are still mono at `:1134,1140,1675`. |
| P2-6 | Spacing off the 8px grid | **Partly** (residual Deferred) | Baseline set (`p-3`/`space-y-3`/`gap-3`/`space-y-5`/`pt-6`/`p-6`) 39 → 19, and 0 of them remain in `SettingsPage.tsx`. The 19 remaining sites are in the children (e.g. `BackupSection.tsx:93,103`, `TodoistMigrationSection.tsx:72,94`, `VaultSection.tsx:49-50`) and match NEXT.md's deferred minor "17 off-grid spacing sites in settings children". |
| P2-7 | Accent swatches not from tokens | **Fixed** (see N-P2-2) | `SettingsPage.tsx:229-261` reads each theme's `--background/--primary/--border` from a probe; `radiogroup` + `aria-checked` + arrow keys `:263-313`; selected = ring, no scale `:297-299`. |
| P2-8 | Font selects show "geist" | **Fixed** | `SettingsPage.tsx:131-133` `fontLabel`, used at `:1529,1554`; rescore screenshots read "Geist". |
| P2-9 | Invisible hover (`accent/20`) | **Fixed** | Nav `SettingsPage.tsx:1826`, label rows `LabelManager.tsx:195`, dropdown trigger `:861`, `IconButton.tsx:42` all `hover:bg-hover` (`themes.css:30,85`, 1.18:1). |
| P2-10 | Dark input border + small muted text contrast | **Partly** | Fixed: dark `--input` 35% = 3.12:1 (`themes.css:90`); dark `--muted-foreground` 0.66 = 6.39:1 (`themes.css:83`). Open: light `--input` unchanged at `oklch(0.915…)` (`themes.css:35`, about 1.27:1 as a border); `text-muted-foreground/70` still at `DocsMigrationSection.tsx:97`, `TasksMigrationSection.tsx:102`. |
| P2-11 | Destructive: modals vs none, no undo | **Partly** (undo Deferred) | Fixed: Disconnect confirm `GoogleCalendarSection.tsx:53-66`; demo switch asks first `SettingsPage.tsx:565-594`. Undo for label/route delete needs soft-delete (NEEDS RUST, queued). Label delete stays a modal until then (`LabelManager.tsx:237-265`). |
| P2-12 | Label manager: C4 grouping + invisible rename | **Partly** (grouping Deferred to C4) | Fixed: rename input named, focusable, hover underline (`LabelManager.tsx:223-235`). Grouping by ENERGY/TIME/TYPE/CREATIVE is owned by C4. |
| P2-13 | Type scale drift (doc vs CSS) | **Fixed** | `docs/typography-system.md` now carries the live 8-token table; `grep text-heading|text-caption|display-xl` = 0. |
| P2-14 | Setup: dead close X | **Fixed** | `SetupDialog.tsx:96` `showCloseButton={false}`. Escape is a deliberate no-op while setup is blocking (`:91-93` comment). |
| P2-15 | Unlabeled icon-only pickers | **Partly** | Fixed: feed/route/icon radiogroups named (`SettingsPage.tsx:482-489,884-891,905-914`), accent `aria-label` `:293`, nav `aria-label` `:1813`. Open: names are hex codes and component names ("Color #6366f1", "CheckSquare"); LabelManager add-form swatches have no `role="radio"`/`aria-checked` (`LabelManager.tsx:131-145`). |
| P2-16 | Raw Rust errors surfaced | **Partly** | Fixed in the page + LabelManager: `lib/settingsMessage.ts`, `FailureNote` `SettingsPage.tsx:109-124`, `toastFailure` `:126-129`. Still raw: `VaultSection.tsx:30`, `TodoistSyncSection.tsx:40` (+ `last_error` shown verbatim `:93`), three migrations `DocsMigrationSection.tsx:37,52` / `TasksMigrationSection.tsx:43,57` / `TodoistMigrationSection.tsx:38,65`, and the new shell banner `SyncHealthBanner.tsx:59`. |
| P3-1 | `transition-all` + selection scale | **Partly** | `transition-all` count 0 in settings. `scale-110` is still the selected state at `SettingsPage.tsx:492,894` and `LabelManager.tsx:140,215`. Accent picker fixed. |
| P3-2 | "..." vs "…" | **Open** | 11 busy labels still use three periods: `SettingsPage.tsx:180,504,546,930,1176,1184,1210,1688,1726`, `LabelManager.tsx:150`, `SetupDialog.tsx:136`. `…` is used at `:1278,1282` and `VaultSection.tsx:53`. |
| P3-3 | Inner radius > outer radius | **Open** | Form boxes `rounded-md border p-4` (8px) wrap `rounded-lg` (10px) inputs: `SettingsPage.tsx:460,820,1148`, `LabelManager.tsx:119`. Rows `:407,754` are also `rounded-md`. |

Tally: 9 Fixed · 11 Partly (4 of them, P2-1/P2-6/P2-11/P2-12, only because the remaining half is Deferred) · 2 Open · 1 Deferred.

## New findings

### N-P1-1 Template-literal class name on the calendar color picker
- Anchor: `SettingsPage.tsx:490-494` (`` className={`h-6 w-6 rounded-full border-2 … ${newColor === color ? 'border-foreground scale-110' : …}`} ``)
- Rubric: §3.3 ("Template literals for class names — use `cn()`")
- Screens: n/a (form only renders after "+ Add calendar"; judged from code)
- What's wrong: this is the only template-literal `className` on the surface, while the route picker 400 lines later already uses `cn()` for the same recipe (`:892-895`). It was present at baseline and missed. It is still a §3 anti-pattern, so it scores P1 even though the fix is one line.
- Fix: `cn('size-6 rounded-full border-2 …', newColor === color ? 'border-foreground ring-2 …' : 'border-transparent hover:border-muted-foreground/50')`. Fold it into P1-2's shared swatch component.

### N-P2-1 Four identical "Sync now" buttons drive three different syncs, plus a banner on top
- Anchor: `SyncHealthBanner.tsx:79-82` (Todoist, shell banner shown above Settings), `TodoistSyncSection.tsx:83-90` (Todoist), `SettingsPage.tsx:1204-1211` (Turso device sync), `GoogleCalendarSection.tsx:52` (Google phone alerts). In error state, the banner offers "Open settings" (`:74-77`) even when the user is already on Settings.
- Rubric: §1.2 (batch information; don't make the user choose where to look), §1.4 (earned attention: persistent chrome shouldn't compete)
- Screens: light `loop1-rescore/settings-light.png`, dark `loop1-rescore/settings-dark.png` (banner "Sync now" at top right, 40px strip above the page title)
- What's wrong: the Settings page now has one Todoist "Sync now" pinned above the title and a second one 1,000px down. Two more identically labelled buttons do unrelated things (Turso, Google). The user has to read the surrounding section to learn which system a "Sync now" touches.
- Fix: name the object ("Sync Todoist", "Sync devices", "Sync phone alerts"). On the Settings page, hide the banner's action, or make it scroll to `#todoist-sync` with the label "Show Todoist sync". CROSS-SURFACE: the banner is shell-level.

### N-P2-2 Three of six accent swatches are visually identical
- Anchor: `SettingsPage.tsx:295-307` (swatch = theme `--background` fill + `--primary` dot); the only visible name is the selected theme's caption (`:1510-1512`), with no `title`/tooltip for the others
- Rubric: §1.2 (reduce decision overhead)
- Screens: light `loop1-rescore/settings-light.png` (swatches 1, 4, 6 = near-black dot on near-white), dark `loop1-rescore/settings-dark.png` (1, 4, 6 = near-white dot on near-black)
- What's wrong: the P2-7 fix made the swatches honest. Warm, Mono and Runner really are near-neutral, so they now render as three copies of one chip. A sighted user can't tell them apart without clicking each one and reading the caption.
- Fix: put each theme's name under its swatch (`text-label text-muted-foreground`), or add a second token to the chip (e.g. `--secondary` half-fill) so the warm/mono/runner differences show. Keep the token-read approach.

### N-P2-3 Six form inputs have no programmatic label
- Anchor: `SettingsPage.tsx:462/470` (calendar Label, iCal URL), `:823/831` (route Prefix, Label), `:1150/1161` (Turso URL, Auth token). Each is `<Label>` with no `htmlFor`, and the `Input` below it has no `id`. `:859` (Linked doc) sits over a dropdown trigger the same way.
- Rubric: §1.5 (keyboard-first / assistive tech), accessibility dimension
- Screens: n/a (below the fold; judged from code)
- What's wrong: screen readers announce these fields by placeholder ("eyJ…", "/i"), and clicking the label does not focus the field. The baseline credited "htmlFor on every settings field", which was true only for `SettingFieldRow` (`:151-157`), so this gap predates loop 1.
- Fix: add `htmlFor`/`id` pairs (or `FieldLabel` from `typography.tsx:93` with an id). The Turso token field should reuse `SettingFieldRow` so it also gets Show/Hide.

### N-P2-4 At the 800px minimum window, chrome takes about 60% of the width and content is about 320px
- Anchor: `SettingsPage.tsx:1814` (section nav `hidden w-40 … md:block`, a viewport breakpoint), `stores/layoutStore.ts:7` (`NAV_DEFAULT_WIDTH = 240`, drag range up to 360, from Agentation pass 2), `src-tauri/tauri.conf.json:21` (`minWidth: 800`), `PageFrame.tsx:27` (`px-6`)
- Rubric: §3.5 ("chrome shouldn't compete with primary content"), §1.4 (earned attention)
- Screens: n/a (both rescore shots are 1280 wide; computed from code)
- What's wrong: at 800px with the default nav, the main pane is 560px. Subtract 48px of gutter and the 192px section rail, and the settings column is about 320px, so the two font selects sit at about 144px each. With the nav dragged to 360, the column is about 200px. Before the labelled nav (icons, 48px) this was about 510px. The rail's `md:` breakpoint reads the viewport, not the pane.
- Fix: hide the section rail with a container query on the page column (`@container` + `@3xl:block`) instead of `md:`, and let the scroll-spy nav collapse into a `Select` "Jump to section" above the content at narrow widths.

### N-P3-1 `--page-header-h` is 41px, but the header is now 56px with no border
- Anchor: `index.css:137-143` (`--page-header-h: 41px`, comment "40px min-height + 1px border") vs `PageHeader.tsx:13-14,52-60` (`pt-6` + `min-h-8` = 56px, no bottom border since the page-title recipe `7f6abd5`); consumers `SettingsPage.tsx:1293,1324,1814,1841`
- Rubric: §3.5 (spacing rhythm); craft: make-interfaces-feel-better "Optical alignment / consistent spacing" (a sticky element's offset should be derived from, not guessed at, the element above it)
- Screens: light `loop1-rescore/settings-light.png` (header band has no rule), dark `loop1-rescore/settings-dark.png`; stuck state not captured
- What's wrong: when stuck, the section rail sits at 65px under a 56px header, which leaves a 9px gap instead of the intended 24px. Anchor jumps also land 9px under the header, not 24px. With no border and an 80%-opaque band, scrolled content slides under the title with no edge. NEXT.md's deferred "1.5rem repeated in Settings calc offsets" is the same seam.
- Fix: set `--page-header-h: 56px` (or measure it with a ResizeObserver on `PageHeader`), fold the `+1.5rem` into one `--page-sticky-top`, and give the stuck header `border-b border-border/50` only when scrolled.

## Remaining P1 count: 3 (baseline carry-over 2 + new 1)
- Carry-over: P1-2 (hex category palettes, Partly) and P1-4 (setup iCal gate, Deferred / NEEDS RUST).
- New: N-P1-1 (template-literal class, one-line fix, pre-existing).
- P2 remaining: 13 (9 carry-over Partly, of which P2-1, P2-6, P2-11 and P2-12 are open only for their Deferred half, plus 4 new). P3 remaining: 4 (3 carry-over + 1 new).

## Cross-surface notes
- `SyncHealthBanner.tsx:59` toasts the raw error (`Todoist sync failed: ${e}`). Route it through `settingsMessage` like the page does.
- `docs/typography-system.md` lists `text-title` for "Page titles", but `PageHeader.tsx:16` now uses `text-display` (20px) after the page-title recipe. Update the Primary-use column.
- `--page-header-h` (N-P3-1) is shell-owned. Any other sticky element reading it is off by 15px too.
- Container-vs-viewport breakpoints (N-P2-4) are likely on other pages now that the left nav is 240–360px wide. Grep `md:` on page columns.
