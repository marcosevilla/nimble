import { useState, useCallback, useRef, useEffect } from 'react'
import { useDetailStore } from '@/stores/detailStore'
import { TaskDetailPage } from './TaskDetailPage'
import { CaptureDetailPage } from './CaptureDetailPage'
import { GoalDetailPage } from './GoalDetailPage'
import { IconButton } from '@/components/shared/IconButton'
import { cn } from '@/lib/utils'
import { Maximize2, X } from 'lucide-react'

const MIN_WIDTH = 280
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 320

export function DetailSidebar() {
  const switchMode = useDetailStore((s) => s.switchMode)
  const close = useDetailStore((s) => s.close)
  const target = useDetailStore((s) => s.target)

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(DEFAULT_WIDTH)

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
      const delta = startX.current - e.clientX
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta)))
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
  }, [dragging])

  if (!target) return null

  return (
    <aside
      className="relative flex flex-col border-l border-border/20 bg-muted/10 overflow-hidden"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize transition-colors',
          dragging ? 'bg-accent-blue/40' : 'hover:bg-accent-blue/20',
        )}
      />

      {/* Sidebar header */}
      <div className="flex items-center justify-between border-b border-border/20 px-3 py-2">
        <span className="text-label text-muted-foreground">
          {target.type === 'task' ? 'Task' : target.type === 'goal' ? 'Goal' : 'Note'}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={() => switchMode('body')}
            title="Expand to full view"
          >
            <Maximize2 className="size-3.5" />
          </IconButton>
          <IconButton
            onClick={close}
            title="Close"
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4">
        {target.type === 'task' ? <TaskDetailPage /> : target.type === 'goal' ? <GoalDetailPage /> : <CaptureDetailPage />}
      </div>
    </aside>
  )
}
