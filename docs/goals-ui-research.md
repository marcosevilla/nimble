# Goals System UI/UX Research

> Research compiled for the Nimble app (Tauri + React)
> Date: 2026-03-29
> Purpose: Inform the design of goal cards, timeline, habit tracking, progress visualization, life areas, and milestone markers for the Goals page (Phase C)

---

## Table of Contents

1. [Goal Cards View](#1-goal-cards-view)
2. [Timeline / Gantt View](#2-timeline--gantt-view)
3. [Habit Tracking with Streaks + Heatmap](#3-habit-tracking-with-streaks--heatmap)
4. [Goal Progress Visualization](#4-goal-progress-visualization)
5. [Life Areas / Categories](#5-life-areas--categories)
6. [Milestone Markers](#6-milestone-markers)

---

## 1. Goal Cards View

### Best Examples

#### Linear — Project Cards (Board Layout)

Linear's Projects page supports a board layout where each project is a card. Cards show:
- **Project name** (primary text, high contrast)
- **Progress bar** (thin horizontal bar showing % of completed issues)
- **Health indicator** (On track / At risk / Off track with color: green/yellow/red)
- **Lead avatar** (small, right-aligned)
- **Status badge** (Planned / In Progress / Completed / Paused — muted chip)
- **Target date** (muted text, only if set)

Cards can be grouped by project status, health, lead, or custom fields — displayed as swimlanes on the board. The information density is deliberately restrained: 5-6 data points per card maximum, with the progress bar doing most of the communication.

**What they do well:** Cards are scannable at a glance. Progress bar + health color gives you the "how's it going" answer in under a second. Grouping by health lets you triage troubled projects immediately. Hover reveals no extra info — clicking opens the full project detail panel. This restraint prevents information overload.

#### Notion — Database Gallery View

Notion's Gallery View renders database items as visual cards with:
- **Cover image or page icon** (top of card, optional)
- **Title** (primary text)
- **Visible properties** (configurable — typically 2-4 properties shown as small text rows)
- **Card sizes:** Small (3-4 per row), Medium (2-3 per row), Large (1-2 per row)

Cards are non-editable inline — clicking opens the full page. Property display is limited because text wrapping is unsupported within cards, so shorter values work best. The gallery excels at visual recognition (icons, covers) but struggles with dense metadata.

**What they do well:** The cover image / icon gives instant visual identity to each item. Configurable property visibility lets users choose their own density. The "peek" behavior (click to expand) keeps the gallery clean while full detail is always one click away.

#### Monday.com — Cards View

Monday.com's Cards View displays board items as gallery-style cards with:
- **Configurable columns** displayed on each card (gear icon to customize)
- **Inline editing** — click any column value on the card to edit without opening
- **Visual columns** (status, priority) rendered as colored chips
- **Hover behavior** — reveals an "Open" action to expand the full item

**What they do well:** Inline editing on cards is the differentiator. You don't have to open a detail panel to update a status — just click the chip directly. This reduces friction for quick updates. The column customization means the same board can look different for different contexts.

### Key Pattern

**The core UX insight:** Goal cards should answer "what's this goal and how's it going?" in a single glance. The critical information hierarchy is: (1) goal name, (2) progress indicator, (3) health/status signal. Everything else is secondary. Cards should be scannable in a grid — if you need more than 1-2 seconds per card, the density is too high.

**Information density sweet spot:** 4-6 data points per card. Linear proves this works: name, progress bar, health color, lead, status, target date. More than that and the grid becomes a wall of text.

**Interaction model:** Click-to-expand (not hover-reveal) is the consensus across Linear, Notion, and Monday.com. Hover is reserved for subtle highlights, not information reveals.

### Recommendation for This App

**Component: `GoalCard`**

```
+------------------------------------------+
|  [Icon]  Goal Name                       |
|  ==============================  72%     |
|  [Life Area chip]  [Due: Apr 15]         |
|  3/8 milestones  ·  12 tasks remaining   |
+------------------------------------------+
```

- **Card grid layout:** 2 columns on default width, 3 columns when sidebar is hidden. CSS Grid with `auto-fill, minmax(280px, 1fr)`.
- **Top line:** Goal icon (emoji or category icon) + goal name in 14px semi-bold.
- **Progress bar:** Full-width, thin (4px), with percentage label right-aligned. Warm color fill (amber/gold for in-progress, green for on-track, warm red for behind).
- **Metadata row:** Life area as a small colored chip (left), due date in muted text (right).
- **Bottom line:** Milestone count as fraction + remaining task count, both in 12px muted text.
- **Click behavior:** Opens full goal detail in the detail sidebar (same pattern as task detail).
- **Keyboard:** `J`/`K` navigates between cards. `Enter` opens detail. `E` quick-edits the goal.
- **Empty state:** "No goals yet. Press G to create your first goal." with a warm, encouraging illustration.

### ADHD-Friendly Adaptation

- **No "0%" shame:** If a goal has zero progress, show "Not started" in neutral text instead of an empty bar with "0%". Frame it as potential, not failure.
- **Progress celebrations:** When a card crosses 25%, 50%, 75%, or 100%, show a subtle pulse animation on the progress bar (once, not recurring).
- **"Best momentum" highlight:** Optionally highlight the goal with the most recent activity. This rewards engagement without punishing neglect of other goals.
- **Reduce decision paralysis:** Default sort by "most recently active" so the user naturally gravitates to goals with momentum. Don't force them to choose which goal to work on.
- **No "days since last activity" counter.** That's guilt-inducing for no benefit.

---

## 2. Timeline / Gantt View

### Best Examples

#### Linear — Project Timeline (Primary Reference)

Linear's timeline view is the gold standard for modern Gantt:
- **Horizontal scroll** with month/date headers along the top.
- **Today marker:** A vertical line (typically colored, often amber or blue) showing the current date. Always visible as you scroll.
- **Goal bars:** Horizontal bars spanning from start date to target date. Bar color indicates health (green/yellow/red). Bar width represents duration.
- **Milestones on bars:** Diamond markers placed at milestone dates within the project bar. Milestones near each other collapse into a grouped indicator (like map pins). Hovering a diamond shows milestone name + completion status. The active milestone has a yellow diamond.
- **Overlapping bars:** Stacked vertically — each project gets its own row. No true overlapping; the layout just extends vertically.
- **Interactions:** Drag bar edges to change start/target dates. Click bar to open project detail. Scroll horizontally to navigate time.
- **Zoom:** Timeline supports different scales, but Linear keeps it simple — typically month-level with day granularity.

**What they do well:** Simplicity. Linear's timeline is not a full Gantt chart — there are no dependency arrows, no resource lanes, no critical path highlighting. It's a visual roadmap: "these projects exist over these time periods." That restraint makes it readable at a glance. The milestone diamonds on bars are particularly effective — they show internal progress without needing separate rows.

#### Asana — Timeline View

Asana's timeline uses virtual scrolling to handle thousands of tasks efficiently:
- **Zoom levels:** Hour, Day, Week, Month, Quarter, Year — more granularity than most tools.
- **Zoom animation:** Smooth transitions between zoom levels with items animating to their new positions, helping users maintain spatial orientation.
- **Frozen left column:** Task list stays pinned on the left while the timeline scrolls horizontally on the right. This keeps task names always visible.
- **Dependency arrows:** Curved lines connecting dependent tasks. Can be drawn by dragging from one bar to another.
- **Unscheduled section:** Tasks without dates appear in a separate area, available for dragging onto the timeline.
- **Today marker:** Vertical line marking the current date.
- **Persistent view settings:** Zoom level and position are saved per user per project.

**What they do well:** The zoom animation is critical — it prevents the disorientation that happens when a timeline suddenly changes scale. The "unscheduled" section is smart: it acknowledges that not everything has a date yet without hiding those items. The frozen column is essential for wide timelines.

#### Notion — Timeline View

Notion's timeline is simpler but clean:
- **Zoom levels:** Hours to Years, selectable from a dropdown at the top-right.
- **"Today" button:** Centers the view on the current date with one click.
- **Arrow indicators:** When an item's bar extends beyond the visible area, a small arrow appears at the edge of its row, pointing in the direction of the bar. This solves the "where did my item go?" problem elegantly.
- **Drag interaction:** Drag bar edges to extend dates. Drag the bar body to move the entire date range. All changes automatically update the database property.
- **Table hybrid:** A table appears to the left of the timeline (optional), showing properties alongside the bars. Properties can also appear inside the bars themselves (but shorter values work better).

**What they do well:** The arrow indicators are brilliant and underused. When a goal bar is off-screen, you still see "something is here, to the right" — it prevents items from disappearing. The "Today" button as a persistent anchor is simple but essential.

#### ClickUp — Gantt View

ClickUp offers the most granular zoom:
- **Timescales:** Hour, Day, Week, Month, Quarter, Year — navigable via `Cmd + scroll` (pinch-to-zoom feeling).
- **Today line:** Vertical indicator repositioned to show the current date regardless of zoom level.
- **Zoom memory:** Remembers last used zoom level within each timescale.
- **Week header format:** Shows month, week range (Sep 15-21), week number (W38), and individual days (Mon 16) — information condenses automatically as you zoom out.
- **Critical path:** Highlights the chain of dependent tasks that determines the shortest possible project duration (unique feature).

**What they do well:** Adaptive header formatting — showing more detail when zoomed in and condensing when zoomed out — is a pattern worth borrowing. Zoom memory is a small thing that prevents frustration.

### Key Pattern

**The core UX insight:** A personal goal timeline is not a project management Gantt chart. It doesn't need dependency arrows, critical paths, or resource allocation. It needs to answer: "Where am I in the year? What's coming up? What's overdue?" Think of it as a visual calendar for goals, not a construction schedule.

**Critical elements:**
1. Today marker (always visible, anchors spatial orientation)
2. Goal bars with health-indicating color
3. Milestone diamonds within bars
4. Smooth zoom between month and quarter views
5. Frozen goal names on the left
6. A "Today" snap button

### Recommendation for This App

**Component: `GoalTimeline`**

```
        Jan          Feb          Mar          Apr
  ──────┼────────────┼────────────┼──── ▎ ─────┼──────
                                       │
  Learn Spanish  ═══════════════◆══════│══◆═══════►
  Ship Portfolio ════════◆══════════◆══│══
  Run 5K         ──────────────────════│══════◆═══►
                                       │
                                   TODAY
```

- **Layout:** Left panel (200px, frozen) with goal names + life area chip. Right panel (scrollable) with the timeline grid.
- **Time headers:** Two rows — top row shows months, bottom row shows week numbers or individual dates depending on zoom.
- **Zoom levels:** Two levels only (month overview and week detail). Toggle with `+`/`-` keys or `Cmd+scroll`. Animate between levels (scale + translate, 200ms ease-out).
- **Today marker:** Vertical dashed line in a warm amber color, with "Today" label at the top. Always rendered; timeline initially scrolls to center on today.
- **Goal bars:** 24px height, rounded-pill shape (border-radius: 12px). Fill color based on health: warm green (on-track), amber (needs attention), warm coral (behind). Opacity: 100% for active goals, 40% for completed goals.
- **Milestone diamonds:** 8px diamond shapes placed on the bar at milestone dates. Filled = complete, outlined = upcoming. Tooltip on hover shows milestone name. Nearby milestones collapse into a numbered badge (like "3" in a circle).
- **Interactions:** Drag bar edges to adjust dates. Click bar to open goal detail. Hover bar for quick info tooltip. Arrow keys navigate between goals.
- **"Today" button:** Fixed in the top-right corner. Keyboard shortcut: `T`.
- **Off-screen indicators:** Small arrow at the edge of a row when the bar extends beyond the visible area (Notion pattern).

### ADHD-Friendly Adaptation

- **Auto-scroll to today on open.** Don't make the user hunt for "now." The timeline should always open centered on today, with the past fading slightly to the left and the future bright to the right.
- **Limit zoom options.** Two levels (month + week) is enough for personal goals. More levels create decision fatigue.
- **Don't show empty past stretches.** If a goal started 6 months ago and today is month 6, the timeline should scroll to show "the last month and the next 2 months" — not the entire history. The past is context, not the focus.
- **Gentle overdue treatment.** If a goal bar has passed its target date without completion, don't turn it red. Extend the bar with a dashed outline past the target date and label it "still active" in neutral text. Red = emergency = avoidance.

---

## 3. Habit Tracking with Streaks + Heatmap

### Best Examples

#### GitHub — Contribution Graph (Heatmap Gold Standard)

The GitHub contribution graph is the most widely recognized heatmap pattern:
- **Grid layout:** 52 columns (weeks) x 7 rows (days), reading left-to-right, oldest to newest.
- **Color intensity:** 5 levels from empty (gray) to maximum (dark green). Each cell is a small square (10-14px) with 2px gaps.
- **Month labels:** Top of the grid, positioned at the start of each month.
- **Day labels:** Left side (Mon, Wed, Fri typically shown to save space).
- **Hover tooltip:** Shows exact date and count ("5 contributions on March 15").
- **Legend:** "Less" to "More" gradient shown below the graph.
- **Total count:** "X contributions in the last year" as a summary above the graph.

**What they do well:** The pattern is so successful because it rewards density without punishing gaps. A "light" week surrounded by "dark" weeks doesn't scream failure — it's just a lighter patch. The visual reads as "overall pattern" rather than "individual day performance." This is fundamentally different from a streak counter that highlights every break.

**CSS implementation insight:** Grid built with CSS Grid using `repeat(auto-fill, 16px)` columns. Each cell is a `div` with a class determining its color level. The grid is data-driven: create 365 divs, check each date against the activity array, assign the appropriate intensity class.

#### Loop Habit Tracker (Android, Open Source)

Loop is the most data-rich habit tracker:
- **History widget:** Mini-calendar showing all dates a habit was completed, rendered as colored squares in a grid (GitHub-style but per-habit).
- **Streak counter:** Shows consecutive days completed. Displayed as a large number with "current streak" label.
- **Frequency widget:** Shows completion frequency per weekday as sized dots — large bright dot for "always done on Monday," small dull dot for "rarely done on Saturday." This surfaces patterns.
- **Score graph:** A line chart showing "habit strength" over time (0-100%), computed from a weighted algorithm that values consistency over perfection.
- **Statistics:** Best streak, current streak, total completions, success rate percentage.

**What they do well:** The "habit strength" score is the key innovation. Instead of binary "did you or didn't you," it computes a percentage that decays slowly on missed days and grows on completed days. This means one missed day doesn't destroy your progress — the score dips slightly but recovers quickly. This is mathematically kinder than a streak counter.

#### Streaks (iOS, Apple Design Award Winner)

Streaks is the pinnacle of minimal habit tracking:
- **Up to 24 habits** displayed as circular icons on a single screen.
- **Each habit:** A ring that fills clockwise as the streak grows. Icon in the center.
- **Streak display:** Current streak number displayed prominently below each habit.
- **Interaction:** Single tap to mark complete. The ring animates to its new fill level.
- **Calendar view:** Available per-habit, showing a traditional month grid with completed days marked.
- **Apple ecosystem integration:** Can auto-complete habits using Health data, Shortcuts, etc.

**What they do well:** One-tap completion is the friction minimum. The circular ring is more emotionally gentle than a number — a "slightly less full" ring doesn't feel as bad as "streak: 0." The icon-centric design means you recognize habits visually, not by reading text.

#### Daylio (Mood + Habit Tracker)

Daylio's key innovation is the "Year in Pixels" view:
- **Calendar grid** where each day is a colored square representing that day's mood (or habit completion).
- **Color mapping:** 5 mood levels mapped to 5 colors (dark purple for "rad" to gray for "awful").
- **Entry UX:** Two taps: (1) select mood from 5 emoji faces, (2) select activities from a customizable icon grid. Takes under 5 seconds.
- **Monthly mood chart:** Line graph overlaid with individual mood dots.
- **No text required.** The entire app works without writing a single word. This is its ADHD superpower.

**What they do well:** The "Year in Pixels" is the personal heatmap done right — it's not about productivity or streaks, it's about "what did this year look like?" The two-tap entry eliminates the friction that kills most journaling apps. The 5-point emoji scale (not a number, not text) is instant and intuitive.

#### DopaLoop (ADHD-Specific Habit Tracker)

DopaLoop is purpose-built for ADHD and Rejection Sensitive Dysphoria (RSD):
- **0-5 intensity scale** instead of binary pass/fail. "Did you do it a little?" counts.
- **Forgiving streaks:** Missing a day doesn't reset to zero. Streaks decay gradually.
- **Goals-first grouping:** Habits are organized under meaningful goals, not shown as a flat list.
- **Supportive language:** No "you failed" or "streak broken." Instead: "you're still on track" or "that's okay, you can try again."
- **Body-first support:** Haptic feedback and breathing exercises before habit check-in.

**What they do well:** The intensity scale is the critical insight for ADHD. Binary tracking (yes/no) creates a perfectionism trap: if you can't do the habit perfectly, you don't do it at all. A 0-5 scale means "I did 2 minutes of exercise" still counts. Forgiving streaks prevent the "streak broke, might as well give up" spiral.

### Key Pattern

**The core UX insight:** There are two fundamentally different philosophies — streak-based ("don't break the chain") and pattern-based ("look at your overall consistency"). For an ADHD brain, pattern-based is safer. Streaks create a binary win/lose dynamic that triggers avoidance after a single miss. Heatmaps show that one bad week in a sea of good weeks is fine.

**The spectrum of guilt potential:**
- Most guilt-inducing: Broken streak counter with "0 days" prominent
- Moderate: Binary streak with "freeze" mechanic
- Least guilt-inducing: Habit strength percentage that decays slowly + heatmap showing overall pattern

### Recommendation for This App

**Component: `HabitTracker` (section on Goals page or sidebar)**

**Daily check-off UX:**
- Habits displayed as a compact horizontal row of circular icons (like Streaks app).
- Single click to mark complete. Keyboard: number keys `1`-`9` for habits 1-9.
- Completed habits show a filled circle with a subtle checkmark animation (100ms scale pop).
- Allow partial completion: hold-click or right-click to select intensity (1-5 dots inside the circle). Default single-click = full completion.

**Streak display — "Momentum" framing:**
- Don't call it a "streak." Call it **"momentum"** — a number that grows with consistency and decays slowly on missed days (like Loop's habit strength score).
- Display: `Momentum: 85%` with a small trend arrow (up/down/flat).
- Below each habit, show the current momentum as a thin colored bar (not a number unless hovered).
- On hover, show: "Current momentum: 85% | Best: 92% | Active for 45 days"

**Heatmap display:**
- Full-year heatmap (GitHub-style grid) available per-habit or as a combined "overall activity" heatmap.
- **Warm color palette** (not GitHub green): empty = warm gray (`#2a2520`), level 1 = amber-100, level 2 = amber-200, level 3 = amber-400, level 4 = amber-500. This matches the app's warm design language.
- Cell size: 12px squares with 2px gaps. Month labels along the top. Day labels (M, W, F) on the left.
- "Today" cell has a subtle border ring to show your position in the year.
- Implementation: CSS Grid, `grid-template-columns: repeat(53, 12px)`, `grid-template-rows: repeat(7, 12px)`. Each cell is a `div` with a `data-level` attribute for styling.

**Statistics panel (expandable section):**
- Current momentum, best momentum (with date range), total completions this month/year
- Frequency pattern: small dot chart showing which days of the week are strongest (Loop pattern)
- No "longest streak" metric — replace with "most consistent month" to frame patterns over chains

### ADHD-Friendly Adaptation

- **Never show "Streak: 0."** If a habit hasn't been completed in a while, show "Ready to start" instead.
- **No broken-streak notification.** The app should never send "You broke your streak!" — that's a shame trigger. Instead, after 2 missed days: "Want to check in on [habit]?" — a pull, not a push.
- **Forgiving momentum:** The momentum score should use a weighted decay: missing 1 day drops it ~2%, missing 3 days drops ~10%, missing a week drops ~25%. Recovery is fast: 3 consecutive days restore most lost momentum. This prevents the "all is lost" feeling.
- **Celebrate returns:** When a user completes a habit after missing 3+ days, show a warm celebration: "Welcome back to [habit]!" — not "You broke a 14-day streak."
- **Partial credit:** If using the intensity scale, even a "1/5" day contributes to momentum. The message: "Any effort counts."
- **"Skip day" option:** An explicit "Not today" button that doesn't reduce momentum. Allows planned rest days without guilt. Limit to 2 per week to prevent abuse while maintaining flexibility.

---

## 4. Goal Progress Visualization

### Best Examples

#### Linear — Project Progress (Issue-Derived)

Linear's project progress is auto-calculated from child issues:
- **Progress bar:** Thin horizontal bar on the project card/row showing percentage of completed issues.
- **Calculation:** `(completed issues / total issues) * 100`. Simple, transparent.
- **Dual metrics:** Linear shows separate lines for "Started" (in-progress) and "Completed" issues in the project graph. This distinguishes "we're working on it" from "we're done with it."
- **Project graph:** A burndown-style chart showing completed issues over time (blue bars), available in the project overview. Separate lines for started vs. completed prevent ambiguity.
- **Health indicator:** Separate from progress — a manual or auto-derived status (On track / At risk / Off track) shown as a colored dot. This acknowledges that 50% progress can be "on track" (if you're mid-timeline) or "at risk" (if the deadline is tomorrow).
- **Milestone progress:** Each milestone also shows its own completion percentage, and the milestone diamond icon changes appearance based on status (hollow = not started, yellow = in progress, filled = complete).

**What they do well:** Separating "progress" from "health" is the critical insight. Progress is objective (how much is done). Health is contextual (is this enough given the timeline?). Showing both prevents the trap of "we're 80% done" when the deadline is tomorrow and the remaining 20% is the hardest part.

#### Lattice — OKR Progress (Weighted Children)

Lattice calculates objective progress from key results:
- **Equal-weight default:** Each key result contributes equally. 3 KRs, one completed = 33% progress.
- **Custom weighting:** Users can assign different weights to different KRs (e.g., one KR is worth 50%, another 30%, another 20%).
- **Status inheritance:** An objective's status = the weakest key result's status. If any KR is "at risk," the objective is "at risk." This ensures problems surface upward.
- **Visual:** Progress bar with percentage, color-coded by status (green/yellow/red).

**What they do well:** The "weakest child determines parent status" rule is psychologically effective — it prevents false confidence. The custom weighting acknowledges that not all sub-goals are equally important.

#### Perdoo — OKR Progress (Flexible Calculation)

Perdoo offers two progress modes:
- **Key-results-driven:** Progress = average of KR progress (default).
- **Aligned-objectives-driven:** Progress = average of child objective progress (for hierarchical goal structures).
- **Status calculation:** Automatic, based on child statuses. The parent's status is the weakest child's status.

**What they do well:** Giving users a choice of calculation method acknowledges that different goals need different progress models. Some goals are measurable (KR-driven), others are directional (child-objective-driven).

#### Strides — Multi-Type Progress

Strides offers four tracker types with different progress models:
- **Target:** Progress toward a numeric goal by a date. Shows progress bar + "pace line" (where you should be by now). Green if ahead of pace, red if behind.
- **Habit:** Streak + success rate + calendar heatmap.
- **Average:** Rolling average of values over time (e.g., "average 7 hours of sleep").
- **Project:** Milestone checklist with overall percentage.

**What they do well:** The "pace line" concept is powerful — it answers "am I on track?" without needing a manual health status. If your goal is "read 24 books by December" and you've read 8 by April, the pace line shows you're ahead (8 > expected 6). This auto-detects health.

### Key Pattern

**The core UX insight:** Progress must be auto-calculated from concrete evidence (completed tasks, checked milestones) — not manually entered. Manual progress entry creates busywork and falls out of sync. The system should derive progress from the work the user is already doing.

**The three layers of goal progress:**
1. **Progress** (objective): What fraction is done? Bar + percentage.
2. **Pace** (contextual): Am I ahead or behind where I should be? Derived from start date, target date, and current progress.
3. **Health** (summary): A single signal — on track, needs attention, behind. Can be auto-derived from pace.

### Recommendation for This App

**Component: `GoalProgress` (used within GoalCard and GoalDetail)**

**Calculation engine (Rust-side):**
```
progress = (completed_milestones + completed_tasks) / (total_milestones + total_tasks)
pace = expected_progress_by_today based on (start_date, target_date)
health = if progress >= pace then "on_track"
         else if progress >= pace * 0.75 then "needs_attention"
         else "behind"
```

**Visual treatment:**
- **Progress bar:** 4px height on cards, 8px height on detail page. Rounded ends. Fill color follows health: warm green (on track), amber (needs attention), warm coral (behind).
- **Percentage label:** Right-aligned next to the bar. Show as "72%" on cards, "72% complete" on detail.
- **Pace indicator:** On the detail page, a small diamond marker on the progress bar showing "where you should be." If progress is ahead of pace, the bar fill extends past the diamond — this feels good. If behind, the diamond sits ahead of the fill — a gentle visual nudge.
- **Fraction display:** Below the bar, show "3/8 milestones · 12/18 tasks" in muted text.
- **No-children state:** If a goal has no milestones or tasks yet, show the bar at 0% with text: "Add milestones or tasks to track progress" — an invitation, not a judgment.

**Detail page graph (optional, phase 2):**
- Small line chart (like Linear's project graph) showing progress over time.
- X-axis: weeks/months. Y-axis: percentage (0-100%).
- A diagonal "pace line" from 0% at start date to 100% at target date.
- Actual progress plotted against the pace line. Being above the line = on track.

### ADHD-Friendly Adaptation

- **Show progress, not remaining work.** "72% complete" is motivating. "28% remaining" triggers overwhelm. Always frame as what's been accomplished.
- **Celebrate pace beats.** If the user is ahead of pace, show a subtle indicator: "Ahead of schedule" in warm green. This creates positive reinforcement without comparison to others.
- **Don't auto-set goals to "behind."** If a goal has no target date, pace cannot be calculated — show progress without health status. Many personal goals are open-ended.
- **Micro-progress matters.** Count completed subtasks, not just milestones. If a milestone has 10 subtasks and 3 are done, that's 30% of that milestone — not 0%. This prevents the "nothing is moving" feeling on large goals.
- **"Just started" badge:** New goals (< 1 week old) get a "Just started" badge instead of showing 0%. This normalizes the beginning phase.

---

## 5. Life Areas / Categories

### Best Examples

#### Wheel of Life (Classic Framework)

The traditional Wheel of Life divides life into 8-10 areas:
- **Standard categories:** Career, Health, Finances, Relationships, Family, Personal Growth, Fun/Recreation, Physical Environment, Spirituality, Community
- **Visualization:** A circular chart divided into wedges, each rated 1-10. Filled areas show satisfaction/progress. Uneven wheels are immediately visible, revealing imbalance.
- **Color coding:** Each area gets a distinct color. Colors are consistent across the app — Career is always blue, Health is always green, etc.
- **Usage pattern:** Rate each area periodically (monthly/quarterly), then set goals to improve the lowest areas.

**What they do well:** The visual metaphor of a "wheel" immediately communicates balance/imbalance. An uneven shape is obviously "wrong" without explanation. The limited category set (8-10) prevents over-categorization.

#### Level 10 Life (Hal Elrod / Miracle Morning)

Level 10 Life extends the Wheel of Life with goal-setting:
- **10 life areas**, each rated 1-10. The goal is to bring every area to "10."
- **Visual:** Either a wheel/radar chart or a column chart with 10 bars.
- **Color progression:** As you rate areas over time, you color in sections of the chart, creating a visual progress record.
- **Goal connection:** Each life area maps to specific goals and habits. The chart becomes a high-level dashboard of "where am I investing?"

**What they do well:** The 1-10 rating per area creates a gamification hook without streaks. "My health is at 7, was 5 last month" is motivating without guilt. The explicit connection from areas to goals creates a "why" for each goal.

#### Reclaim.ai — Habit Categories

Reclaim takes a different approach — habits are organized by when they happen, not by life area:
- **Scheduling-first:** Habits are categorized by frequency (daily, weekly) and time preference (morning, afternoon, evening).
- **Color coding:** Each habit gets a color that appears on the calendar.
- **Auto-defense:** The AI automatically blocks time for habits, defending them against meeting conflicts.

**What they do well:** Organizing by time-of-day instead of life area is pragmatic. "Morning habits" and "evening habits" map directly to routines — you don't need to think about which life area "meditation" belongs to.

### Key Pattern

**The core UX insight:** Life areas serve two purposes: (1) organizing goals into meaningful groups, and (2) revealing balance/imbalance at a glance. The visual treatment should make imbalance obvious without math.

**Color coding is essential.** Every app that groups by life area uses persistent color coding. The color becomes the category's identity — you recognize it faster than reading the label. Limit to 6-8 colors to maintain distinctiveness (more than 8 colors start to look similar).

**Grouping vs. filtering:** Both should be supported. Grouping (show all goals organized by area) is for overview. Filtering (show only Health goals) is for focus sessions.

### Recommendation for This App

**Component: `LifeArea` system (data model + UI treatment)**

**Data model:**
- `life_areas` table: `id`, `name`, `icon`, `color`, `position`
- Each goal has a `life_area_id` foreign key.
- Default areas (pre-populated, user can customize):
  - Career (briefcase icon, blue)
  - Health (heart icon, green)
  - Creative (palette icon, purple)
  - Relationships (people icon, pink)
  - Finance (dollar icon, amber)
  - Growth (book icon, teal)

**Visual treatment:**
- **Colored chips** throughout the app: a small rounded rectangle with the area's color as background (at 20% opacity) and area name in the area's color. Same visual language as Linear's label chips.
- **Icon + color pair:** Each area has both an icon and a color. The icon appears on goal cards; the color appears as a left-border accent on goal rows, as chip background, and as bar color on the timeline.
- **Sidebar filter:** Life areas appear as filter buttons in the goals page right sidebar. Click to filter, showing only goals for that area. Active filter has a filled background; inactive has outline only.
- **Goal cards grouping:** Optional "Group by area" mode that creates sections with area-colored headers. Default is ungrouped (sorted by most recent activity).

**Balance visualization (optional, phase 2):**
- A small radar chart or bar chart showing goals-per-area or progress-per-area.
- Not a Wheel of Life (too much visual weight for a sidebar element) — instead, a compact horizontal bar chart:
  ```
  Career    ████████░░  80%
  Health    ██████░░░░  60%
  Creative  ████░░░░░░  40%
  Growth    ██░░░░░░░░  20%
  ```
- This surfaces imbalance ("you have 5 Career goals and 0 Creative goals") without the ceremony of a wheel chart.

### ADHD-Friendly Adaptation

- **Pre-populated defaults.** Don't make the user create life areas from scratch. Provide 6 good defaults that they can rename or remove. Blank-canvas setup creates decision paralysis.
- **Keep it to 6-8 areas max.** More areas means more categorization decisions. Every goal creation would require choosing from too many options. 6 is manageable.
- **"Uncategorized" is valid.** If a goal doesn't fit a life area, it should be fine without one. Don't force categorization — that's friction. Show uncategorized goals in a neutral "Other" group.
- **Don't moralize about balance.** The app should not say "Your Creative life is neglected!" That's guilt. Instead, if the user opens the balance view, it shows the data neutrally. The user draws their own conclusions.
- **Quick-assign from goal creation:** When creating a goal, show life areas as colored icon buttons (not a dropdown). One click to assign. The most recently used area is pre-selected.

---

## 6. Milestone Markers

### Best Examples

#### Linear — Milestones on Project Timelines

Linear's milestone implementation is the cleanest in the space:
- **Visual:** Diamond shapes placed on project bars at milestone target dates.
- **Status coloring:** Hollow diamond = not started. Yellow diamond = in progress (current focus). Filled/completed diamond = done.
- **Clustering:** When milestones are close together on the timeline and would overlap, they collapse into a numbered badge (e.g., a circle with "3" indicating 3 milestones in that region). Click to expand and see individual milestones.
- **Hover behavior:** Hovering a diamond shows a tooltip with milestone name, completion percentage, and target date.
- **Detail pane:** In the project detail sidebar, milestones appear as a vertical list with completion percentages and progress bars.
- **Timeline placement:** Milestones appear on the project bar itself — not on a separate row. This associates them directly with their parent goal visually.

**What they do well:** The diamond is the universally recognized milestone symbol. The clustering behavior solves the biggest practical problem: multiple milestones creating visual noise. The yellow "current focus" diamond tells you which milestone the team is working toward right now — essential for orientation.

#### Jira — Versions/Releases as Milestones

Jira represents milestones as "versions" or "releases":
- **Visual:** Vertical lines on the timeline/roadmap view. The line extends from the top header down through all relevant issues.
- **Color coding:** Green = released/completed. Blue = upcoming. Red = overdue.
- **Burndown connection:** Each version has a burndown chart showing progress toward its scope.
- **Issue association:** Issues are tagged with a "fix version," connecting them to milestones.

**What they do well:** The vertical line treatment (as opposed to a diamond on a bar) works better for cross-cutting milestones that affect multiple projects. The burndown chart per milestone adds depth.

#### General Gantt Standard

Across project management tools, milestones follow consistent conventions:
- **Shape:** Diamond (rotated square) is the universal standard. Some tools use dots, flags, or vertical lines, but diamonds are the most recognizable.
- **Duration:** Milestones have no duration — they mark a point in time. Visually, they're always a single point, not a bar.
- **Color encoding:** Green/completed, yellow/in-progress, red/overdue, gray/not started.
- **Size:** Typically 8-12px — smaller than task bars but large enough to click.

### Key Pattern

**The core UX insight:** Milestones are the "checkpoints" that turn an amorphous goal into a journey with landmarks. Without them, a goal bar on a timeline is just "start" and "end" with nothing in between. Milestones answer: "How far along am I? What's the next checkpoint?"

**The diamond is non-negotiable.** It's the only shape universally associated with milestones. Using circles or squares would create confusion with other elements (dots for habits, squares for heatmaps).

**Approaching milestones need emphasis.** A milestone 2 days away should be more visually prominent than one 3 months away. This creates natural urgency without alarm bells.

### Recommendation for This App

**Component: `MilestoneMarker` (used within GoalTimeline and GoalDetail)**

**Timeline treatment:**
- Diamond shape, 10px, positioned on the goal bar at the milestone's target date.
- **Status states:**
  - Not started: Outlined diamond, warm gray stroke, transparent fill.
  - In progress (nearest upcoming): Filled diamond, amber. Slightly larger (12px) for emphasis.
  - Completed: Filled diamond, warm green. Subtle checkmark inside (6px) for extra clarity.
  - Overdue: Outlined diamond, warm coral stroke, dashed outline. NOT solid red — dashed keeps it neutral.
- **Clustering:** If two or more milestones fall within 5% of the visible timeline width, collapse them into a rounded badge showing the count (e.g., "3"). Badge uses the most urgent milestone's color. Click to expand into a small popover listing individual milestones.
- **Tooltip on hover:** Shows milestone name, target date, and completion percentage ("Research phase: 4/6 tasks done, due Apr 15").

**Goal detail treatment:**
- Milestones listed vertically in the goal detail sidebar as a mini-roadmap:
  ```
  ◇ Define scope             Due: Feb 1   ✓ Complete
  ◆ Research phase            Due: Mar 15  ━━━━━━━━░░ 80%
  ◇ First draft               Due: Apr 15  Not started
  ◇ Final review              Due: May 1   Not started
  ```
- The current/active milestone is highlighted with an amber left-border accent.
- Clicking a milestone expands to show its child tasks.

**Approaching milestone indicator:**
- When a milestone is within 7 days of its target date and not yet complete, it gets a subtle pulsing ring animation on the timeline (very gentle — 3s cycle, 5% opacity change). This draws the eye without alarming.
- In the sidebar/card view, approaching milestones show a "Due in X days" label in amber text.

### ADHD-Friendly Adaptation

- **One "current" milestone per goal.** Visually emphasize only the nearest incomplete milestone (amber diamond, larger size). The rest stay muted. This answers "what's the next checkpoint?" without requiring the user to scan all milestones.
- **Don't show "X days overdue" counters.** If a milestone is past due, show "Still open" in neutral text. The dashed diamond outline is enough visual signal.
- **Milestone completion celebrations:** When a milestone is marked complete, show a brief confetti/sparkle animation on the diamond and a toast: "Milestone reached: [name]!" This creates dopamine at meaningful checkpoints (not every tiny task).
- **Auto-suggest milestones.** When creating a goal with a timeline, the app could suggest milestones at 25%, 50%, 75% intervals: "Want to add checkpoints?" This reduces the planning friction that often prevents milestone creation.
- **Keep milestones to 3-6 per goal.** More than 6 milestones on a single goal bar creates visual clutter and planning overwhelm. If the user tries to add more, gently suggest: "Consider breaking this into separate goals or using tasks within milestones instead."

---

## Cross-Cutting Design Principles

These patterns emerged across all six research areas:

### 1. Warm Color Palette Application

Replace the standard green/yellow/red with warm equivalents:
- On track: `hsl(150, 45%, 55%)` — warm green (slightly desaturated, not neon)
- Needs attention: `hsl(38, 80%, 55%)` — amber/gold
- Behind: `hsl(12, 70%, 55%)` — warm coral (not alarm-red)
- Neutral/empty: `hsl(30, 10%, 18%)` — warm dark gray
- Completed: `hsl(38, 60%, 50%)` — warm gold (celebratory, not clinical green)

### 2. Keyboard-First Interactions

| Action | Shortcut | Context |
|--------|----------|---------|
| Navigate between goals | `J` / `K` | Goals page |
| Open goal detail | `Enter` | Goal selected |
| Switch to timeline view | `V` then `T` | Goals page |
| Switch to card view | `V` then `C` | Goals page |
| Create new goal | `G` | Goals page |
| Mark habit complete | `1`-`9` | Habit section visible |
| Snap timeline to today | `T` | Timeline view |
| Zoom timeline | `+` / `-` | Timeline view |

### 3. Information Progressive Disclosure

| Level | What's shown | Where |
|-------|-------------|-------|
| Glance (< 1 sec) | Name, progress bar, health color | Card grid |
| Scan (2-3 sec) | + life area, due date, milestone count | Card detail text |
| Focus (5+ sec) | + pace indicator, task breakdown, graph | Detail sidebar |
| Deep dive | + activity history, full milestone list, heatmap | Full detail page |

### 4. Consistent Component Reuse

Several components should be shared across goal-related views:
- `ProgressBar` — used in GoalCard, GoalDetail, MilestoneItem, HabitMomentum
- `HealthDot` — used in GoalCard, GoalTimeline, GoalDetail
- `LifeAreaChip` — used in GoalCard, GoalDetail, GoalTimeline frozen column
- `DiamondMarker` — used in GoalTimeline, GoalDetail milestone list
- `HeatmapGrid` — used in HabitDetail, GoalActivity (optional)

---

## Implementation Priority

Given the build plan's Phase C scope, recommended build order:

1. **GoalCard + GoalProgress** — Core data model + card view. Gets goals visible immediately.
2. **LifeArea system** — Data model + chips. Needed for goal creation.
3. **MilestoneMarker** — Within GoalDetail first, then on timeline.
4. **GoalTimeline** — Horizontal timeline with bars and milestone diamonds.
5. **HabitTracker** — Momentum system + daily check-off. Can start simple.
6. **HeatmapGrid** — Year-in-pixels view. Polish phase.

---

## Key Sources

- [Linear Projects Docs](https://linear.app/docs/projects) — Project cards, health, progress bars
- [Linear Project Milestones Docs](https://linear.app/docs/project-milestones) — Milestone implementation and status
- [Linear Project Graph Docs](https://linear.app/docs/project-graph) — Progress visualization, started vs completed
- [Linear Display Options Docs](https://linear.app/docs/display-options) — Board layout, grouping, swimlanes
- [Linear Milestones on Timeline Changelog](https://linear.app/changelog/2024-02-29-milestones-on-the-timeline) — Milestone clustering, diamond markers
- [How We Redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui) — Design refresh philosophy
- [Notion Gallery View Guide](https://super.so/blog/notion-gallery-view-a-comprehensive-guide) — Card sizing, property visibility, limitations
- [Notion Timeline View Docs](https://www.notion.com/help/timelines) — Zoom levels, today button, arrow indicators
- [Notion VIP: Timeline View](https://www.notion.vip/insights/meet-notion-s-timeline-view) — Horizontal bars, table hybrid
- [Monday.com Cards View](https://support.monday.com/hc/en-us/articles/4405723870994-The-Cards-View) — Inline editing, column customization
- [Asana Timeline Feature Launch](https://asana.com/inside-asana/timeline-feature-launch) — Virtual scrolling, zoom animation, dependencies
- [ClickUp Gantt Zoom-to-Fit Changelog](https://clickup.canny.io/changelog/gantt-view-zoom-to-fit-date-marker) — Today marker, zoom memory
- [Reimagining Gantt Charts for UX (LogRocket)](https://blog.logrocket.com/ux-design/reimagining-gantt-charts-ux-project-management/) — Modern Gantt UX best practices
- [GitHub Contribution Heatmap in JS (DEV)](https://dev.to/ajaykrupalk/github-like-contribution-heatmap-in-js-4201) — CSS Grid implementation
- [Building GitHub-like Contribution Graph (Medium)](https://medium.com/@the_ozmic/building-a-github-like-contribution-graph-for-a-habit-tracker-app-7655d82ece6d) — React + CSS Grid approach
- [react-calendar-heatmap (GitHub)](https://github.com/kevinsqi/react-calendar-heatmap) — SVG-based React component
- [Loop Habit Tracker (GitHub)](https://github.com/iSoron/uhabits) — Habit strength algorithm, frequency widgets
- [Streaks App](https://streaksapp.com/) — Minimal circular ring UI, one-tap completion
- [Daylio](https://daylio.net/) — Year in Pixels, two-tap entry, mood-to-color mapping
- [DopaLoop](https://dopaloop.app/en) — ADHD-specific: forgiving streaks, intensity scale, supportive language
- [Habithaven](https://mwm.ai/apps/habit-tracker-habithaven/6602894453) — ADHD-friendly tiny wins approach
- [Streaks iOS App Review (Cohorty)](https://www.cohorty.app/blog/the-ultimate-guide-to-habit-tracker-apps-2025-complete-comparison) — ADHD simplicity recommendations
- [Strides App](https://www.stridesapp.com/) — Four tracker types, pace line, success rate
- [Strides Review (AppleInsider)](https://appleinsider.com/articles/23/02/02/strides-1521-review-visual-habit-tracking-at-its-best) — Visual tracking, progress types
- [Lattice Goal Progress](https://help.lattice.com/hc/en-us/articles/360059451414-Understand-Progress-Calculation-in-Lattice) — Weighted KR progress, status inheritance
- [Perdoo Progress Calculation](https://support.perdoo.com/en/articles/4898961-customize-how-progress-is-calculated-for-objectives) — Flexible objective progress from KRs or aligned OKRs
- [15Five OKR Features](https://www.15five.com/blog/5-must-have-features-to-look-for-in-an-okr-tool/) — Dashboard visualization, real-time tracking
- [Wheel of Life (Goalscape)](https://goalscape.com/template/best-wheel-of-life-template/) — Radar chart, area-based rating
- [Level 10 Life Guide](https://littlecoffeefox.com/level-10-life-track-personal-growth/) — 10 life areas, rating progression
- [Reclaim.ai Habits](https://reclaim.ai/features/habits) — Time-based habit scheduling
- [Gantt Chart Milestones Guide (Visor)](https://www.visor.us/blog/gantt-chart-milestones-complete-guide/) — Diamond standard, color coding
- [Milestone Chart Creation (ProjectManager)](https://www.projectmanager.com/blog/how-to-create-a-milestone-chart) — Visual treatment conventions
- [Gantt with Milestones (Monday.com Blog)](https://monday.com/blog/project-management/gantt-chart-with-milestones) — Status-colored diamonds, timeline integration
