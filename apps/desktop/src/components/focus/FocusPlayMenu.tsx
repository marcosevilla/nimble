import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useFocusStore, type FocusConfig } from '@/stores/focusStore'
import { useDataProvider } from '@/services/provider-context'
import { Play, Timer, TrendingUp } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { LocalTask } from '@nimble/types'

const COUNTDOWN_OPTIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 25, label: '25 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '60 min' },
]

const ROUND_OPTIONS = [1, 2, 3, 4]

interface FocusPlayMenuProps {
  task: LocalTask
  onOpenChange?: (open: boolean) => void
}

export function FocusPlayMenu({ task, onOpenChange }: FocusPlayMenuProps) {
  const dp = useDataProvider()
  const [open, setOpenState] = useState(false)
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    onOpenChange?.(v)
  }, [onOpenChange])
  const [breakMinutes, setBreakMinutes] = useState(5)
  const startFocus = useFocusStore((s) => s.startFocus)

  // Load break length default from settings
  useEffect(() => {
    if (open) {
      dp.settings.get('focus_break_minutes').then((val) => {
        if (val) setBreakMinutes(parseInt(val, 10) || 5)
      }).catch(() => {})
    }
  }, [open, dp])

  const handleStart = useCallback((config: FocusConfig) => {
    startFocus(task, config)
    setOpen(false)
  }, [task, startFocus, setOpen])

  const handleStopwatch = useCallback(() => {
    handleStart({ timerMode: 'up', targetMinutes: 0, breakMinutes: 0, totalPomodoros: 1 })
  }, [handleStart])

  const handleCountdown = useCallback((minutes: number, rounds: number) => {
    handleStart({ timerMode: 'down', targetMinutes: minutes, breakMinutes, totalPomodoros: rounds })
  }, [handleStart, breakMinutes])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex size-6 items-center justify-center rounded-md transition-colors',
          'text-accent-blue/60 hover:text-accent-blue hover:bg-accent/20',
        )}
      >
        <Play className="size-3" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="end"
        sideOffset={4}
        className="w-44"
      >
        {/* Countdown options with rounds sub-menus */}
        {COUNTDOWN_OPTIONS.map((opt) => (
          <DropdownMenuSub key={opt.minutes}>
            <DropdownMenuSubTrigger
              className="gap-2"
              onClick={() => handleCountdown(opt.minutes, 1)}
            >
              <Timer className="size-3.5 text-muted-foreground" />
              <span className="flex-1 text-left">{opt.label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-32">
              <DropdownMenuItem onClick={() => handleCountdown(opt.minutes, 1)}>
                No breaks
              </DropdownMenuItem>
              {ROUND_OPTIONS.filter((r) => r > 1).map((rounds) => (
                <DropdownMenuItem
                  key={rounds}
                  onClick={() => handleCountdown(opt.minutes, rounds)}
                >
                  {rounds} rounds
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}

        <DropdownMenuSeparator />

        {/* Stopwatch option */}
        <DropdownMenuItem className="gap-2" onClick={handleStopwatch}>
          <TrendingUp className="size-3.5 text-muted-foreground" />
          <span>Stopwatch</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
