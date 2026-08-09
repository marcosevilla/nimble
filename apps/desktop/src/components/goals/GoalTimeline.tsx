import { useRef, useEffect, useMemo, useCallback } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { GoalWithProgress, LifeArea } from '@nimble/types'

const DAY_WIDTH = 3
const ROW_HEIGHT = 40
const BAR_HEIGHT = 24
const HEADER_HEIGHT = 52
const LEFT_PANEL_WIDTH = 200
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  const diff = date.getTime() - start.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function getDaysInYear(year: number): number {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365
}

function getMonthStartDays(year: number): { month: string; startDay: number; days: number }[] {
  return MONTH_NAMES.map((month, i) => {
    const start = new Date(year, i, 1)
    const days = new Date(year, i + 1, 0).getDate()
    return { month, startDay: getDayOfYear(start), days }
  })
}

interface GoalTimelineProps {
  goals: GoalWithProgress[]
  lifeAreas: LifeArea[]
  onGoalClick: (goalId: string) => void
}

export function GoalTimeline({ goals, lifeAreas, onGoalClick }: GoalTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const year = new Date().getFullYear()
  const totalDays = getDaysInYear(year)
  const totalWidth = totalDays * DAY_WIDTH
  const months = useMemo(() => getMonthStartDays(year), [year])

  const areaMap = useMemo(() => {
    const map: Record<string, LifeArea> = {}
    for (const a of lifeAreas) map[a.id] = a
    return map
  }, [lifeAreas])

  // Auto-scroll to today on mount
  useEffect(() => {
    if (!scrollRef.current) return
    const todayOffset = getDayOfYear(new Date()) * DAY_WIDTH
    const containerWidth = scrollRef.current.clientWidth
    scrollRef.current.scrollLeft = Math.max(0, todayOffset - containerWidth / 2)
  }, [])

  const todayX = getDayOfYear(new Date()) * DAY_WIDTH

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Arrow navigation could be added here
    if (e.key === 'ArrowLeft' && scrollRef.current) {
      scrollRef.current.scrollLeft -= 100
    }
    if (e.key === 'ArrowRight' && scrollRef.current) {
      scrollRef.current.scrollLeft += 100
    }
  }, [])

  if (goals.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-body text-muted-foreground">
          No goals with dates to show on the timeline.
        </p>
      </div>
    )
  }

  // Filter to goals that have at least a start or target date
  const timelineGoals = goals.filter((g) => g.start_date || g.target_date)

  return (
    <div
      className="flex rounded-lg border border-border/20 overflow-hidden bg-card"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Goals timeline"
    >
      {/* Fixed left panel — goal names */}
      <div
        className="shrink-0 border-r border-border/20 bg-muted/20"
        style={{ width: LEFT_PANEL_WIDTH }}
      >
        <div className="h-[52px] border-b border-border/20 px-3 flex items-end pb-2">
          <span className="text-label text-muted-foreground">Goals</span>
        </div>
        {timelineGoals.map((goal) => {
          const area = goal.life_area_id ? areaMap[goal.life_area_id] : null
          return (
            <div
              key={goal.id}
              className="flex items-center gap-2 px-3 border-b border-border/10 cursor-pointer hover:bg-accent/10 transition-colors"
              style={{ height: ROW_HEIGHT }}
              onClick={() => onGoalClick(goal.id)}
            >
              {area && (
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: area.color }}
                />
              )}
              <span className="text-meta truncate">{goal.name}</span>
            </div>
          )
        })}
      </div>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div style={{ width: totalWidth, minHeight: HEADER_HEIGHT + timelineGoals.length * ROW_HEIGHT }} className="relative">
          {/* Month headers */}
          <div className="sticky top-0 z-10 bg-card border-b border-border/20" style={{ height: HEADER_HEIGHT }}>
            <div className="flex" style={{ height: 26 }}>
              {months.map((m) => (
                <div
                  key={m.month}
                  className="text-label text-muted-foreground px-1 pt-1.5 border-l border-border/10 first:border-l-0"
                  style={{ width: m.days * DAY_WIDTH }}
                >
                  {m.month}
                </div>
              ))}
            </div>
            {/* Week markers */}
            <div className="relative" style={{ height: 26 }}>
              {Array.from({ length: 53 }, (_, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full border-l border-border/5"
                  style={{ left: i * 7 * DAY_WIDTH }}
                />
              ))}
            </div>
          </div>

          {/* Today marker */}
          <div
            className="absolute z-20 top-0"
            style={{ left: todayX, height: HEADER_HEIGHT + timelineGoals.length * ROW_HEIGHT }}
          >
            <div className="w-px h-full bg-amber-500/60" />
            <div className="absolute top-1 -translate-x-1/2 bg-amber-500 text-label font-semibold text-white px-1.5 py-0.5 rounded-full whitespace-nowrap">
              {/* font-semibold kept for legibility on colored pill */}
              Today
            </div>
          </div>

          {/* Goal bars */}
          {timelineGoals.map((goal, i) => {
            const area = goal.life_area_id ? areaMap[goal.life_area_id] : null
            const barColor = goal.color || area?.color || '#f59e0b'

            // Calculate positions
            const startDate = goal.start_date
              ? new Date(goal.start_date)
              : new Date(year, 0, 1)
            const endDate = goal.target_date
              ? new Date(goal.target_date)
              : new Date(year, 11, 31)

            const startDay = startDate.getFullYear() === year
              ? getDayOfYear(startDate)
              : startDate.getFullYear() < year ? 1 : totalDays
            const endDay = endDate.getFullYear() === year
              ? getDayOfYear(endDate)
              : endDate.getFullYear() > year ? totalDays : 1

            const x = startDay * DAY_WIDTH
            const width = Math.max((endDay - startDay) * DAY_WIDTH, 12)
            const y = HEADER_HEIGHT + i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2
            const progressWidth = width * (goal.progress / 100)

            return (
              <Tooltip key={goal.id}>
                <TooltipTrigger
                  className="absolute cursor-pointer group/bar"
                  style={{ left: x, top: y, width, height: BAR_HEIGHT }}
                  onClick={() => onGoalClick(goal.id)}
                >
                  {/* Background bar */}
                  <div
                    className="absolute inset-0 rounded-xl opacity-20 group-hover/bar:opacity-30 transition-opacity"
                    style={{ backgroundColor: barColor }}
                  />
                  {/* Progress fill */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-xl transition-all duration-300"
                    style={{
                      width: progressWidth,
                      backgroundColor: barColor,
                      opacity: 0.6,
                    }}
                  />
                  {/* Bar label (show if wide enough) */}
                  {width > 60 && (
                    <span className="absolute inset-0 flex items-center px-2 text-label truncate" style={{ color: barColor }}>
                      {goal.name}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="text-meta">
                    <div className="font-medium">{goal.name}</div>
                    <div className="opacity-70">{goal.progress}% complete</div>
                    {goal.milestone_count > 0 && (
                      <div className="opacity-70">{goal.milestone_completed}/{goal.milestone_count} milestones</div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}

          {/* Row dividers */}
          {timelineGoals.map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-b border-border/5"
              style={{ top: HEADER_HEIGHT + (i + 1) * ROW_HEIGHT }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
