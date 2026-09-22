import { useEffect, useCallback } from 'react'
import { useFocusStore } from '@/stores/focusStore'
import { playCompletionSound } from '@/lib/sound'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// Generate random confetti particles
const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * 360
  const distance = 60 + Math.random() * 40
  const size = 4 + Math.random() * 4
  const delay = Math.random() * 0.15
  // Theme tokens at three opacities (session P1-4) so the burst re-themes
  // with the palette instead of spraying Tailwind's cool 500s on a warm page.
  const colors = [
    'var(--success)',
    'var(--accent-blue)',
    'var(--foreground)',
    'oklch(from var(--success) l c h / 0.6)',
    'oklch(from var(--accent-blue) l c h / 0.6)',
    'oklch(from var(--foreground) l c h / 0.35)',
  ]
  const color = colors[i % colors.length]
  return { angle, distance, size, delay, color }
})

export function FocusCelebration() {
  const completedDuration = useFocusStore((s) => s.completedDuration)
  const task = useFocusStore((s) => s.task)
  const nextTask = useFocusStore((s) => s.nextTask)
  const dismissCelebration = useFocusStore((s) => s.dismissCelebration)
  const endCelebration = useFocusStore((s) => s.endCelebration)
  const parkCelebration = useFocusStore((s) => s.parkCelebration)

  // Play sound on mount
  useEffect(() => {
    playCompletionSound()
  }, [])

  // Auto-dismiss after 2.5 seconds: the next task lands in the banner,
  // paused — surfaced, never started unattended (session P1-2, §2.4).
  useEffect(() => {
    const timeout = setTimeout(parkCelebration, 2500)
    return () => clearTimeout(timeout)
  }, [parkCelebration])

  // Escape and a stray click end the session; only Enter commits to the
  // next task. Space follows Enter (it is "confirm" everywhere else here).
  const handleEnd = useCallback(() => { endCelebration() }, [endCelebration])
  const handleNext = useCallback(() => { dismissCelebration() }, [dismissCelebration])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handleEnd() }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleNext() }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [handleEnd, handleNext])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Session complete"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleEnd}
    >
      <div className="relative text-center space-y-4">
        {/* Confetti particles */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                animation: `confetti-burst 800ms cubic-bezier(0.22, 1, 0.36, 1) ${p.delay}s forwards`,
                '--confetti-x': `${Math.cos((p.angle * Math.PI) / 180) * p.distance}px`,
                '--confetti-y': `${Math.sin((p.angle * Math.PI) / 180) * p.distance}px`,
              } as React.CSSProperties}
            />
          ))}
        </div>

        {/* Checkmark */}
        <div className="relative mx-auto flex size-20 items-center justify-center rounded-full timer-glow">
          <svg viewBox="0 0 24 24" className="size-10 text-success">
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="checkmark-draw"
            />
          </svg>
        </div>

        {/* Task name */}
        <p className="text-title line-through text-muted-foreground animate-in fade-in duration-500">
          {task?.content}
        </p>

        {/* Duration */}
        {completedDuration != null && (
          <p className="text-body text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-500">
            Focused for {formatDuration(completedDuration)}
          </p>
        )}

        {/* Next task preview — shown, not started */}
        {nextTask ? (
          <p className="text-meta text-muted-foreground animate-in fade-in duration-700">
            Next: <span className="text-foreground">{nextTask.content}</span>
            {' — '}
            <kbd className="rounded bg-muted/60 px-1 font-mono text-label">Enter</kbd> to start,{' '}
            <kbd className="rounded bg-muted/60 px-1 font-mono text-label">Esc</kbd> to stop here
          </p>
        ) : (
          <p className="text-meta text-muted-foreground animate-in fade-in duration-700">
            <kbd className="rounded bg-muted/60 px-1 font-mono text-label">Enter</kbd> or{' '}
            <kbd className="rounded bg-muted/60 px-1 font-mono text-label">Esc</kbd> to close
          </p>
        )}
      </div>
    </div>
  )
}
