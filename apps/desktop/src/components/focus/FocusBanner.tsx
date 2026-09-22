import { useFocusStore } from '@/stores/focusStore'
import { cn } from '@/lib/utils'
import { Pause, Play, Square, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

function formatTime(seconds: number): string {
  const m = Math.floor(Math.abs(seconds) / 60)
  const s = Math.abs(seconds) % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function FocusBanner() {
  const task = useFocusStore((s) => s.task)
  const config = useFocusStore((s) => s.config)
  const elapsed = useFocusStore((s) => s.elapsed)
  const pausedAt = useFocusStore((s) => s.pausedAt)
  const isOnBreak = useFocusStore((s) => s.isOnBreak)
  const pauseFocus = useFocusStore((s) => s.pauseFocus)
  const resumeFocus = useFocusStore((s) => s.resumeFocus)
  const abandonFocus = useFocusStore((s) => s.abandonFocus)
  const setCompact = useFocusStore((s) => s.setCompact)

  if (!task) return null

  const isPaused = pausedAt !== null
  const isCountdown = config.timerMode === 'down'
  const remaining = isCountdown ? Math.max(config.targetMinutes * 60 - elapsed, 0) : 0
  const displayTime = isCountdown ? remaining : elapsed

  return (
    <div className="flex h-10 items-center gap-3 border-b border-border/50 bg-accent-blue/5 px-4 animate-in slide-in-from-top duration-200">
      {/* Timer */}
      <span className={cn(
        'font-mono text-body tabular-nums',
        isPaused && 'animate-pulse text-muted-foreground',
        isOnBreak && 'text-warning',
      )}>
        {formatTime(displayTime)}
      </span>

      {/* Task name */}
      <button
        onClick={() => setCompact(false)}
        className="flex-1 min-w-0 truncate text-left text-body hover:text-foreground transition-colors"
      >
        {isOnBreak ? 'Break' : task.content}
      </button>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {isPaused ? (
          <Button variant="ghost" size="icon-sm" onClick={resumeFocus} aria-label="Resume focus">
            <Play className="size-3.5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={pauseFocus} aria-label="Pause focus">
            <Pause className="size-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={abandonFocus} aria-label="Stop focus">
          <Square className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setCompact(false)} aria-label="Expand focus view">
          <Maximize2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
