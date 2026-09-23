import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Plus, List, Pencil, Trash2, Check, X, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ProjectEditDialog } from './ProjectEditDialog'
import type { Project, LocalTask } from '@nimble/types'
import { PROJECT_COLORS } from '@/lib/projectColors'
import { buildProjectTree } from '@/lib/projectTree'

// A parent past this many children opens collapsed by default (e.g. 🏡
// Personal (12)) — big lists like that read as noise on first paint;
// disclosure state itself stays manual after that (toggling one doesn't
// re-derive from this threshold).
const AUTO_COLLAPSE_THRESHOLD = 5

interface ProjectSidebarProps {
  projects: Project[]
  tasks: LocalTask[]
  /** null = All tasks; undefined = nothing highlighted (another page). */
  selectedProjectId: string | null | undefined
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
  // New project input
  const [newProjectInput, setNewProjectInput] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0])

  // Editing state
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Archived projects never render here, and a child whose parent is
  // archived (or missing) surfaces as a root instead of disappearing —
  // see projectTree.ts.
  const { roots: rootProjects, childrenByParent } = useMemo(() => buildProjectTree(projects), [projects])

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

  // Big parents (e.g. 🏡 Personal (12)) open collapsed by default so the
  // tree doesn't read as noise on first paint. `projects` loads async
  // (starts empty, refetches after mount), so this can't be a plain
  // `useState` lazy initializer — it runs once more per newly-discovered
  // big parent instead, tracked in a ref so a user's manual expand isn't
  // re-collapsed the next time `projects` changes.
  const autoCollapsedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const newlyBig = Object.entries(childrenByParent)
      .filter(([, children]) => children.length > AUTO_COLLAPSE_THRESHOLD)
      .map(([id]) => id)
      .filter((id) => !autoCollapsedRef.current.has(id))
    if (newlyBig.length === 0) return
    for (const id of newlyBig) autoCollapsedRef.current.add(id)
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      for (const id of newlyBig) next.add(id)
      return next
    })
  }, [childrenByParent])

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
            className="relative flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground before:absolute before:-inset-y-2 before:-inset-x-px before:content-['']"
            title="Edit project"
          >
            <Pencil className="size-2.5" />
          </button>
          {!isInbox && (
            <button
              onClick={() => setConfirmDeleteId(project.id)}
              className="relative flex size-4 items-center justify-center rounded text-destructive/30 hover:text-destructive before:absolute before:-inset-y-2 before:-inset-x-px before:content-['']"
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

  return (
    <div className="flex flex-col">
      {/* Project list — nested under Tasks in the left nav */}
      <div className="space-y-0.5">
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
            All tasks
          </span>
          <span className="w-3 shrink-0 text-center text-meta text-muted-foreground">{totalActive}</span>
        </button>

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
                    'size-4 rounded-full border-2 transition-[border-color,scale] duration-(--transition-fast)',
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

      {/* New project (shown when the input isn't open) */}
      {!newProjectInput && (
        <button
          onClick={() => setNewProjectInput(true)}
          className="mt-0.5 flex h-8 w-full items-center gap-2 rounded-md pl-2 pr-1.5 text-meta text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Plus className="size-3" />
          New project
        </button>
      )}

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
