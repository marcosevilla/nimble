import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { openSettings } from '@/stores/settingsNavStore'
import { NAV_MAX_WIDTH, NAV_MIN_WIDTH, useLayoutStore, type NavTreeId } from '@/stores/layoutStore'
import { useDetailStore } from '@/stores/detailStore'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import { Sun, CheckSquare, Inbox, FileText, Target, Settings, Command, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { IconButton } from '@/components/shared/IconButton'
import { NavDocsTree, NavTasksTree } from './NavTrees'
import { NimbleMark } from './NimbleMark'
import { Collapse } from '@/components/shared/Collapse'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '@/components/shared/Icon'
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

const MIN_WIDTH = NAV_MIN_WIDTH
const MAX_WIDTH = NAV_MAX_WIDTH
const COLLAPSE_THRESHOLD = 80 // below this = icon-only mode
const SNAP_COLLAPSE_BELOW = 120 // a drag released below this snaps to icons
const MIN_EXPANDED = 160 // narrowest labeled nav that still fits the trees

// Pages whose content tree nests under their nav button (labeled nav only)
const NAV_TREES: Partial<Record<string, NavTreeId>> = { tasks: 'tasks', docs: 'docs' }

// Icon map for nav items — lookup by page ID
const NAV_ICONS: Record<string, LucideIcon> = {
  today: Sun,
  tasks: CheckSquare,
  inbox: Inbox,
  docs: FileText,
  goals: Target,
}

const NAV_LABELS: Record<string, string> = {
  today: 'Today',
  tasks: 'Tasks',
  inbox: 'Inbox',
  docs: 'Docs',
  goals: 'Goals',
}

/* One class recipe for every rail item (shell P2-10, P3-4, P2-9):
   - a real <button> in both modes so Enter and Space activate natively;
   - hover is full-alpha `bg-muted` (the old accent/20 measured 1.02:1);
   - the 36px box gets a 40px hit target through `after:` — the rail's
     gap-1 keeps neighbouring targets touching, never overlapping;
   - active adds a 2px foreground bar as a second cue beside icon colour. */
function navItemClasses(expanded: boolean, isActive: boolean) {
  return cn(
    'relative flex h-9 items-center rounded-lg transition-[color,background-color] duration-(--transition-fast) cursor-pointer',
    'after:absolute after:-inset-0.5 after:rounded-lg',
    expanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
    isActive
      ? 'bg-muted text-foreground before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-foreground'
      : 'text-muted-foreground hover:bg-hover hover:text-foreground',
  )
}

function NavButton({
  label,
  icon,
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
  const content = (
    <>
      <Icon icon={icon} size="nav" />
      {expanded && (
        <span className="text-body-strong truncate">{label}</span>
      )}
    </>
  )

  const shared = {
    'aria-label': label,
    'aria-current': isActive ? ('page' as const) : undefined,
    onClick,
    className: navItemClasses(expanded, isActive),
  }

  if (expanded) {
    return (
      <button type="button" {...shared}>
        {content}
      </button>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger {...shared}>{content}</TooltipTrigger>
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
  const treeId = NAV_TREES[id]
  const treeOpen = useLayoutStore((s) => (treeId ? s.navTrees[treeId] : false))
  const setTreeOpen = useLayoutStore((s) => s.setNavTreeOpen)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const icon = NAV_ICONS[id]
  const label = NAV_LABELS[id]
  if (!icon || !label) return null

  // dnd-kit's keyboard sensor claims Enter/Space to start a drag and
  // preventDefaults them, which silently killed keyboard navigation on the
  // rail (measured in the harness: Enter on a focused item never changed
  // the page). Reordering now starts on ⌥Enter / ⌥Space; plain Enter and
  // Space reach the button and navigate.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey) listeners?.onKeyDown?.(e)
  }

  const showTree = expanded && !!treeId && treeOpen

  const content = (
    <>
      <Icon icon={icon} size="nav" />
      {expanded && (
        <span className={cn('text-body-strong truncate', treeId && 'pr-6')}>{label}</span>
      )}
    </>
  )

  const shared = {
    ...attributes,
    ...listeners,
    onKeyDown,
    'aria-label': label,
    'aria-current': isActive ? ('page' as const) : undefined,
    'aria-expanded': expanded && treeId ? treeOpen : undefined,
    onClick,
    className: cn(navItemClasses(expanded, isActive), 'touch-none', 'shrink-0'),
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('relative flex flex-col', showTree ? 'min-h-0' : 'shrink-0', isDragging && 'opacity-60 shadow-md z-10')}
    >
      {expanded ? (
        <button type="button" {...shared}>
          {content}
        </button>
      ) : (
        <Tooltip>
          <TooltipTrigger {...shared}>{content}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      )}
      {/* Show/hide this page's tree — a sibling over the row, not a nested button */}
      {expanded && treeId && (
        <IconButton
          onClick={() => setTreeOpen(treeId, !treeOpen)}
          size="md"
          tone="subtle"
          title={treeOpen ? `Hide ${label.toLowerCase()} list` : `Show ${label.toLowerCase()} list`}
          aria-label={treeOpen ? `Hide ${label} list` : `Show ${label} list`}
          aria-expanded={treeOpen}
          className="absolute right-1.5 top-1.5"
        >
          <ChevronRight className={cn('size-3.5 transition-transform duration-(--transition-fast) ease-(--ease-entrance)', treeOpen && 'rotate-90')} />
        </IconButton>
      )}
      {/* Own scroll region that shrinks (min-h-0) and gives ground first, so every
          page item stays in view even with a tall tree (re-score shell N-P1-1).
          pt-1/pb-1/pr-1 keep the focus ring from clipping against the scroll
          edge; the old mt-0.5/mb-1 are folded into that padding so the gap
          animates with the height rather than snapping at the end. */}
      {expanded && treeId && (
        <Collapse
          open={treeOpen}
          role="group"
          aria-label={`${label} list`}
          className="min-h-0 max-h-[40vh] overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin]"
          innerClassName="pt-1.5 pb-2 pl-4 pr-1"
        >
          {treeId === 'tasks' ? <NavTasksTree /> : <NavDocsTree />}
        </Collapse>
      )}
    </div>
  )
}

export function NavSidebar() {
  const currentPage = useAppStore((s) => s.currentPage)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)

  const width = useLayoutStore((s) => s.navWidth)
  const setNavWidth = useLayoutStore((s) => s.setNavWidth)
  const navOrder = useLayoutStore((s) => s.navOrder)
  const saveNavOrder = useLayoutStore((s) => s.saveNavOrder)
  const setNavCollapsed = useLayoutStore((s) => s.setNavCollapsed)
  const setNavTreeOpen = useLayoutStore((s) => s.setNavTreeOpen)

  // Going to Tasks opens its tree and closes Docs', and vice versa; other
  // pages leave both as they were. The chevrons toggle them by hand.
  useEffect(() => {
    const tree = NAV_TREES[currentPage]
    if (!tree) return
    setNavTreeOpen(tree, true)
    setNavTreeOpen(tree === 'tasks' ? 'docs' : 'tasks', false)
  }, [currentPage, setNavTreeOpen])

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
      // Snap to icons, or to the narrowest labeled width that fits the trees
      const current = useLayoutStore.getState().navWidth
      setNavWidth(current < SNAP_COLLAPSE_BELOW ? MIN_WIDTH : Math.max(MIN_EXPANDED, current))
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
      className="relative flex shrink-0 flex-col border-r border-secondary bg-sidebar py-3"
      style={{ width }}
    >
      {/* Demo mode pill — click jumps to Settings to toggle off */}
      {demoMode && (
        <div className={cn('mb-2 flex', expanded ? 'px-2' : 'justify-center')}>
          <Tooltip>
            <TooltipTrigger
              className={cn(
                /* Label on text-foreground (warning text on the /15 tint measured
                   3.92:1 in light); the warning dot carries the meaning. */
                'flex items-center gap-1.5 rounded-full bg-warning/15 text-foreground transition-colors hover:bg-warning/25',
                expanded ? 'px-2.5 py-1 text-label' : 'size-6 justify-center',
              )}
              onClick={() => openSettings('demo')}
            >
              <span className="size-1.5 rounded-full bg-warning animate-pulse" />
              {expanded && 'Demo'}
            </TooltipTrigger>
            <TooltipContent side="right">Demo mode — real data hidden. Click to manage.</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Wordmark + collapse to icons / expand to labels. Same 28px row as the
          button alone, so nothing below moves; snapped to icons, the mark
          stacks above the expand button. The wordmark is decorative — no
          focus stop — and the mark lines up with the nav icons (pl-2.25). */}
      <div className={cn('mb-1 flex items-center', expanded ? 'justify-between gap-2 px-2' : 'flex-col gap-2')}>
        <div data-wordmark className={cn('flex min-w-0 items-center gap-2 text-foreground', expanded && 'pl-2.25')}>
          <NimbleMark className="size-4.5 shrink-0" />
          {expanded && (
            <span className="font-heading text-(length:--text-body-strong) leading-tight font-semibold">Nimble</span>
          )}
        </div>
        <IconButton
          onClick={() => setNavCollapsed(expanded)}
          size="lg"
          tone="subtle"
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Icon icon={expanded ? PanelLeftClose : PanelLeftOpen} size="nav" />
        </IconButton>
      </div>

      {/* Sortable nav items */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'To reorder a page, press Option and Enter, move it with the arrow keys, then press Enter to drop or Escape to cancel.',
          },
        }}
      >
        <SortableContext items={navOrder} strategy={verticalListSortingStrategy}>
          <div className={cn('flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]', expanded ? 'px-2' : 'items-center')}>
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
      <div className={cn('mt-auto flex flex-col gap-1 pt-2', expanded ? 'px-2' : 'items-center')}>
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
