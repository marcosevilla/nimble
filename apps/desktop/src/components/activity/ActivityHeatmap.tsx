import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { localIsoDate } from '@/lib/briefDate'

const CELL_SIZE = 12
const CELL_GAP = 2
const STEP = CELL_SIZE + CELL_GAP
const MAX_WEEKS = 52
const MIN_WEEKS = 8
const DAYS = 7
const AMBER_LEVELS = [
  'transparent',
  'oklch(0.85 0.12 85 / 0.25)',   // intensity 1
  'oklch(0.78 0.14 80 / 0.45)',   // intensity 2
  'oklch(0.72 0.16 75 / 0.65)',   // intensity 3
  'oklch(0.65 0.17 70 / 0.85)',   // intensity 4+
]

function heatColor(value: number): string {
  if (value <= 0) return AMBER_LEVELS[0]
  if (value >= 4) return AMBER_LEVELS[4]
  return AMBER_LEVELS[value]
}

function formatCellDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface ActivityHeatmapProps {
  /** Activity per local `YYYY-MM-DD` date. */
  values: Record<string, number>
  /** What a cell says for its date, e.g. "2 check-ins". */
  describe: (date: string) => string
  /** Accessible name of the grid. */
  label: string
}

/**
 * A GitHub-style year grid, as many weeks as fit the container (8–52),
 * ending this week. One tab stop; arrows move a cursor cell (goals P2-8).
 */
export function ActivityHeatmap({ values, describe, label }: ActivityHeatmapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [weeks, setWeeks] = useState(MAX_WEEKS)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const fit = Math.floor((entry.contentRect.width + CELL_GAP) / STEP)
      setWeeks(Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, fit)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const grid = useMemo(() => {
    // Columns are Sunday-first weeks; the last column is this week.
    // Days after today in this week aren't drawn.
    const today = new Date()
    const todayIso = localIsoDate(today)
    const cells: { date: string; value: number; col: number; row: number }[] = []
    for (let w = weeks - 1; w >= 0; w--) {
      for (let d = 0; d < DAYS; d++) {
        const cellDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - w * 7 + d)
        const date = localIsoDate(cellDate)
        if (date > todayIso) break
        cells.push({ date, value: values[date] ?? 0, col: weeks - 1 - w, row: d })
      }
    }
    return cells
  }, [values, weeks])

  const monthLabels = useMemo(() => {
    const labels: { label: string; col: number }[] = []
    let lastMonth = -1
    for (const cell of grid) {
      if (cell.row !== 0) continue
      const [y, m] = cell.date.split('-').map(Number)
      if (m !== lastMonth) {
        lastMonth = m
        labels.push({ label: new Date(y, m - 1, 1).toLocaleString('default', { month: 'short' }), col: cell.col })
      }
    }
    // A label squeezed into the first column overlaps the next one.
    return labels.length > 1 && labels[1].col - labels[0].col < 3 ? labels.slice(1) : labels
  }, [grid])

  const [cursor, setCursor] = useState<number | null>(null)
  const [gridFocused, setGridFocused] = useState(false)
  const cursorIndex = Math.min(cursor ?? grid.length - 1, grid.length - 1)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowRight: DAYS, ArrowLeft: -DAYS, ArrowDown: 1, ArrowUp: -1 }
    if (e.key in step) {
      e.preventDefault()
      setCursor(Math.max(0, Math.min(grid.length - 1, cursorIndex + step[e.key])))
    } else if (e.key === 'Home') { e.preventDefault(); setCursor(0) }
    else if (e.key === 'End') { e.preventDefault(); setCursor(grid.length - 1) }
  }
  const focused = grid[cursorIndex]
  const cellLabel = (date: string) => `${formatCellDate(date)} · ${describe(date)}`

  const gridWidth = weeks * STEP - CELL_GAP
  const gridHeight = DAYS * STEP - CELL_GAP

  return (
    <div ref={wrapRef} className="w-full min-w-0">
      <div style={{ width: gridWidth }}>
        {/* Month labels — `relative` so the absolute spans anchor here, not the page (P2-4) */}
        <div className="relative mb-1" style={{ height: 14 }} aria-hidden>
          {monthLabels.map((m) => (
            <span
              key={`${m.label}-${m.col}`}
              className="text-label text-muted-foreground absolute"
              style={{ left: m.col * STEP }}
            >
              {m.label}
            </span>
          ))}
        </div>

        <div
          role="group"
          aria-label={`${label}, last ${weeks} weeks. Use the arrow keys to move between days.`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onFocus={() => setGridFocused(true)}
          onBlur={() => setGridFocused(false)}
          className="relative rounded-sm"
          style={{ width: gridWidth, height: gridHeight }}
        >
          {grid.map((cell, i) => (
            <div
              key={cell.date}
              title={cellLabel(cell.date)}
              className={cn('absolute rounded-xs', gridFocused && i === cursorIndex && 'outline-2 outline-ring outline-offset-1')}
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                left: cell.col * STEP,
                top: cell.row * STEP,
                backgroundColor: heatColor(cell.value),
                border: cell.value === 0 ? '1px solid oklch(from var(--border) l c h / 0.15)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Static cue for the cursor cell — also what assistive tech hears */}
        <p className="mt-1.5 text-label text-muted-foreground tabular-nums" aria-live="polite">
          {focused ? cellLabel(focused.date) : ''}
        </p>
      </div>
    </div>
  )
}
