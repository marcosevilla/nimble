# Linear UX Patterns Research

> Research compiled for the Personal Triage & Briefing App (Tauri + React)
> Date: 2026-03-22
> Purpose: Understand Linear's design patterns to apply relevant ones to a personal daily triage/briefing macOS app

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Information Hierarchy](#2-information-hierarchy)
3. [Navigation Model](#3-navigation-model)
4. [Interaction Patterns](#4-interaction-patterns)
5. [Keyboard-First Design](#5-keyboard-first-design)
6. [Views & Filtering](#6-views--filtering)
7. [Status & Progress Visualization](#7-status--progress-visualization)
8. [Density & Spacing](#8-density--spacing)
9. [Empty States & Onboarding](#9-empty-states--onboarding)
10. [Dark Mode & Color System](#10-dark-mode--color-system)
11. [What Makes It Feel Productive](#11-what-makes-it-feel-productive)
12. [Application to Personal Triage App](#12-application-to-personal-triage-app)

---

## 1. Design Philosophy

### Karri Saarinen's Core Principles

Linear's CEO and co-founder Karri Saarinen (ex-Airbnb design systems lead) built Linear around several non-negotiable principles:

1. **Quality is the first principle** — Every other metric and decision flows from quality. No A/B testing. No data-driven design decisions. They trust intuition trained by deep customer understanding.

2. **Design for someone, not everyone** — Rather than pursuing universal appeal, Linear designs specifically for high-performance engineering teams. This focus enables excellence over compromise.

3. **Speed is a feature** — Early user research revealed frustration with sluggish tools. Linear made "never slow" a foundational product requirement, treating performance as a core capability.

4. **Opinionated software** — Rather than offering a blank canvas with infinite customization, Linear has a viewpoint on how work should flow. It provides structured guidance (cycles, triage, status workflows) rather than unlimited flexibility.

5. **Craft drives taste** — Deep expertise develops refined judgment. The team's standard is that quality should be felt even in invisible details.

6. **Design is search, not a production pipeline** — Saarinen warns against efficiency-focused tools that compress exploration space. Design involves gradually finding form within chaos; trial and error is essential.

7. **Avoid quality silos** — Connected teams where everyone is responsible for quality, rather than over-specialized teams that create artificial silos.

8. **Hire for craft** — The foundation of a quality-driven culture is hiring people who take personal pride in their work.

### The "Linear Design" Movement

Linear has spawned a broader design trend characterized by:
- Sequential, logical content progression aligned with natural reading direction (top-to-bottom, left-to-right)
- Dark mode as aesthetic standard
- Monochrome base with selective bold accents
- Minimal CTAs and navigation paths
- Single-direction visual scanning per section

**Key insight:** Linear design reduces cognitive load by having one direction for the eyes to scan, a single subject matter to focus on, and an orderly sequence of sections to follow.

---

## 2. Information Hierarchy

### The "Earned Attention" Principle

Linear's guiding rule: **"Don't compete for attention you haven't earned."** Not every interface element should carry equal visual weight.

- **Primary content** (issues, project details) — full visual prominence
- **Navigation** (sidebar, tabs) — deliberately de-emphasized, dimmer, smaller
- **Chrome/structure** (borders, separators) — felt, not seen. Softened edges, reduced contrast
- **Metadata** (labels, dates, assignees) — compact, secondary visual weight

### Hierarchy Layers (from most to least prominent)

1. **Issue titles and primary content** — largest text, highest contrast
2. **Status indicators and priority** — color-coded icons, always visible
3. **Assignee avatars** — small but recognizable
4. **Metadata row** — labels, project, cycle info in muted colors
5. **Timestamps and IDs** — smallest, lowest contrast text (tertiary/quaternary colors)

### Information Density Strategy

Linear fits a lot of information on screen without feeling cluttered through:
- **Progressive disclosure** — Only show what's relevant in the current context. Details expand on demand.
- **Smart defaults** — Pre-fill common choices, reducing decisions from many to zero
- **Layered surfaces** — Background, foreground, panels, dialogs, and modals each have distinct elevation levels
- **Consistent spacing** — 8px base grid creates rhythm: 8px, 16px, 32px, 64px increments

### Issue List Row Anatomy

Each issue in a list view typically shows:
- Status icon (left, color-coded circle/ring)
- Issue identifier (e.g., "ENG-123", muted)
- Issue title (primary text weight)
- Labels (colored chips, compact)
- Assignee avatar (right side)
- Priority indicator (icon)
- Due date (if set, muted text)

The row is designed for scanning — your eye naturally moves left (status) to center (title) to right (who/when).

---

## 3. Navigation Model

### Sidebar Architecture

Linear's sidebar uses an **inverted L-shape** global chrome pattern — sidebar on the left, tabs/header across the top, content in the main area.

**Sidebar sections (top to bottom):**
1. **Workspace switcher** — compact dropdown at top
2. **Personal section** — Inbox, My Issues (keyboard: GI, GM)
3. **Favorites** — pinned views for quick access
4. **Team sections** — collapsible per team, showing:
   - Issues (with sub-views: Active, Backlog, All)
   - Projects
   - Cycles (if enabled)
   - Triage (if enabled)
   - Views (custom saved filters)
5. **Workspace section** — Initiatives, Projects, Views
6. **Bottom** — Help & Feedback, Settings

**Sidebar design details:**
- Reduced brightness and prominence vs. main content
- Smaller icons, muted inactive text
- Increased vertical padding for scannability
- Customizable: reorder items, hide unused sections, drag-and-drop
- Notification indicators: configurable as count badges or dots
- Right-click on any item for contextual options

### View Headers

Each view has a header area containing:
- **Breadcrumb trail** — shows context (Team > Project > View)
- **Filter bar** — active filters displayed as pills
- **Display options** — layout toggle (list/board/timeline/split), grouping, sorting
- **Search within view**

### Right-hand Sidebar (Detail Panel)

When viewing a list, a right panel can show:
- Quick filters for common properties (assignees, labels, projects)
- Project metadata (lead, teams, health status)
- Contextual information based on current view

### Navigation Patterns

- **G-prefix shortcuts** navigate anywhere: GI (Inbox), GM (My Issues), GT (Triage)
- **Breadcrumbs** show full context path
- **Back/forward history** — browser-like navigation with keyboard shortcuts
- **Tabs within views** — My Issues has tabs for Assigned, Created, Subscribed, Activity

---

## 4. Interaction Patterns

### Multiple Action Pathways

Every action in Linear is available through multiple interaction methods:
1. **Keyboard shortcuts** — fastest for power users
2. **Command palette** (Cmd+K) — search-based discovery
3. **Context menus** — right-click on any issue, project, or item
4. **Inline buttons** — hover-revealed action buttons
5. **Toolbar actions** — batch operations from selection toolbar

This redundancy means users build muscle memory through whichever pathway they prefer, and they're always following consistent patterns regardless of method.

### Inline Editing

- Click on most fields to edit them directly in list view
- Status, priority, assignee, labels — all changeable inline
- No need to open full issue detail for common updates
- Changes save automatically (no explicit save button)

### Context Menus

Right-clicking on issues, projects, or items in any view reveals a context menu with:
- All relevant actions for that item
- Keyboard shortcut hints alongside each action (teaching users shortcuts passively)
- Sub-menus for multi-step actions (e.g., Move to team > [team list])

**The invisible detail:** Linear implemented a triangular "safe area" between cursor and sub-menus. This allows diagonal mouse movement (the shortest path) without triggering sub-menu closure. Traditional menus require an "upside-down L" movement path. The implementation uses CSS `clip-path` with a `polygon` definition, dynamically positioned based on cursor and sub-menu coordinates. About 40 lines of React code.

### Drag and Drop

- Reorder issues within views
- Move issues between status columns on board view
- Reorder sidebar items
- Drag issues between cycles or projects

### Batch Operations

Select multiple issues (Shift+click, Cmd+click, or Shift+arrow keys) to:
- Change status, priority, assignee, labels
- Move across teams, cycles, projects
- Apply bulk actions to tens or hundreds of issues
- Selection toolbar appears at bottom with available batch actions

### Optimistic Updates

Actions appear completed before server confirmation. This eliminates the psychological burden of waiting:
- Status changes reflect instantly in the UI
- Issue creation shows the new issue immediately
- No loading spinners for common operations
- Fallback/rollback only if the server rejects the action

### Modal-Based Workflows

Issue creation and editing use full-screen modals that:
- Maintain the user's context (underlying view visible behind)
- Avoid expensive mental switching between screens
- Focus attention on the current task
- Dismiss with Escape to return to previous context

---

## 5. Keyboard-First Design

### Shortcut Philosophy

Linear's keyboard shortcuts follow a deliberate design:

**Single-key actions (no modifier needed):**
- `C` — Create new issue
- `S` — Change status
- `P` — Set priority
- `L` — Modify labels
- `A` — Assign
- `?` — Show shortcut help

**G-prefix navigation (Go to...):**
- `G` then `I` — Go to Inbox
- `G` then `M` — Go to My Issues
- `G` then `T` — Go to Triage
- `G` then `A` — Go to Active issues
- `G` then `B` — Go to Backlog
- `G` then `C` — Go to Cycles
- `G` then `P` — Go to Projects
- `G` then `S` — Go to Settings

**Modifier combos for system-level actions:**
- `Cmd+K` — Command palette
- `Cmd+Enter` — Save/submit
- `Cmd+Shift+P` — Priority shortcuts
- `Escape` — Go back / dismiss

**Selection and navigation:**
- `J`/`K` or arrow keys — Move through issue lists
- `X` — Select/deselect issue
- `Shift+J/K` — Extend selection
- `Enter` — Open selected issue

### Command Palette (Cmd+K)

The command palette serves as a universal entry point for:
- **Search** — Find issues, projects, documents by text
- **Navigation** — Jump to any section or view
- **Actions** — Create issue, change workspace, access settings
- **Discovery** — Find features you didn't know existed

Design details:
- **Fuzzy search** — find actions without exact names
- **Recent actions** — shown by default when palette opens
- **Contextual results** — results change based on current view
- **Keyboard-navigable** — arrow keys to select, Enter to execute
- **Shortcut hints** — displayed next to each action for passive learning

### Keyboard Navigation Flow

The flow through a typical keyboard-only session:
1. `GM` — Jump to My Issues
2. `J/K` — Navigate to desired issue
3. `Enter` — Open issue detail
4. `S` — Change status (type to filter options, Enter to select)
5. `Escape` — Back to list
6. `C` — Create new issue from anywhere

### Shortcut Help

Pressing `?` opens a searchable shortcuts help screen. Context menus also display keyboard shortcuts next to each action, passively teaching users the keyboard equivalents of mouse actions.

---

## 6. Views & Filtering

### View Types and Layouts

Linear supports multiple display layouts:
1. **List view** — Default, most dense. Collapsible group headers (toggle with `T` key)
2. **Board view** — Kanban-style columns (typically grouped by status)
3. **Timeline view** — Gantt-like horizontal bars showing time spans
4. **Split view** — List on left, detail panel on right
5. **Fullscreen view** — Single issue detail fills the main area

### Custom Views

Custom views are saved filter configurations that persist and stay updated dynamically:
- **Created from** any filtered state using `Option/Alt + V` or the Save View icon
- **View types:** Issues, Projects, or Initiatives
- **Scope levels:**
  - Personal views (only you see them)
  - Team views (visible to team members)
  - Workspace views (visible to all)

### Filter System

Filters can be applied to almost every view and filter by almost any property:
- Assignee, label, project, team, cycle
- Status category, priority level
- Due date ranges, creation date
- Project status, health, milestone
- Custom properties

**Advanced filtering** supports:
- AND/OR logic combinations
- Nested filter groups
- AI-powered natural language filters (e.g., type a description and AI suggests filters)

### "My Issues" — The Personal Hub

My Issues is a curated set of views showing assigned issues with intelligent prioritization:

**Tabs:**
1. **Assigned to you** (default) — with "Focus" grouping
2. **Created by you**
3. **Subscribed** — issues you follow
4. **Activity** — recent changes on your issues

**Focus grouping priority order:**
1. Urgent issues and those with SLAs
2. Issues blocking others
3. Current and future cycle issues
4. Active items not in previous categories
5. Triage and backlog items
6. Completed and cancelled issues

Within each group, issues are ordered by priority with started issues first.

### Right-hand Filter Sidebar

Views include a collapsible right sidebar for quick property-based filtering:
- Click assignee to filter to their issues
- Click label to filter by tag
- Provides at-a-glance distribution of issues across properties

### View Subscriptions

You can subscribe to custom views to receive notifications (personal or Slack channel) when issues meet view parameters or are completed/canceled.

---

## 7. Status & Progress Visualization

### Status Icon System

Linear uses a distinctive set of circular status icons:

| Category | Icons | Visual Treatment |
|----------|-------|-----------------|
| **Triage** | Dotted circle outline | Gray, indicates unprocessed |
| **Backlog** | Dashed circle outline | Gray, low visual weight |
| **Unstarted/Todo** | Solid circle outline | Gray/white, not started |
| **In Progress** | Partially filled circle (pie-chart style) | Yellow/amber, shows activity |
| **Done** | Filled circle with checkmark | Purple/blue, completion signal |
| **Canceled** | Circle with X | Gray/muted, de-emphasized |

The icons are small (likely 14-16px) and use color + fill pattern to convey status at a glance without text labels.

### Priority Icons

Priority uses a set of distinct icons:
- **Urgent** — Red exclamation/alert icon
- **High** — Orange upward-pointing bars
- **Medium** — Yellow horizontal bars
- **Low** — Blue downward-pointing bars
- **No priority** — Gray dots/dash

### Project Progress

Projects show:
- **Progress bar** — horizontal bar showing percentage of completed issues
- **Completion percentage** — numeric display
- **Health indicator** — On track / At risk / Off track with color coding
- **Milestone markers** — visual checkpoints within the project timeline

### Activity Indicators

- **Unread badges** on sidebar items (configurable: count or dot)
- **Activity feed** in issue detail showing chronological updates
- **Assignee status dots** — online/offline indicators on avatars
- **Recently updated** — visual freshness indicators

### Color Usage Philosophy

Linear is notably restrained with color:
- **Monochrome base** — warm gray (shifted from cool blue-ish to warmer neutral)
- **Status colors** are the primary use of color
- **Labels** use a controlled color palette
- **No prominent brand color** in the product UI — neutral colors dominate
- Color is semantic: it always means something (status, priority, health)

---

## 8. Density & Spacing

### Spacing System

Linear uses a simple **8px base grid**:
- 4px — micro spacing (within compact elements)
- 8px — default element spacing
- 16px — section spacing
- 32px — major section breaks
- 64px — large structural spacing

This creates visual consistency where all components feel like they belong together.

### Typography

**Font families:**
- **Inter** — primary body text (the open-source variable font)
- **Inter Display** — headings, for added expression while maintaining readability
- Fallbacks: SF Pro Display, system fonts

**Font size scale (approximate, from reverse engineering):**
- Mini text: ~10-11px (timestamps, IDs)
- Small text: ~12px (metadata, labels)
- Regular body: ~13-14px (issue titles in lists, descriptions)
- Section headers: ~14-16px semi-bold
- Page titles: ~20-24px
- Large headings: up to 32-34px

**Line height:** Generally 1.3-1.5x for body text, tighter (1.1-1.2x) for headings

**Font weight usage:**
- Regular (400) — body text, descriptions
- Medium (500) — emphasis, active states
- Semi-bold (600) — section headers, small caps labels
- Bold (700-800) — page titles, major headings

### Density Configurations

Linear tested ranges from "very condensed to more spacious" and landed on a density that:
- Fits many items in view (typically 15-25 issues visible without scrolling)
- Maintains readable text sizes (never below ~11px)
- Uses consistent row heights in list views (~32-36px per issue row)
- References Apple standards for native-feeling density

### Responsive Space Management

Linear implements a **ResponsiveSlot** component system that goes beyond traditional breakpoints:
- Uses `ResizeObserver` APIs to calculate available container space
- Elements register with a priority system via React context (MobX store)
- Lower-priority items hide first when space is constrained
- Tabs use `visibility: hidden` + `overflow: hidden` (not DOM removal) to prevent layout flickering
- A "more" popover appears when items overflow

---

## 9. Empty States & Onboarding

### Empty State Philosophy

Linear treats empty states as opportunities, not dead ends:

- **First-use empty states** — Clear copywriting explaining what the section is for, with primary and secondary CTAs (e.g., "Create your first issue" button + "Import from Jira" link)
- **No-results states** — When filters yield nothing, explain why and suggest adjusting filters
- **Post-completion states** — Positive reinforcement when a list is empty because work is done (inbox zero vibes)

### Onboarding Approach

- **Extended beta testing** — Year-long private beta meant the product was polished before most users saw it
- **Opinionated defaults** — Pre-configured workflows reduce setup decisions
- **Contextual keyboard hints** — Shortcuts shown alongside context menu items teach as you go
- **Command palette discovery** — Users naturally find features through Cmd+K search
- **Import tools** — Smooth migration from Jira, Asana, GitHub Issues

### Progressive Feature Revelation

Rather than showing everything upfront:
- Cycles are optional (team setting)
- Triage is optional (team setting)
- Advanced features appear when relevant
- Settings surface only what the team uses

---

## 10. Dark Mode & Color System

### Color Space Technology

Linear uses the **LCH (Lightness, Chroma, Hue) color space** instead of HSL for its entire color system. LCH advantages:
- **Perceptual uniformity** — colors at the same lightness value appear equally bright to human eyes (HSL fails at this)
- **Better for generating themes** — mathematical relationships between colors produce more visually consistent results
- **Elevation handling** — different surface levels (background, foreground, panels, dialogs, modals) maintain proper contrast relationships

### Theme Generation System

Instead of defining 98 individual color variables per theme, Linear's system requires only **three inputs:**
1. **Base color** — the primary UI surface color
2. **Accent color** — for interactive/highlighted elements
3. **Contrast** — how contrasty the theme should be

From these three values, the entire color palette is generated algorithmically, including automatic high-contrast themes for accessibility.

### Dark Mode Specifics

**Background tones:**
- Shifted from cool, blue-ish gray to **warmer gray** that feels crisp but less saturated
- Multiple elevation levels: background (darkest) > foreground > panels > dialogs > modals (lightest)

**Text colors:**
- Primary text: high contrast (near white)
- Secondary text: reduced opacity/lightness for metadata
- Tertiary text: further reduced for timestamps, IDs
- Quaternary text: lowest contrast for decorative/structural text

**Color restraint:**
- Almost exclusively neutral colors for UI chrome
- Color is reserved for semantic meaning: status, priority, health, labels
- No prominent brand color in the interface
- Accent color is subtle — used for selected states, interactive elements

### Built-in Themes

Linear ships with both light and dark default modes, plus several custom themes:
- **Ash** — Light theme with neutral grays
- **Midnight** — Deep dark theme
- **Dawn** — Warm dark purple theme
- Custom user-created themes with the base/accent/contrast system

### Implementation Tools

Linear built an internal color picker tool (using Claude Code) that exposes controls for tweaking hue, chroma, and lightness of individual design tokens, enabling rapid iteration without lengthy preview cycles.

---

## 11. What Makes It Feel Productive

### The Psychology of Speed

The core insight: **how fast something feels often matters more than how fast it actually is.** Linear exploits this through multiple psychological mechanisms:

#### 1. Reduced Mental Load (Miller's Law)
People retain 7 plus or minus 2 chunks of information. Linear systematically removes unnecessary choices:
- Smart defaults reduce decisions to zero for common actions
- Progressive disclosure shows only relevant information
- Consistent patterns reduce learning overhead for new features

#### 2. Optimistic Updates
Actions appear completed before server round-trip:
- Status changes are instant in the UI
- Issue creation shows immediately
- No loading spinners for everyday operations
- Rollback only happens if the server actually rejects

#### 3. Keyboard-First Speed
Single-key shortcuts leverage muscle memory, which operates faster than visual searching:
- `C` immediately shows creation window with zero perceptible delay
- `S` opens status selector already filtered to current context
- `P` opens priority picker with options pre-loaded

#### 4. Context Preservation
Modal-based workflows maintain the user's mental model:
- Creating an issue doesn't navigate away from the current view
- Detail panels slide in rather than replacing content
- Escape always returns to previous state

#### 5. Natural Language Understanding
Dates auto-populate from phrases like "next month" or "Q4 2025," matching how people think rather than requiring machine-format input.

#### 6. Perceived Performance Techniques
- **Instant visual feedback** — Every interaction produces immediate visual response
- **Ease-out animations** — Elements animate quickly to their destination (fast start, gentle landing)
- **Skeleton screens** — Layout shapes appear before content loads
- **Prefetching** — Likely-needed data loads in background

#### 7. The "Zero State" Dopamine Loop
Linear's inbox and My Issues create a clearable queue:
- Processing items from inbox creates completion satisfaction
- "Focus" grouping in My Issues means the most important thing is always at the top
- Clearing a section feels like progress
- The interface rewards completion visually (checked states, progress bars advancing)

### Performance Benchmarks (2024)

- 3.7x faster than Jira for common operations
- 2.3x faster than Asana for common operations
- 4.6/5 engineer UX rating (vs. Jira's 3.2/5)

### What Users Report

Common user feedback themes:
- "Everything feels instant and lightweight"
- "I spend less time wrestling the tool and more time actually shipping"
- "The keyboard shortcuts make me feel like I'm flying"
- "It's the only project management tool I actually enjoy using"

---

## 12. Application to Personal Triage App

### Direct Pattern Translations

Here's how Linear's patterns map to the personal triage app's pages:

#### Today Page (Obsidian tasks + Todoist tasks)

**Borrow from Linear's "My Issues" view:**
- **Focus grouping** — Auto-sort tasks by urgency: overdue first, then today's deadlines, then upcoming
- **Single list with smart sections** — Don't make the user choose where to look. Merge Obsidian and Todoist into one prioritized list with source indicators (subtle icon/badge)
- **Inline status changes** — Click/keyboard to mark complete without opening detail
- **Progress visualization** — A subtle progress bar or fraction at the top showing "5/12 tasks done today"

**Specific recommendations:**
- Row height ~32-36px, Inter font, 13-14px issue titles
- Status circles on the left (checkbox-style, but with Linear's filled/unfilled language)
- Source indicator (Todoist icon, Obsidian icon) as small muted badge
- Priority coloring on the left edge or status icon

#### Tasks Page

**Borrow from Linear's views system:**
- **Saved filters** — "All tasks", "This week", "By project", "Overdue"
- **Grouping options** — By source, by priority, by due date, by project/tag
- **List + Board layouts** — Default to list, option for kanban board by status
- **Right-side filter panel** — Quick toggle filters for projects, labels, priorities

#### Inbox (Quick Captures)

**Borrow from Linear's Triage pattern:**
- **Triage-style inbox** — Items enter as "unprocessed" (dotted circle icon)
- **Quick actions on each item** — Convert to task (with project/date picker), dismiss, defer
- **Process one at a time** — Consider a focused triage mode that shows one item and asks "what do you want to do with this?"
- **Empty state celebration** — When inbox is clear, show a positive empty state

**Borrow from command palette:**
- **Quick capture via Cmd+N or Cmd+K** — Type a thought, hit Enter, it goes to inbox
- **Natural language processing** — "Call dentist tomorrow at 3pm" auto-parses to task with date

#### Session Log

**Borrow from Linear's Activity feed:**
- **Chronological entries** — Timestamped log of what you did
- **Minimal chrome** — Tight spacing, small timestamps, content-forward
- **Auto-logged actions** — Task completions, captures, session starts auto-log

#### Calendar Sidebar

**Borrow from Linear's right-hand sidebar:**
- **Collapsed by default** — Expands on demand, doesn't steal primary content space
- **Today's events** — Compact list with time, title, and meeting link
- **Color-coded by calendar** — Subtle left-border color per calendar source
- **Next-up indicator** — The next upcoming event gets visual prominence

#### Habits Sidebar

**Borrow from Linear's progress visualization:**
- **Compact checklist** — Similar to Linear's label-style chips
- **Streak/progress indicators** — Small visual (dot pattern, mini bar chart) showing recent completion
- **Low friction** — Single click/tap to check off, no navigation needed

### Foundational Patterns to Implement

#### 1. Command Palette (HIGHEST PRIORITY)

This is the single most impactful pattern to borrow. Implement Cmd+K as the universal entry point:
- **Quick capture** — Type a thought, press Enter to inbox
- **Navigation** — Jump to Today, Tasks, Inbox, Session Log
- **Search** — Find any task across all sources
- **Actions** — "Complete [task name]", "Defer inbox items", "Start session"
- **Fuzzy matching** — Don't require exact text

#### 2. Keyboard-First Navigation

Adapt Linear's shortcut philosophy:
- **Single-key actions:** `C` (capture/create), `T` (toggle complete), `D` (defer)
- **G-prefix navigation:** `GT` (go to Today), `GK` (go to Tasks), `GI` (go to Inbox), `GS` (go to Session)
- **J/K or arrows** for list navigation
- **Enter** to expand/open detail
- **Escape** to go back

#### 3. 8px Grid + Inter Font

Use Linear's exact spacing and typography system:
- 8px spacing grid (4/8/16/32/64px increments)
- Inter for body, Inter Display for headers
- 13-14px base body text
- Muted secondary text for metadata
- ~32-36px row heights for list items

#### 4. Dark Mode with LCH Colors

Build the color system on LCH from the start:
- Warm dark gray background (not pure black, not cool blue)
- 3-5 surface elevation levels
- Color reserved for semantic meaning only (priority, source, status)
- Consider using only 3 seed values (base, accent, contrast) for theme generation

#### 5. Optimistic Updates + Instant Feedback

Every interaction must produce immediate visual feedback:
- Task completion: instant strikethrough + check animation
- Captures: item appears in inbox immediately
- No loading spinners for local operations
- Ease-out animations (fast start, gentle stop) for transitions

#### 6. Progressive Disclosure

Don't show everything upfront:
- Today page shows tasks only — habits and calendar are in collapsible sidebars
- Task detail expands inline or in a slide-over panel
- Settings and customization are hidden until needed
- Advanced features (filters, saved views) are discoverable but not prominent

#### 7. Focus Grouping for "What Should I Do Next?"

The killer feature for a personal app: automatically answer "what's next?"
- Group 1: Overdue (red indicator)
- Group 2: Due today with deadlines (time-sensitive)
- Group 3: Today's priorities (no deadline but marked for today)
- Group 4: Quick wins (estimated <15 min)
- Group 5: Backlog/someday

### Patterns to SKIP (team-oriented, not applicable)

- Team views and multi-user collaboration features
- Triage responsibility rotation
- Cross-team issue movement
- Cycle/sprint management (unless adapted for personal time-boxing)
- Estimate points system
- Initiative hierarchy (workspace > initiative > project > issue)

### Patterns to ADAPT (team concept, personal application)

| Linear Pattern | Personal Adaptation |
|---------------|-------------------|
| Team workspace | Life areas (Work, Personal, Creative, Health) |
| Cycles (sprints) | Weekly reviews / planning |
| Projects | Goals or multi-step projects |
| Issue statuses | Task statuses: Inbox > Todo > Doing > Done > Deferred |
| Priority levels | Energy levels: High-focus, Medium, Low-energy, Autopilot |
| Labels | Tags matching Todoist labels |
| Triage | Daily inbox processing ritual |
| My Issues "Focus" grouping | Smart "What's Next?" algorithm |

---

## Key Sources

- [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui) — Deep dive into their 2024 UI refresh
- [A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh) — Design philosophy behind the latest refresh
- [The UX Psychology Behind Linear's Speed Advantage](https://nimpatil.substack.com/p/the-ux-psychology-behind-linears) — Psychological mechanisms behind perceived speed
- [Linear Design: The SaaS design trend](https://blog.logrocket.com/ux-design/linear-design/) — Analysis of the "Linear design" movement
- [Invisible Details: Building contextual menus](https://linear.app/now/invisible-details) — Deep dive into micro-interaction craft
- [Karri Saarinen: 10 Rules for Crafting Products](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/) — Design philosophy from Linear's CEO
- [Lessons from Karri Saarinen](https://www.antoinebuteau.com/lessons-from-karri-saarinen-of-linear/) — Compiled principles from talks and interviews
- [Linear App Case Study: $400M Issue Tracker](https://www.eleken.co/blog-posts/linear-app-case-study) — Business and design strategy analysis
- [Linear Design System (Figma Community)](https://www.figma.com/community/file/1222872653732371433/linear-design-system) — Recreated design system components
- [Linear UI Free Kit (Figma Community)](https://www.figma.com/community/file/1279162640816574368/linear-ui-free-ui-kit-recreated) — Full UI kit recreation
- [Custom Views (Linear Docs)](https://linear.app/docs/custom-views) — Official docs on views and filtering
- [My Issues (Linear Docs)](https://linear.app/docs/my-issues) — Official docs on the personal hub
- [How to Build a Remarkable Command Palette (Superhuman)](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) — Command palette best practices
- [Reverse Engineering Linear (Header)](https://pustelto.com/blog/reverse-engineer-linear-1-header/) — Technical implementation details
- [Inside Linear: Craft and Focus (First Round Review)](https://review.firstround.com/podcast/inside-linear-why-craft-and-focus-still-win-in-product-building/) — Podcast on building philosophy
- [Linear Keyboard Shortcuts (Shortcuts.design)](https://shortcuts.design/tools/toolspage-linear/) — Complete shortcut reference
