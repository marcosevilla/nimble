import { useState, useCallback, useEffect, useRef } from 'react'
import { useLayoutStore } from '@/stores/layoutStore'
import { cn } from '@/lib/utils'
import { Plus, PanelLeftClose, List, Pencil, Trash2, Check, X, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/IconButton'
import { ProjectEditDialog } from './ProjectEditDialog'
import type { Project, LocalTask } from '@nimble/types'

const PROJECT_COLORS = [
  '#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#f43f5e', '#8b5cf6', '#14b8a6',
]

interface ProjectSidebarProps {
  projects: Project[]
  tasks: LocalTask[]
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  onAddProject: (name: string, color: string) => void
  onRenameProject: (id: string, name: string) => void
  onUpdateProjectColor: (id: string, color: string) => void
  onDeleteProject: (id: string) => void
}

export function ProjectSidebar({
  projects,
  tasks,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onRenameProject,
  onUpdateProjectColor,
  onDeleteProject,
}: ProjectSidebarProps) {
  const sidebarWidth = useLayoutStore((s) => s.tasksProjectSidebarWidth)
  const setSidebarWidth = useLayoutStore((s) => s.setTasksProjectSidebarWidth)
  const setCollapsed = useLayoutStore((s) => s.setTasksProjectSidebarCollapsed)

  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(200)

  // New project input
  const [newProjectInput, setNewProjectInput] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0])

  // Editing state
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Nesting: one level deep — child projects (parent_id set) render
  // indented under their parent, collapsible via a disclosure chevron.
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const toggleParentCollapsed = useCallback((id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const rootProjects = projects.filter((p) => !p.parent_id)
  const childrenByParent: Record<string, Project[]> = {}
  for (const p of projects) {
    if (p.parent_id) {
      if (!childrenByParent[p.parent_id]) childrenByParent[p.parent_id] = []
      childrenByParent[p.parent_id].push(p)
    }
  }

  // Count non-completed tasks per project
  const taskCountByProject: Record<string, number> = {}
  let totalActive = 0
  for (const t of tasks) {
    if (!t.completed) {
      taskCountByProject[t.project_id] = (taskCountByProject[t.project_id] || 0) + 1
      totalActive++
    }
  }

  function renderProjectRow(
    project: Project,
    opts: { indent?: boolean; hasChildren?: boolean; collapsed?: boolean } = {},
  ) {
    const { indent = false, hasChildren = false, collapsed = false } = opts
    const count = taskCountByProject[project.id] || 0
    const isSelected = selectedProjectId === project.id
    const isInbox = project.id === 'inbox'

    // Delete confirm
    if (confirmDeleteId === project.id) {
      return (
        <div key={project.id} className={cn('flex items-center gap-1 px-2 py-1', indent && 'pl-8')}>
          <span className="text-label text-destructive flex-1">Delete {project.name}?</span>
          <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => { onDeleteProject(project.id); setConfirmDeleteId(null); if (selectedProjectId === project.id) onSelectProject(null) }}>
            <Check className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => setConfirmDeleteId(null)}>
            <X className="size-3" />
          </Button>
        </div>
      )
    }

    return (
      <div
        key={project.id}
        className={cn(
          'group flex h-9 w-full items-center gap-2 rounded-md pr-1.5 transition-colors cursor-pointer',
          indent ? 'pl-8' : 'pl-2',
          isSelected ? 'bg-muted' : 'hover:bg-muted/50',
        )}
        onClick={() => onSelectProject(project.id)}
      >
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-foreground',
            isSelected ? 'text-meta-strong' : 'text-meta',
          )}
        >
          {project.name}
        </span>

        {/* Hover actions */}
        <div className="hidden items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setEditingProject(project)}
            className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            title="Edit project"
          >
            <Pencil className="size-2.5" />
          </button>
          {!isInbox && (
            <button
              onClick={() => setConfirmDeleteId(project.id)}
              className="flex size-4 items-center justify-center rounded text-destructive/30 hover:text-destructive"
              title="Delete"
            >
              <Trash2 className="size-2.5" />
            </button>
          )}
        </div>

        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggleParentCollapsed(project.id) }}
            className="flex w-3 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <ChevronRight className={cn('size-3 transition-transform', !collapsed && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-3 shrink-0 text-center text-meta text-muted-foreground">{count}</span>
        )}
      </div>
    )
  }

  const handleCreateProject = useCallback(() => {
    const name = newProjectName.trim()
    if (!name) return
    onAddProject(name, newProjectColor)
    setNewProjectName('')
    setNewProjectColor(PROJECT_COLORS[0])
    setNewProjectInput(false)
  }, [newProjectName, newProjectColor, onAddProject])

  // Resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    startX.current = e.clientX
    startWidth.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    function handleMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX.current
      setSidebarWidth(Math.min(400, Math.max(140, startWidth.current + delta)))
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
  }, [dragging, setSidebarWidth])

  return (
    <div
      className="relative flex flex-col border-r border-border/20 bg-sidebar overflow-hidden"
      style={{ width: sidebarWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
        <span className="text-label text-muted-foreground">Projects</span>
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={() => setNewProjectInput(true)}
            size="sm"
            title="New project"
          >
            <Plus className="size-3" />
          </IconButton>
          <IconButton
            onClick={() => setCollapsed(true)}
            size="sm"
            title="Collapse"
          >
            <PanelLeftClose className="size-3" />
          </IconButton>
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {/* All Tasks */}
        <button
          onClick={() => onSelectProject(null)}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md pl-2 pr-1.5 text-left transition-colors',
            selectedProjectId === null ? 'bg-muted' : 'hover:bg-muted/50',
          )}
        >
          <List className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              'flex-1 min-w-0 truncate text-foreground',
              selectedProjectId === null ? 'text-meta-strong' : 'text-meta',
            )}
          >
            All Tasks
          </span>
          <span className="w-3 shrink-0 text-center text-meta text-muted-foreground">{totalActive}</span>
        </button>

        {/* Divider */}
        <div className="h-px bg-border/10 my-1" />

        {/* Projects — root projects first, each followed by its (one-level)
            children indented pl-8 when not collapsed. */}
        {rootProjects.flatMap((project) => {
          const children = childrenByParent[project.id] ?? []
          const isCollapsed = collapsedParents.has(project.id)
          const rows = [renderProjectRow(project, { hasChildren: children.length > 0, collapsed: isCollapsed })]
          if (children.length > 0 && !isCollapsed) {
            rows.push(...children.map((child) => renderProjectRow(child, { indent: true })))
          }
          return rows
        })}

        {/* New project input */}
        {newProjectInput && (
          <div className="space-y-1.5 px-1.5 py-1">
            <Input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateProject()
                if (e.key === 'Escape') { setNewProjectInput(false); setNewProjectName('') }
              }}
              onBlur={() => { if (!newProjectName.trim()) setNewProjectInput(false) }}
              placeholder="Project name..."
              className="h-6 text-meta"
              autoFocus
            />
            <div className="flex items-center gap-1">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    'size-4 rounded-full border-2 transition-all',
                    newProjectColor === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setNewProjectColor(c)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: New project button (shown when input not open) */}
      {!newProjectInput && (
        <div className="border-t border-border/20 p-1.5">
          <button
            onClick={() => setNewProjectInput(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-body text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Plus className="size-3" />
            New project
          </button>
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute right-0 top-0 bottom-0 z-10 w-px cursor-col-resize transition-colors bg-border/20',
          dragging ? 'bg-accent-blue/50 w-1' : 'hover:bg-accent-blue/30 hover:w-1',
        )}
      />

      <ProjectEditDialog
        project={editingProject}
        open={editingProject !== null}
        onOpenChange={(open) => { if (!open) setEditingProject(null) }}
        onRename={onRenameProject}
        onUpdateColor={onUpdateProjectColor}
      />
    </div>
  )
}
