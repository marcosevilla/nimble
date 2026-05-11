import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { HelpCircle, X, Keyboard, Map } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Label, Meta } from '@/components/shared/typography'

// ── Shortcuts data ──
interface ShortcutRow { key: string; action: string }
interface ShortcutSection { title: string; shortcuts: ShortcutRow[] }

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { key: '1-4', action: 'Jump to page' },
      { key: '\u2318K', action: 'Command bar' },
      { key: '\u2318,', action: 'Settings' },
    ],
  },
  {
    title: 'Tasks',
    shortcuts: [
      { key: 'j / \u2193', action: 'Next task' },
      { key: 'k / \u2191', action: 'Previous task' },
      { key: 'Q', action: 'Quick create task' },
    ],
  },
  {
    title: 'Focus',
    shortcuts: [
      { key: 'Space', action: 'Pause / resume' },
      { key: 'Escape', action: 'Minimize / stop' },
    ],
  },
  {
    title: 'Command Bar',
    shortcuts: [
      { key: '\u2325C', action: 'Complete task' },
      { key: '\u2325B', action: 'AI breakdown' },
      { key: '\u2325M', action: 'Move to project' },
      { key: '/task', action: 'Force create mode' },
      { key: '/capture', action: 'Force note mode' },
      { key: '/doc', action: 'Search docs' },
      { key: '/search', action: 'Force search mode' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { key: 'Click', action: 'Select / deselect item' },
      { key: 'Shift+Click', action: 'Select range' },
      { key: 'Escape', action: 'Clear selection' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { key: '\u2318R', action: 'Refresh all data' },
      { key: '\u2318\u21E7T', action: 'Toggle window' },
      { key: 'Escape', action: 'Close detail view' },
    ],
  },
]

// ── Roadmap data ──
interface RoadmapItem {
  title: string
  description: string
  done: boolean
  phase?: string
}

const ROADMAP: RoadmapItem[] = [
  // Done
  { title: 'Activity Log', description: 'Timestamps every action, powers reflection', done: true },
  { title: 'Command Bar', description: 'Cmd+K overlay with search, create, capture, AI breakdown', done: true },
  { title: 'Focus Mode', description: 'Pomodoro timer, celebration, auto-queue next task', done: true },
  { title: 'Activity Timeline', description: 'Browse daily activity with summary stats', done: true },
  { title: 'Task Detail Page', description: 'Body + sidebar modes, inline editing, breadcrumbs', done: true },
  { title: 'Task Status System', description: 'Backlog → Todo → In Progress → Blocked → Complete', done: true },
  { title: 'Mutable Inbox', description: 'Native tasks + notes with actions', done: true },
  { title: 'Resizable Sidebars', description: 'Drag to resize nav + right sidebar', done: true },

  // Near-term
  { title: 'Notes Migration', description: 'Move notes to SQLite, note detail page, import from Obsidian', done: true },
  { title: 'Status Colors Reference', description: 'Status color assignments visible in Settings', done: true },
  { title: 'Focus Abandon Setting', description: 'Configure default status when abandoning focus', done: true },
  { title: 'Task Filtering by Status', description: 'Filter/sort tasks page by status pills', done: true },
  { title: 'Bulk Select + Actions', description: 'Shift+click range select, floating action bar', done: true },

  // Phase A
  { title: 'Daily Brief Display', description: 'Render daily brief with date browsing, formatted to match app UI', done: false, phase: 'A: Morning' },
  { title: 'Mood Tracker', description: 'Track mood over time, integrate with phone mood apps, power AI reflection', done: false, phase: 'A: Morning' },
  { title: 'Smart Capture Routing', description: '/idea and /quote routing to Docs page (after Docs is built)', done: false, phase: 'A: Morning' },

  // Phase B
  { title: 'Evening Review Flow', description: 'Guided reflection: accomplishments, questions, energy, affirmation', done: false, phase: 'B: Evening' },
  { title: 'Energy Trends', description: '30-90 day sparkline, best days analysis', done: false, phase: 'B: Evening' },

  // Phase C
  { title: 'Bingo Card View', description: 'Visual 5x5 grid of 2026 goals', done: false, phase: 'C: Goals' },
  { title: 'Resolutions Compass', description: 'Keywords + rules from resolutions file', done: false, phase: 'C: Goals' },
  { title: 'Habit Unification', description: 'One canonical habit source, checkable from app', done: false, phase: 'C: Goals' },

  // Phase D
  { title: 'Linear Tickets', description: 'Show assigned Linear tickets with status badges', done: false, phase: 'D: Work' },
  { title: 'Needs Response Queue', description: 'Urgent Slack/email items ranked by priority', done: false, phase: 'D: Work' },
  { title: 'Telegram Capture Sync', description: 'Show Telegram captures in Inbox', done: false, phase: 'D: Work' },

  // Phase E
  { title: 'Multi-device Sync', description: 'Sync via Obsidian vault or cloud SQLite', done: false, phase: 'E: Infra' },
  { title: 'Native Notifications', description: 'Meeting reminders, evening nudge, open tasks', done: false, phase: 'E: Infra' },
  { title: '.dmg Distribution', description: 'Signed build, auto-updater via GitHub Releases', done: false, phase: 'E: Infra' },

  // Docs
  { title: 'Docs Page', description: 'Folder tree + Tiptap rich text editor with auto-save', done: true },
  { title: 'Rich Text Editor', description: 'Markdown shortcuts, headings, bold, lists, code, links', done: true },
  { title: 'Doc Search in Command Bar', description: '/doc prefix searches docs by title + content', done: true },
  { title: 'Move to Docs Action', description: 'Triage notes from Inbox to Docs once processed', done: false, phase: 'F: Docs' },
  { title: 'Project-linked Docs', description: 'Optionally link documents to a project for context', done: false, phase: 'F: Docs' },
  { title: 'Export to Obsidian', description: 'One-way push any doc to vault as .md file', done: false, phase: 'F: Docs' },
  { title: 'AI Artifacts in Docs', description: 'Save AI breakdowns, reflections, and prep docs', done: false, phase: 'F: Docs' },

  // Brief v2: Living Daily Workspace
  { title: 'Time-blocking / Day Planner', description: 'Drag tasks onto calendar timeline, auto-set in_progress when block starts', done: false, phase: 'G: Brief v2' },
  { title: 'Live Habit Streaks', description: 'Show streak counts + mini heatmap, checking off updates everywhere', done: false, phase: 'G: Brief v2' },
  { title: 'Interactive Triage Cards', description: 'Swipeable overdue/needs-response cards — snooze, complete, delegate, schedule', done: false, phase: 'G: Brief v2' },
  { title: 'Energy-aware Suggestions', description: 'Brief adapts by time of day — morning full view, afternoon remaining, evening reflection', done: false, phase: 'G: Brief v2' },
  { title: 'Meeting Prep Blocks', description: 'Auto-show context before each meeting — Linear tickets, Slack threads, last notes', done: false, phase: 'G: Brief v2' },
  { title: 'Live Progress Pulse', description: 'Brief updates in real-time — completion bar, time focused, what\'s left', done: false, phase: 'G: Brief v2' },
  { title: 'Tomorrow Planning Mode', description: 'End-of-day view: drag tasks into tomorrow\'s time slots, set top 3, pre-configure focus', done: false, phase: 'G: Brief v2' },
  { title: 'Brief Diff', description: 'Historical view showing intention vs reality — planned vs completed vs added', done: false, phase: 'G: Brief v2' },

  // Ideas
  { title: 'AI Reflection', description: 'Weekly trends, dropoff analysis, pattern recognition', done: false, phase: 'Ideas' },
  { title: 'AI Next-task Picker', description: 'Claude picks next task based on energy + context', done: false, phase: 'Ideas' },
  { title: 'Full-page Detail Mode', description: 'Third display mode for task detail', done: false, phase: 'Ideas' },
  { title: 'Bulk Actions Extensions', description: 'AI breakdown on multiple tasks, bulk priority, bulk due date', done: false, phase: 'Ideas' },
]

// ── Component ──

export function HelpPanel() {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const doneCount = ROADMAP.filter((r) => r.done).length
  const totalCount = ROADMAP.length

  const closePanel = () => {
    setClosing(true)
    setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 150)
  }

  // Click outside to close
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel()
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => {
          if (open) closePanel()
          else setOpen(true)
        }}
        className={cn(
          'fixed bottom-4 right-4 z-30 flex size-9 items-center justify-center rounded-full transition-all duration-200',
          'bg-muted/60 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground hover:shadow-md',
          'backdrop-blur-sm border border-border/20',
          open && 'bg-muted text-muted-foreground shadow-md',
          'before:absolute before:inset-[-2px] before:content-[\'\'] before:rounded-full',
        )}
      >
        {open ? <X className="size-4" /> : <HelpCircle className="size-4" />}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className={cn(
            'fixed bottom-16 right-4 z-30 transition-all duration-150 origin-bottom-right',
            closing
              ? 'opacity-0 scale-95'
              : 'help-panel-enter',
          )}
        >
          <div className="w-80 max-h-[50vh] flex flex-col rounded-xl border border-border/30 bg-popover shadow-xl shadow-black/10 overflow-hidden">
            <Tabs defaultValue="shortcuts" className="flex flex-col gap-0 min-h-0">
              {/* Tab switcher */}
              <div className="border-b border-border/20 px-1 pt-1 shrink-0">
                <TabsList variant="line" className="h-auto gap-0 bg-transparent p-0">
                  <TabsTrigger value="shortcuts" className="gap-1.5 rounded-t-lg rounded-b-none px-3 py-2 text-meta">
                    <Keyboard className="size-3" />
                    Shortcuts
                  </TabsTrigger>
                  <TabsTrigger value="roadmap" className="gap-1.5 rounded-t-lg rounded-b-none px-3 py-2 text-meta">
                    <Map className="size-3" />
                    Roadmap
                    <span className="text-label text-muted-foreground/50 tabular-nums">{doneCount}/{totalCount}</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Content */}
              <div className="overflow-y-auto p-3">
                <TabsContent value="shortcuts">
                  <ShortcutsTab />
                </TabsContent>
                <TabsContent value="roadmap">
                  <RoadmapTab showDone={showDone} setShowDone={setShowDone} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      )}
    </>
  )
}

// ── Shortcuts tab ──

function ShortcutsTab() {
  return (
    <div className="space-y-4">
      {SHORTCUT_SECTIONS.map((section) => (
        <div key={section.title}>
          <Label as="h3" className="mb-1.5 text-muted-foreground/50">
            {section.title}
          </Label>
          <div className="space-y-1">
            {section.shortcuts.map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between py-0.5">
                <Meta>{shortcut.action}</Meta>
                <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-label text-foreground/70">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Roadmap tab ──

function RoadmapTab({ showDone, setShowDone }: { showDone: boolean; setShowDone: (v: boolean) => void }) {
  const items = showDone ? ROADMAP : ROADMAP.filter((r) => !r.done)

  // Group by phase
  const groups: Record<string, RoadmapItem[]> = {}
  for (const item of items) {
    const key = item.done ? 'Completed' : (item.phase ?? 'Other')
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-label text-muted-foreground/50">
          {ROADMAP.filter((r) => !r.done).length} remaining
        </span>
        <button
          onClick={() => setShowDone(!showDone)}
          className="text-label text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          {showDone ? 'Hide completed' : 'Show completed'}
        </button>
      </div>

      {Object.entries(groups).map(([phase, phaseItems]) => (
        <div key={phase}>
          <h3 className={cn(
            'mb-1.5 text-label',
            phase === 'Completed' ? 'text-green-500/50' : 'text-muted-foreground/50',
          )}>
            {phase}
          </h3>
          <div className="space-y-1.5">
            {phaseItems.map((item) => (
              <div key={item.title} className="flex items-start gap-2">
                <span className={cn(
                  'mt-1 size-1.5 shrink-0 rounded-full',
                  item.done ? 'bg-green-500/40' : 'bg-muted-foreground/20',
                )} />
                <div className="min-w-0">
                  <p className={cn(
                    'text-label',
                    item.done && 'text-muted-foreground line-through',
                  )}>
                    {item.title}
                  </p>
                  <p className="text-label text-muted-foreground/50">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
