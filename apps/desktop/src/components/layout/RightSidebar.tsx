import { useState, useCallback, useRef, useEffect } from 'react'
import { CalendarPanel } from '@/components/calendar/CalendarPanel'
import { useLayoutStore } from '@/stores/layoutStore'
import { IconButton } from '@/components/shared/IconButton'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Icon } from '@/components/shared/Icon'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'
import { HabitsSection } from '@/components/goals/HabitsSection'

const MIN_WIDTH = 200
const MAX_WIDTH = 480

export function RightSidebar() {
  const collapsed = useLayoutStore((s) => s.rightCollapsed)
  const setCollapsed = useLayoutStore((s) => s.setRightCollapsed)
  const width = useLayoutStore((s) => s.rightWidth)
  const setRightWidth = useLayoutStore((s) => s.setRightWidth)
  // Habits moved out of Today's primary lane into the rail (today P2-1,
  // §2.1 "habits + calendar live in collapsible sidebars").
  const showHabits = useAppStore((s) => s.currentPage === 'today')

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
      {/* Collapsed state — expand button */}
      {collapsed && (
        <div className="flex flex-col items-center py-3">
          <IconButton
            onClick={() => setCollapsed(false)}
            size="lg"
            title="Expand sidebar"
          >
            <Icon icon={PanelRightOpen} size="nav" />
          </IconButton>
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

          {/* Collapse button */}
          <div className="flex justify-end px-2 pt-2">
            <IconButton
              onClick={() => setCollapsed(true)}
              tone="subtle"
              title="Collapse sidebar"
            >
              <Icon icon={PanelRightClose} size="nav" />
            </IconButton>
          </div>
        </>
      )}

      {!collapsed && <div className="flex-1 overflow-y-auto flex flex-col min-h-0 [scrollbar-gutter:stable]">
        <div className="flex flex-col flex-1 min-h-0">
          {/* Schedule section */}
          <div className="p-4 pt-2 flex flex-col flex-1 min-h-0">
            <CalendarPanel />
          </div>
          {showHabits && (
            <div className="shrink-0 border-t border-border/30 p-4 min-w-0">
              <HabitsSection />
            </div>
          )}
        </div>
      </div>}
    </aside>
  )
}
