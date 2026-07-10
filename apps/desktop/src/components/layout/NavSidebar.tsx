import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { useDetailStore } from '@/stores/detailStore'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import { Sun, CheckSquare, Inbox, FileText, Target, BookOpen, Settings, Command } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const MIN_WIDTH = 48
const MAX_WIDTH = 200
const COLLAPSE_THRESHOLD = 80 // below this = icon-only mode

// Icon map for nav items — lookup by page ID
const NAV_ICONS: Record<string, LucideIcon> = {
  today: Sun,
  tasks: CheckSquare,
  inbox: Inbox,
  docs: FileText,
  goals: Target,
  session: BookOpen,
}

const NAV_LABELS: Record<string, string> = {
  today: 'Today',
  tasks: 'Tasks',
  inbox: 'Inbox',
  docs: 'Docs',
  goals: 'Goals',
  session: 'Activity',
}

function NavButton({
  label,
  icon: Icon,
  isActive,
  expanded,
  onClick,
}: {
  label: string
  icon: LucideIcon
  isActive: boolean
  expanded: boolean
  onClick: () => void
}) {
  const buttonClasses = cn(
    'flex h-9 items-center rounded-lg transition-all duration-150 cursor-pointer',
    expanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
    isActive
      ? 'bg-accent/60 text-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-accent/20',
  )

  const content = (
    <>
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {expanded && (
        <span className="text-body-strong truncate">{label}</span>
      )}
    </>
  )

  if (expanded) {
    return (
      <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()} className={buttonClasses}>
        {content}
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger onClick={onClick} className={buttonClasses}>
        {content}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function SortableNavItem({
  id,
  isActive,
  expanded,
  onClick,
}: {
  id: string
  isActive: boolean
  expanded: boolean
  onClick: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const icon = NAV_ICONS[id]
  const label = NAV_LABELS[id]
  if (!icon || !label) return null

  const buttonClasses = cn(
    'flex h-9 items-center rounded-lg transition-all duration-150 cursor-pointer touch-none',
    expanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
    isActive
      ? 'bg-accent/60 text-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-accent/20',
    isDragging && 'opacity-60 shadow-md z-10',
  )

  const Icon = icon

  const content = (
    <>
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {expanded && (
        <span className="text-body-strong truncate">{label}</span>
      )}
    </>
  )

  if (expanded) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}
        className={buttonClasses}
      >
        {content}
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={onClick}
        className={buttonClasses}
      >
        {content}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function NavSidebar() {
  const currentPage = useAppStore((s) => s.currentPage)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)

  const width = useLayoutStore((s) => s.navWidth)
  const setNavWidth = useLayoutStore((s) => s.setNavWidth)
  const navOrder = useLayoutStore((s) => s.navOrder)
  const saveNavOrder = useLayoutStore((s) => s.saveNavOrder)

  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(MIN_WIDTH)

  const expanded = width >= COLLAPSE_THRESHOLD

  // Demo mode indicator — always visible while the throwaway db is active
  const dp = useDataProvider()
  const [demoMode, setDemoMode] = useState(false)
  useEffect(() => {
    dp.system.getDemoStatus().then(setDemoMode).catch(() => {})
  }, [dp])

  // Resize handle logic
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
      const delta = e.clientX - startX.current
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
      setNavWidth(newWidth)
    }
    function handleMouseUp() {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Snap to collapsed or expanded
      const current = useLayoutStore.getState().navWidth
      setNavWidth(current < COLLAPSE_THRESHOLD ? MIN_WIDTH : current)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, setNavWidth])

  const handleNavClick = useCallback((page: typeof currentPage) => {
    if (currentPage === page) {
      // Already on this page — if detail is open, close it (pop to root)
      const detail = useDetailStore.getState()
      if (detail.target) {
        detail.close()
      }
    } else {
      setCurrentPage(page)
    }
  }, [currentPage, setCurrentPage])

  // dnd-kit sensors — distance: 5 differentiates click from drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = navOrder.indexOf(active.id as string)
      const newIndex = navOrder.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return

      const newOrder = [...navOrder]
      newOrder.splice(oldIndex, 1)
      newOrder.splice(newIndex, 0, active.id as string)

      await saveNavOrder(newOrder)
    },
    [navOrder, saveNavOrder],
  )

  return (
    <nav
      className="relative flex flex-col border-r border-border/20 bg-muted/30 py-3"
      style={{ width }}
    >
      {/* Demo mode pill — click jumps to Settings to toggle off */}
      {demoMode && (
        <div className={cn('mb-2 flex', expanded ? 'px-2' : 'justify-center')}>
          <Tooltip>
            <TooltipTrigger
              className={cn(
                'flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-500/25',
                expanded ? 'px-2.5 py-1 text-label' : 'size-6 justify-center',
              )}
              onClick={() => setCurrentPage('settings')}
            >
              <span className="size-1.5 rounded-full bg-current animate-pulse" />
              {expanded && 'Demo'}
            </TooltipTrigger>
            <TooltipContent side="right">Demo mode — real data hidden. Click to manage.</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Sortable nav items */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={navOrder} strategy={verticalListSortingStrategy}>
          <div className={cn('flex flex-1 flex-col gap-1', expanded ? 'px-2' : 'items-center')}>
            {navOrder.map((id) => (
              <SortableNavItem
                key={id}
                id={id}
                isActive={currentPage === id}
                expanded={expanded}
                onClick={() => handleNavClick(id as typeof currentPage)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Bottom items — pinned, not sortable */}
      <div className={cn('mt-auto flex flex-col gap-1', expanded ? 'px-2' : 'items-center')}>
        <NavButton
          label="Command"
          icon={Command}
          isActive={false}
          expanded={expanded}
          onClick={() => {
            // Dispatch custom event that CommandBar listens for
            window.dispatchEvent(new Event('open-command-bar'))
          }}
        />
        <NavButton
          label="Settings"
          icon={Settings}
          isActive={currentPage === 'settings'}
          expanded={expanded}
          onClick={() => handleNavClick('settings')}
        />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute right-0 top-0 bottom-0 z-10 w-1 cursor-col-resize transition-colors',
          dragging ? 'bg-accent-blue/40' : 'hover:bg-accent-blue/20',
        )}
      />
    </nav>
  )
}
