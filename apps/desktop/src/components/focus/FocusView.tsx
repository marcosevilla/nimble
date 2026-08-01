import { useCallback } from 'react'
import { useFocusStore } from '@/stores/focusStore'
import { useFocusQueue } from '@/hooks/useFocusQueue'
import { cn } from '@/lib/utils'
import { Pause, Play, Check, SkipForward, Minimize2, X, Coffee } from 'lucide-react'
import { Button } from '@/components/ui/button'

function formatTime(seconds: number): string {
  const m = Math.floor(Math.abs(seconds) / 60)
  const s = Math.abs(seconds) % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function ProgressRing({ progress, size = 200, stroke = 4 }: { progress: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(Math.max(progress, 0), 1))

  return (
    <svg width={size} height={size} className="absolute inset-0 -rotate-90">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-muted/30"
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-accent-blue transition-[stroke-dashoffset] duration-1000 ease-linear"
      />
    </svg>
  )
}

export function FocusView() {
  const task = useFocusStore((s) => s.task)
  const config = useFocusStore((s) => s.config)
  const elapsed = useFocusStore((s) => s.elapsed)
  const pausedAt = useFocusStore((s) => s.pausedAt)
  const isOnBreak = useFocusStore((s) => s.isOnBreak)
  const breakElapsed = useFocusStore((s) => s.breakElapsed)
  const currentPomodoro = useFocusStore((s) => s.currentPomodoro)
  const pauseFocus = useFocusStore((s) => s.pauseFocus)
  const resumeFocus = useFocusStore((s) => s.resumeFocus)
  const completeFocus = useFocusStore((s) => s.completeFocus)
  const abandonFocus = useFocusStore((s) => s.abandonFocus)
  const skipFocus = useFocusStore((s) => s.skipFocus)
  const setCompact = useFocusStore((s) => s.setCompact)
  const startBreak = useFocusStore((s) => s.startBreak)
  const endBreak = useFocusStore((s) => s.endBreak)

  const nextTask = useFocusQueue(task)

  const isPaused = pausedAt !== null
  const isCountdown = config.timerMode === 'down'
  const targetSecs = config.targetMinutes * 60
  const remaining = isCountdown ? Math.max(targetSecs - elapsed, 0) : 0
  const displayTime = isCountdown ? remaining : elapsed
  const progress = isCountdown ? elapsed / targetSecs : 0

  // Auto-trigger break when countdown reaches 0
  const timerDone = isCountdown && elapsed >= targetSecs && !isOnBreak

  const handleComplete = useCallback(() => {
    completeFocus(nextTask)
  }, [completeFocus, nextTask])

  if (!task) return null

  // Break view
  if (isOnBreak) {
    const breakRemaining = Math.max(config.breakMinutes * 60 - breakElapsed, 0)
    return (
      <div className="flex flex-1 items-center justify-center animate-in fade-in duration-300">
        <div className="text-center space-y-6">
          <Coffee className="size-10 mx-auto text-muted-foreground" />
          <div>
            <h2 className="text-title">Take a break</h2>
            <p className="text-body text-muted-foreground mt-1">
              Round {currentPomodoro - 1} of {config.totalPomodoros} complete
            </p>
          </div>
          <div className="text-timer text-muted-foreground">
            {formatTime(breakRemaining)}
          </div>
          <Button variant="ghost" size="sm" onClick={endBreak}>
            Skip break
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center animate-in fade-in duration-300">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Timer */}
        <div className="relative mx-auto flex size-[200px] items-center justify-center">
          {isCountdown && <ProgressRing progress={progress} />}
          <span className={cn(
            'text-timer',
            isPaused && 'animate-pulse text-muted-foreground',
            timerDone && 'text-green-500',
          )}>
            {formatTime(displayTime)}
          </span>
        </div>

        {/* Pomodoro dots */}
        {config.totalPomodoros > 1 && (
          <div className="flex items-center justify-center gap-1.5">
            {Array.from({ length: config.totalPomodoros }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'size-2 rounded-full transition-colors',
                  i < currentPomodoro - 1
                    ? 'bg-green-500'
                    : i === currentPomodoro - 1
                      ? 'bg-accent-blue'
                      : 'bg-muted/40',
                )}
              />
            ))}
          </div>
        )}

        {/* Task info */}
        <div className="space-y-1">
          <h2 className="text-title">{task.content}</h2>
          {task.description && (
            <p className="text-body text-muted-foreground">{task.description}</p>
          )}
        </div>

        {/* Timer done prompt */}
        {timerDone && currentPomodoro < config.totalPomodoros && (
          <div className="rounded-lg bg-green-500/10 p-3 animate-in fade-in duration-300">
            <p className="text-body text-green-600 dark:text-green-400">
              Round {currentPomodoro} complete!
            </p>
            <Button size="sm" className="mt-2" onClick={startBreak}>
              Start break ({config.breakMinutes}m)
            </Button>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-2">
          {isPaused ? (
            <Button size="sm" onClick={resumeFocus} className="gap-1.5">
              <Play className="size-3.5" />
              Resume
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={pauseFocus} className="gap-1.5">
              <Pause className="size-3.5" />
              Pause
            </Button>
          )}
          <Button size="sm" onClick={handleComplete} className="gap-1.5 bg-green-600 hover:bg-green-700 text-white">
            <Check className="size-3.5" />
            Complete
          </Button>
          <Button size="sm" variant="ghost" onClick={skipFocus} className="gap-1.5 text-muted-foreground">
            <SkipForward className="size-3.5" />
            Skip
          </Button>
        </div>

        {/* Utility buttons */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setCompact(true)}
            className="flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground transition-colors"
          >
            <Minimize2 className="size-3" />
            Minimize
          </button>
          <button
            onClick={abandonFocus}
            className="flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3" />
            Stop
          </button>
        </div>
      </div>
    </div>
  )
}
