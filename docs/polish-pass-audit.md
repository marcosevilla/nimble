# Polish Pass Audit

## 1. Animation durations

### Fast (hover, ~150ms)
- apps/desktop/src/components/pages/InboxPage.tsx:312 — `transition-all duration-150 hover:bg-accent/30`
- apps/desktop/src/components/pages/InboxPage.tsx:398 — `transition-all duration-150 hover:bg-accent/30`
- apps/desktop/src/components/layout/NavSidebar.tsx:63 — `transition-all duration-150 cursor-pointer`
- apps/desktop/src/components/layout/NavSidebar.tsx:127 — `transition-all duration-150 cursor-pointer touch-none`
- apps/desktop/src/components/tasks/TaskItem.tsx:98 — `transition-all duration-150 hover:bg-accent/30`
- apps/desktop/src/components/shared/DateStrip.tsx:82 — `transition-all duration-150` (date pill selection)
- apps/desktop/src/components/goals/HabitsSection.tsx:119 — `transition-all duration-200 cursor-pointer select-none`
- apps/desktop/src/components/tasks/LocalTaskRow.tsx:73 — `transition-transform duration-150`
- apps/desktop/src/components/shared/BriefDisplay.tsx:61 — `transition-transform duration-150`
- apps/desktop/src/components/shared/CollapsibleSection.tsx:40 — `transition-transform duration-150`
- apps/desktop/src/components/shared/CollapsibleSection.tsx:59 — `transition-all duration-150 data-[ending-style]:opacity-0`
- apps/desktop/src/components/shared/HelpPanel.tsx:180 — `transition-all duration-200`
- apps/desktop/src/components/shared/HelpPanel.tsx:194 — `transition-all duration-150`

### Base (state change, ~200-250ms)
- apps/desktop/src/index.css:92 — `animation: help-panel-in 250ms cubic-bezier(0.16, 1, 0.3, 1) forwards`
- apps/desktop/src/index.css:107 — `animation: bulk-bar-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards`
- apps/desktop/src/index.css:213 — `animation: page-enter 200ms ease-out`
- apps/desktop/src/index.css:240 — `animation: command-backdrop-in 250ms ease-out forwards`
- apps/desktop/src/index.css:266 — `animation: command-backdrop-out 200ms ease-in forwards`
- apps/desktop/src/components/pages/TodayPage.tsx:105 — `animate-in fade-in slide-in-from-bottom-2 duration-200`
- apps/desktop/src/components/pages/InboxPage.tsx:496 — `animate-in fade-in duration-200` (backdrop)
- apps/desktop/src/components/pages/InboxPage.tsx:497 — `animate-in fade-in slide-in-from-bottom-3 duration-200` (popup)
- apps/desktop/src/components/focus/FocusCelebration.tsx:58 — `animate-in fade-in duration-200` (backdrop)
- apps/desktop/src/components/focus/FocusBanner.tsx:31 — `animate-in slide-in-from-top duration-200`
- apps/desktop/src/components/tasks/TaskEditor.tsx:84 — `animate-in fade-in slide-in-from-top-1 duration-150`
- apps/desktop/src/components/shared/CommandBarResults.tsx:72 — `animate-in fade-in slide-in-from-top-1 duration-150`
- apps/desktop/src/components/shared/CommandBarResults.tsx:137 — `animate-in fade-in slide-in-from-top-1 duration-150`
- apps/desktop/src/components/shared/BriefDisplay.tsx:69 — `animate-in fade-in slide-in-from-top-1 duration-150`
- apps/desktop/src/components/shared/BriefDisplay.tsx:291 — `animate-in fade-in duration-150`

### Slow (page transitions, ~300-400ms)
- apps/desktop/src/index.css:233 — `animation: progress-enter 300ms ease-out`
- apps/desktop/src/index.css:248 — `animation: command-flyout 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards`
- apps/desktop/src/index.css:327 — `animation: count-pulse 300ms ease-out`
- apps/desktop/src/components/pages/TodayPage.tsx:103 — `transition-all duration-300`
- apps/desktop/src/components/pages/GoalsPage.tsx:116 — `transition-all duration-500` (progress fill)
- apps/desktop/src/components/layout/RightSidebar.tsx:69 — `transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]`
- apps/desktop/src/components/focus/FocusView.tsx:87 — `animate-in fade-in duration-300`
- apps/desktop/src/components/focus/FocusView.tsx:108 — `animate-in fade-in duration-300`
- apps/desktop/src/components/focus/FocusView.tsx:151 — `animate-in fade-in duration-300`
- apps/desktop/src/components/detail/TaskDetailPage.tsx:229 — `animate-in fade-in duration-300`
- apps/desktop/src/components/goals/GoalTimeline.tsx:201 — `transition-all duration-300` (progress bar)

### Very slow (animations, 600ms+)
- apps/desktop/src/index.css:224 — `animation: task-complete-exit 600ms ease-out forwards`
- apps/desktop/src/index.css:305 — `animation: checkmark-draw 600ms cubic-bezier(0.22, 1, 0.36, 1) forwards`
- apps/desktop/src/index.css:313 — `animation: timer-glow 1.5s ease-in-out`
- apps/desktop/src/components/pages/TodayPage.tsx:38 — `transition-all duration-500` (progress fill)
- apps/desktop/src/components/pages/GoalsPage.tsx:79 — `transition-all duration-150 hover:ring-foreground/20` (goal item hover)
- apps/desktop/src/components/focus/FocusCelebration.tsx:96 — `animate-in fade-in duration-500`
- apps/desktop/src/components/focus/FocusCelebration.tsx:102 — `animate-in fade-in slide-in-from-bottom-2 duration-500`
- apps/desktop/src/components/focus/FocusCelebration.tsx:109 — `animate-in fade-in duration-700`
- apps/desktop/src/components/focus/FocusCelebration.tsx:72 — inline: `animation: confetti-burst 800ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}s forwards`
- apps/desktop/src/components/goals/HabitsSection.tsx:171 — `transition-all duration-500` (progress fill)
- apps/desktop/src/components/focus/FocusView.tsx:42 — `transition-[stroke-dashoffset] duration-1000 ease-linear` (timer circle)
- apps/desktop/src/index.css:115-117 — ai-star animations: `1.2s ease-in-out infinite`

### Outliers (unusual values)
- apps/desktop/src/components/ui/dialog.tsx:34 — `duration-100` (backdrop)
- apps/desktop/src/components/ui/dialog.tsx:56 — `duration-100` (dialog content)
- apps/desktop/src/components/ui/dropdown-menu.tsx:136 — `duration-100` (dropdown)

**Recommendation:** Introduce three CSS custom properties in `src/index.css`:
```css
@theme inline {
  --transition-fast: 150ms;      /* hover states, icon rotations */
  --transition-base: 200ms;      /* modal entrance, state changes */
  --transition-slow: 300ms;      /* page transitions, sidebar width */
}
```
Then replace hardcoded durations with `duration-[var(--transition-fast)]` etc. The `duration-100` values should bump to `duration-[var(--transition-fast)]` for consistency.

---

## 2. Contrast issues on tiny text

### text-[10px] + low opacity combos (PRIORITY BUMPS NEEDED)
- apps/desktop/src/components/tasks/SortableTaskList.tsx:72 — `text-muted-foreground/20 hover:text-muted-foreground/60` — drag handle icon (OK with hover, but /20 is unreadable at rest)
- apps/desktop/src/components/tasks/ProjectSidebar.tsx:241 — `text-muted-foreground/30 hover:text-muted-foreground` — delete icon (icon button, acceptable)
- apps/desktop/src/components/tasks/ProjectSidebar.tsx:303 — `text-xs text-muted-foreground/30 hover:text-muted-foreground` — add project button text
- apps/desktop/src/components/layout/RightSidebar.tsx:101 — `text-muted-foreground/30 hover:text-muted-foreground` — close button (icon button, acceptable)
- apps/desktop/src/components/shared/DateStrip.tsx:60 — `text-muted-foreground/30 hover:text-muted-foreground` — scroll chevron (icon button, acceptable)
- apps/desktop/src/components/shared/DateStrip.tsx:103 — `text-muted-foreground/30 hover:text-muted-foreground` — scroll chevron (icon button, acceptable)
- apps/desktop/src/components/shared/CommandBarResults.tsx:102 — `text-muted-foreground/30 hover:text-destructive` — destructive icon (small, icon-only, acceptable)
- apps/desktop/src/components/shared/BriefDisplay.tsx:144 — `text-muted-foreground/30` (text-xs icon, acceptable)
- apps/desktop/src/components/shared/BriefDisplay.tsx:163 — `text-muted-foreground/30` (text-xs icon, acceptable)
- apps/desktop/src/components/shared/BriefDisplay.tsx:178 — `text-muted-foreground/30 mt-1 text-xs` — bullet separator (decorative, acceptable)

### text-xs + /40-/50 (borderline low)
- apps/desktop/src/components/pages/TodayPage.tsx:400 — `text-xs text-muted-foreground/40 text-center` — placeholder text
- apps/desktop/src/components/calendar/CalendarPanel.tsx:289 — `text-[10px] tabular-nums text-muted-foreground/40` — time labels
- apps/desktop/src/components/activity/ActivityTimeline.tsx:204 — `text-[10px] text-muted-foreground/40 hover:text-muted-foreground` — link (low but hover-recoverable)
- apps/desktop/src/components/focus/FocusView.tsx:188 — `text-xs text-muted-foreground/50 hover:text-muted-foreground` — secondary button text (hover-recoverable)
- apps/desktop/src/components/focus/FocusView.tsx:195 — `text-xs text-muted-foreground/50 hover:text-muted-foreground` — secondary button text (hover-recoverable)
- apps/desktop/src/components/shared/CommandBarResults.tsx:143 — `text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60` — section heading (medium weight helps)
- apps/desktop/src/components/shared/CommandBarResults.tsx:168 — `text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60` — section heading (medium weight helps)
- apps/desktop/src/components/shared/HelpPanel.tsx:212 — `text-[10px] text-muted-foreground/50 tabular-nums` — stat counters (readable with tabular-nums alignment)

**Recommendation:** For text-xs/text-[10px] + decorative or icon-only elements, /30 is acceptable. For actionable text at that size, bump to /50–/60. Flag all /40 instances and evaluate context.

---

## 3. Hover-bg patterns

### Primary pattern: accent/20 (icon buttons, menu items)
- apps/desktop/src/components/detail/InlineDescription.tsx:63 — `hover:bg-accent/10` — inline title edit area (slightly lower than pattern)
- apps/desktop/src/components/pages/DocsPage.tsx:24 — `hover:bg-accent/20` — close button
- apps/desktop/src/components/detail/CaptureDetailPage.tsx:99 — `hover:bg-accent/20` — close button
- apps/desktop/src/components/detail/CaptureDetailPage.tsx:106 — `hover:bg-accent/20` — close button
- apps/desktop/src/components/focus/FocusPlayMenu.tsx:69 — `hover:bg-accent/20` — menu item
- apps/desktop/src/components/tasks/ProjectSidebar.tsx:114 — `hover:bg-accent/20` — settings button
- apps/desktop/src/components/tasks/ProjectSidebar.tsx:121 — `hover:bg-accent/20` — more button
- apps/desktop/src/components/detail/TaskActionBar.tsx:147 — `hover:bg-accent/20` — action button
- apps/desktop/src/components/layout/RightSidebar.tsx:77 — `hover:bg-accent/20` — close button
- apps/desktop/src/components/layout/RightSidebar.tsx:101 — `hover:bg-accent/20` — expand button
- apps/desktop/src/components/calendar/CalendarPanel.tsx:74 — `hover:bg-accent/30` — nav arrow (higher variant)
- apps/desktop/src/components/calendar/CalendarPanel.tsx:98 — `hover:bg-accent/30` — nav arrow (higher variant)
- apps/desktop/src/components/detail/TaskDetailPage.tsx:133 — `hover:bg-accent/20` — edit button
- apps/desktop/src/components/detail/TaskDetailPage.tsx:139 — `hover:bg-accent/20` — more button
- apps/desktop/src/components/tasks/StatusDropdown.tsx:84 — `hover:bg-accent/20` — status button
- apps/desktop/src/components/tasks/StatusDropdown.tsx:110 — `hover:bg-accent/20` — reason button
- apps/desktop/src/components/goals/GoalTimeline.tsx:104 — `hover:bg-accent/10` — goal item (lower variant)
- apps/desktop/src/components/shared/ProjectPickerMenu.tsx:21 — `hover:bg-accent/20` — project item
- apps/desktop/src/components/detail/DetailSidebar.tsx:76 — `hover:bg-accent/20` — button
- apps/desktop/src/components/detail/DetailSidebar.tsx:83 — `hover:bg-accent/20` — button
- apps/desktop/src/components/shared/BulkActionBar.tsx:167 — `hover:bg-accent/20` — close button
- apps/desktop/src/components/shared/BulkActionBar.tsx:192 — `hover:bg-accent/20` — action item
- apps/desktop/src/components/layout/NavSidebar.tsx:67 — `hover:bg-accent/20` — nav item
- apps/desktop/src/components/layout/NavSidebar.tsx:131 — `hover:bg-accent/20` — nav item
- apps/desktop/src/components/pages/GoalsPage.tsx:471 — `hover:bg-accent/20 hover:text-foreground` — icon button
- apps/desktop/src/components/pages/GoalsPage.tsx:497 — `hover:bg-accent/20` — status dropdown item
- apps/desktop/src/components/pages/GoalsPage.tsx:514 — `hover:bg-accent/20` — status dropdown item
- apps/desktop/src/components/pages/TasksPage.tsx:162 — `hover:bg-accent/20` — status filter button
- apps/desktop/src/components/pages/TasksPage.tsx:180 — `hover:bg-accent/20` — status filter button
- apps/desktop/src/components/pages/TasksPage.tsx:335 — `hover:bg-accent/20` — more button
- apps/desktop/src/components/pages/SettingsPage.tsx:615 — `hover:bg-accent/20` — button
- apps/desktop/src/components/pages/SettingsPage.tsx:622 — `hover:bg-accent/20` — delete button
- apps/desktop/src/components/pages/SettingsPage.tsx:682 — `hover:bg-accent/10` — dropdown (lower variant)
- apps/desktop/src/components/shared/CollapsibleSection.tsx:35 — `hover:bg-accent/20` — toggle row
- apps/desktop/src/components/shared/HelpPanel.tsx:181 — `hover:bg-muted` (non-accent, for muted button)
- apps/desktop/src/components/tasks/ProjectDetailPage.tsx:134 — `hover:bg-accent/20` — status filter
- apps/desktop/src/components/tasks/ProjectDetailPage.tsx:152 — `hover:bg-accent/20` — status filter
- apps/desktop/src/components/docs/DocNoteEntry.tsx:16 — `hover:bg-accent/10` — row (lower variant)
- apps/desktop/src/components/docs/DocNoteEntry.tsx:23 — `hover:bg-accent/20` — delete icon
- apps/desktop/src/components/detail/InlineTitle.tsx:55 — `hover:bg-accent/10` — title (lower for primary text)
- apps/desktop/src/components/docs/FolderTree.tsx:142 — `hover:bg-accent/20` — button
- apps/desktop/src/components/docs/FolderTree.tsx:149 — `hover:bg-accent/20` — button
- apps/desktop/src/components/docs/FolderTree.tsx:162 — `hover:bg-accent/10` — folder row (lower variant)
- apps/desktop/src/components/docs/FolderTree.tsx:195 — `hover:bg-accent/10` — doc row (lower variant)
- apps/desktop/src/components/docs/FolderTree.tsx:228 — `hover:bg-accent/10` — doc row (lower variant)
- apps/desktop/src/components/docs/FolderTree.tsx:264 — `hover:bg-accent/10` — new doc input (lower variant)
- apps/desktop/src/components/pages/InboxPage.tsx:312 — `hover:bg-accent/30` — capture row (HIGHER variant)
- apps/desktop/src/components/pages/InboxPage.tsx:350 — `hover:bg-accent/20` — action button
- apps/desktop/src/components/pages/InboxPage.tsx:372 — `hover:bg-accent/20` — delete button
- apps/desktop/src/components/pages/InboxPage.tsx:398 — `hover:bg-accent/30` — capture row (HIGHER variant)
- apps/desktop/src/components/pages/InboxPage.tsx:440 — `hover:bg-accent/20` — action badge
- apps/desktop/src/components/pages/InboxPage.tsx:447 — `hover:bg-accent/20` — action badge
- apps/desktop/src/components/pages/InboxPage.tsx:507 — `hover:bg-accent/20` — folder selector
- apps/desktop/src/components/pages/InboxPage.tsx:515 — `hover:bg-accent/20` — folder selector
- apps/desktop/src/components/pages/InboxPage.tsx:533 — `hover:bg-accent/20` — doc picker item
- apps/desktop/src/components/shared/DateStrip.tsx:87 — `hover:bg-accent/20` — date pill (not selected, not today)
- apps/desktop/src/components/shared/CommandBarResults.tsx:112 — `hover:bg-accent/20` — option
- apps/desktop/src/components/shared/CommandBarResults.tsx:179 — `hover:bg-accent/20` — task item
- apps/desktop/src/components/shared/CommandBarResults.tsx:203 — `hover:bg-accent/20` — create item
- apps/desktop/src/components/shared/CommandBarResults.tsx:220 — `hover:bg-accent/20` — capture item
- apps/desktop/src/components/shared/CommandBarResults.tsx:261 — `hover:bg-accent/20` — general item
- apps/desktop/src/components/shared/CommandBarResults.tsx:290 — `hover:bg-accent/30` — menu button (HIGHER variant)
- apps/desktop/src/components/shared/CommandBarResults.tsx:339 — `hover:bg-accent/30` — action button (HIGHER variant)
- apps/desktop/src/components/tasks/TaskItem.tsx:98 — `hover:bg-accent/30` — task row (HIGHER variant)
- apps/desktop/src/components/docs/TiptapEditor.tsx:67 — `hover:bg-accent/20` — mention item

### Outliers (custom colors)
- apps/desktop/src/components/focus/FocusView.tsx:174 — `hover:bg-green-700` — complete button (custom green for semantic importance)
- apps/desktop/src/components/ui/button.tsx — various `hover:bg-*` for button variants (secondary, ghost, destructive)
- apps/desktop/src/components/ui/toggle.tsx — `hover:bg-muted` — toggle outline variant
- apps/desktop/src/components/ui/badge.tsx — `hover:bg-muted` / `hover:bg-secondary/80` / `hover:bg-destructive/20` — badge variants

**Recommendation:**
1. Standardize row/item hovers to `hover:bg-accent/30` (higher visual feedback, task-like affordance).
2. Keep icon-button hovers at `hover:bg-accent/20` (minimal feedback for utility buttons).
3. Keep /10 for content areas (InlineDescription, DocNoteEntry, FolderTree items) for subtle affordance.
4. Verify semantic buttons (complete, delete) keep custom colors or dedicated bg classes.

---

## 4. DateStrip

**File:** `/Users/marcosevilla/Developer/personal triage and briefing app/nimble/apps/desktop/src/components/shared/DateStrip.tsx`

**Scroll container structure:**
- Outer div: `flex items-center gap-1` (container with left/right scroll buttons)
- Scroll container: line 66-69
  ```jsx
  <div
    ref={scrollRef}
    className="flex-1 flex gap-1 overflow-x-hidden py-1"
  >
  ```
- Children (date pills): lines 75-97
  ```jsx
  <button
    data-selected={isSelected}
    onClick={() => onSelect(dateStr)}
    style={{ scrollSnapAlign: 'center' }}  // ← Already has snap align!
    className="flex flex-col items-center gap-1 rounded-lg px-3 py-2 min-w-[44px] ..."
  >
  ```

**Current scroll behavior:** 
- Buttons manually call `container.scrollBy({ left: dir * pillWidth, behavior: 'instant' })` (line 53)
- Already using `scrollSnapAlign: 'center'` on pill elements (line 80)
- useEffect scrolls selected date into view on mount (line 43)

**Recommendation:** Add `scroll-snap-type: x mandatory` to the scroll container div (line 68) to enable smooth CSS-based snapping. The infrastructure is 90% there; just need the container declaration to lock snapping behavior and prevent over-scrolling.

---

## 5. SettingsPage sections

**File:** `/Users/marcosevilla/Developer/personal triage and briefing app/nimble/apps/desktop/src/components/pages/SettingsPage.tsx`

### Sections (in order of appearance):

1. **Appearance** — line 1154–1220 (themes, accent color, typography)
2. **Integrations** — line 1223–1283 (Todoist, Anthropic API keys)
3. **Focus Mode** — line 1244–1283 (break duration, abandon status)
4. **Obsidian** — line 1285–1305 (vault path)
5. **Calendars** — line 207–383 (iCal feed management) [CALLABLE SECTION]
6. **Status Colors** — line 387–570 (task status emoji/color customization) [CALLABLE SECTION]
7. **Capture Routes** — line 572–676 (prefix routing for quick capture) [CALLABLE SECTION]
8. **Sync** — line 886–1130 (Turso configuration, test, push/pull, seed) [CALLABLE SECTION]
9. **About** — line 1306+ (build info, update check, license, etc.)

### SettingsPage main return (line 1035+):

```tsx
export function SettingsPage() {
  return (
    <div className="space-y-8 pb-8">
      {/* Inline sections from state hooks */}
      <CalendarsSection />      // line 270-383
      <ColorStatusSection />    // line 407-570
      <CaptureRoutesSection />  // line 577-676
      <SyncSection />           // line 884-1130
      
      {/* Main form sections */}
      <SectionHeader title="Appearance" />
      <SectionHeader title="Integrations" />
      <SectionHeader title="Focus Mode" />
      <SectionHeader title="Obsidian" />
      <SectionHeader title="About" />
    </div>
  )
}
```

**Current layout:**
- Single-column, full-width `<div className="space-y-8 pb-8">` (line ~1035)
- No max-width constraint visible in SettingsPage itself
- Parent Dashboard applies `contentMaxW = hideSidebar ? 'max-w-3xl' : 'max-w-2xl'` (Dashboard.tsx:206)
- Settings page is wrapped in that max-w constraint via Dashboard.tsx:240–242

**ID/anchor attributes:** None currently. All sections are bare divs with no `id=` attributes.

**Recommendation:**
1. Add `id` attributes to each section header for keyboard navigation / deep-linking:
   ```tsx
   <SectionHeader title="Appearance" /> → <h2 id="appearance" className="...">Appearance</h2>
   <SectionHeader title="Integrations" /> → <h2 id="integrations" className="...">Integrations</h2>
   // etc.
   ```
2. Layout is already responsive; no left rail needed. The space-y-8 column works well for 1–2 monitor setups.
3. Consider collapsible sections if Settings grows beyond 1400px of scroll depth (currently ~2000px on 1600-wide display).

---

## 6. Content max-w + sidebar

**File:** `/Users/marcosevilla/Developer/personal triage and briefing app/nimble/apps/desktop/src/components/layout/Dashboard.tsx`

### Main layout structure:

```tsx
// Line 206-246
const hideSidebar = currentPage === 'settings' || currentPage === 'session'
const contentMaxW = hideSidebar ? 'max-w-3xl' : 'max-w-2xl'

return (
  <div className="flex h-screen ...">
    {/* Left: NavSidebar */}
    <NavSidebar />
    
    {/* Center: Main content */}
    <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
      {/* Header, banner, etc. */}
      
      {/* Page content wrapper */}
      <div className="flex flex-1 overflow-y-auto">
        {/* FocusView */}
        {/* Detail view (body): <div className={cn('mx-auto w-full', contentMaxW)}> */}
        {/* Regular pages: <div className={cn('mx-auto w-full', contentMaxW)}> */}
      </div>
    </div>
    
    {/* Right: RightSidebar (hidden when hideSidebar = true) */}
    {!hideSidebar && <RightSidebar />}
  </div>
)
```

### Max-width behavior:
- **With sidebar (hideSidebar=false):** `max-w-2xl` (32rem, ~512px)
- **Without sidebar (hideSidebar=true):** `max-w-3xl` (48rem, ~768px)
- Applied via `contentMaxW` variable to all page content and detail views (lines 231, 240)

### Sidebar visibility:
- Hidden when: `currentPage === 'settings' || currentPage === 'session'`
- Controlled by boolean: `hideSidebar`
- Right sidebar toggle is in `/Users/marcosevilla/Developer/personal triage and briefing app/nimble/apps/desktop/src/components/layout/RightSidebar.tsx:77–105`

### RightSidebar structure:
- File: `/Users/marcosevilla/Developer/personal triage and briefing app/nimble/apps/desktop/src/components/layout/RightSidebar.tsx`
- Container: line 69 — `className="relative flex flex-col border-l border-border/20 bg-muted/10 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"`
- Toggleable width (via `sidebarCollapsed` state from layoutStore)
- Contains: Schedule, Habits sections + Detail view (when in sidebar mode)

**Recommendation:**
Current implementation is already perfect. The conditional max-w is correctly applied:
- `max-w-2xl` when right sidebar is visible (constrains width to ~512px content)
- `max-w-3xl` when sidebar is hidden (expands to ~768px on Settings/Activity pages for more breathing room)

The transition timing (300ms) aligns with the sidebar collapse animation. No changes needed; polish is already in place.

---

## Summary of Polish Passes

| Category | Status | Count | Priority |
|----------|--------|-------|----------|
| Animation timings | Audit done | 45+ instances | Medium — introduce CSS variables for consistency |
| Contrast (tiny text) | Low risk | ~10 instances | Low — mostly icon buttons and decorative text |
| Hover-bg patterns | Good standardization | ~70+ instances | Low — mostly /20 or /30, minor normalization suggested |
| DateStrip | Ready to polish | 1 component | Low — add `scroll-snap-type: x mandatory` only |
| SettingsPage sections | No IDs/anchors | 9 sections | Low — add `id=` attributes for a11y |
| Max-w + sidebar | Perfect | Already implemented | None — shipping ready |

