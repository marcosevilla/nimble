import { useState, useCallback, useRef, useEffect } from 'react'
import { CalendarPanel } from '@/components/calendar/CalendarPanel'
import { RIGHT_TABS, useLayoutStore, type RightTab } from '@/stores/layoutStore'
import { IconButton } from '@/components/shared/IconButton'
import { Activity, CalendarDays, PanelRightClose, PanelRightOpen, Sparkles, Timer, type LucideIcon } from 'lucide-react'
import { Icon } from '@/components/shared/Icon'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HabitsSection } from '@/components/goals/HabitsSection'
import { ActivityPanel } from '@/components/activity/ActivityPanel'
import { FocusRailPanel } from '@/components/focus/FocusRailPanel'
import { useGoalsStore } from '@/stores/goalsStore'
import { habitProgress } from '@/lib/habitToggle'

const MIN_WIDTH = 200
const MAX_WIDTH = 480

const TAB_META: Record<RightTab, { label: string; icon: LucideIcon }> = {
  calendar: { label: 'Calendar', icon: CalendarDays },
  habits: { label: 'Habits', icon: Sparkles },
  activity: { label: 'Activity', icon: Activity },
  focus: { label: 'Focus queue', icon: Timer },
}

/** Scrolling body shared by the non-calendar tabs. */
const PANEL_CLASS = 'flex-1 min-h-0 overflow-y-auto p-4 pt-3 [scrollbar-gutter:stable]'

export function RightSidebar() {
  const collapsed = useLayoutStore((s) => s.rightCollapsed)
  const setCollapsed = useLayoutStore((s) => s.setRightCollapsed)
  const width = useLayoutStore((s) => s.rightWidth)
  const setRightWidth = useLayoutStore((s) => s.setRightWidth)
  // One tabbed column on every page that has it (Agentation pass 1):
  // Calendar, Habits, Activity and the Focus queue.
  const tab = useLayoutStore((s) => s.rightTab)
  const setTab = useLayoutStore((s) => s.setRightTab)
  const openTab = useLayoutStore((s) => s.openRightTab)

  // Today's habit count on the Habits tab, so it's visible from Calendar
  // (re-score goals N-P1-1). The tab panel loads habits too; the store's
  // load gate only ever applies the latest reload, so the duplicate call
  // is safe.
  const habits = useGoalsStore((s) => s.habits)
  const loadHabits = useGoalsStore((s) => s.loadHabits)
  useEffect(() => { loadHabits() }, [loadHabits])
  const habitCount = habitProgress(habits)

  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(width)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    startX.current = e.clientX
    startWidth.current = width
  }, [width])

  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    function handleMouseMove(e: MouseEvent) {
      const delta = startX.current - e.clientX // dragging left = wider
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
      setRightWidth(newWidth)
    }
    function handleMouseUp() {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, setRightWidth])

  return (
    <aside
      className="relative flex flex-col border-l border-secondary bg-background overflow-hidden transition-[width] duration-(--transition-slow) ease-(--ease-entrance)"
      style={{ width: collapsed ? 36 : width }}
    >
      {/* Collapsed state — expand button, then one button per tab */}
      {collapsed && (
        <div className="flex flex-col items-center gap-1 py-3">
          <IconButton
            onClick={() => setCollapsed(false)}
            size="lg"
            title="Expand sidebar"
          >
            <Icon icon={PanelRightOpen} size="nav" />
          </IconButton>
          <div className="my-1 h-px w-5 bg-border/40" aria-hidden />
          {RIGHT_TABS.map((id) => (
            <IconButton
              key={id}
              onClick={() => openTab(id)}
              size="lg"
              className={cn(id === tab && 'bg-hover text-foreground')}
              title={TAB_META[id].label}
              aria-label={`Open ${TAB_META[id].label}`}
            >
              <Icon icon={TAB_META[id].icon} size="nav" />
            </IconButton>
          ))}
        </div>
      )}

      {/* Expanded state */}
      {!collapsed && (
        <>
          {/* Resize handle */}
          <div
            onMouseDown={handleMouseDown}
            className={cn(
              'absolute left-0 top-0 bottom-0 z-10 w-px cursor-col-resize transition-colors bg-border/30',
              dragging ? 'bg-accent-blue/50 w-1' : 'hover:bg-accent-blue/30 hover:w-1',
            )}
          />

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as RightTab)}
            className="flex-1 min-h-0 gap-0"
          >
            {/* Tabs, then the collapse button on the right. The active tab
                shows its label; the others are icons with a tooltip. */}
            <div className="flex items-center gap-2 px-3 pt-2">
              <TabsList aria-label="Sidebar views">
                {RIGHT_TABS.map((id) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    title={TAB_META[id].label}
                    className="flex-none px-2 text-meta"
                  >
                    <Icon icon={TAB_META[id].icon} />
                    <span className={cn(id === tab ? 'inline' : 'sr-only')}>{TAB_META[id].label}</span>
                    {id === 'habits' && habitCount.total > 0 && (
                      <span className="text-label tabular-nums text-muted-foreground">
                        <span aria-hidden="true">{habitCount.done}/{habitCount.total}</span>
                        <span className="sr-only">{habitCount.done} of {habitCount.total} done today</span>
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              <IconButton
                onClick={() => setCollapsed(true)}
                tone="subtle"
                title="Collapse sidebar"
                className="ml-auto"
              >
                <Icon icon={PanelRightClose} size="nav" />
              </IconButton>
            </div>

            <TabsContent value="calendar" className="flex flex-1 min-h-0 flex-col p-4 pt-3">
              <CalendarPanel />
            </TabsContent>
            <TabsContent value="habits" className={PANEL_CLASS}>
              <HabitsSection />
            </TabsContent>
            <TabsContent value="activity" className={PANEL_CLASS}>
              <ActivityPanel />
            </TabsContent>
            <TabsContent value="focus" className={PANEL_CLASS}>
              <FocusRailPanel />
            </TabsContent>
          </Tabs>
        </>
      )}
    </aside>
  )
}
