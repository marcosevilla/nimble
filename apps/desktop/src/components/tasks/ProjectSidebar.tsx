import { useState, useCallback, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Plus, List, Pencil, Trash2, Check, X, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ProjectEditDialog } from './ProjectEditDialog'
import type { Project, LocalTask } from '@nimble/types'
import { PROJECT_COLORS } from '@/lib/projectColors'
import { pickRovingKey } from '@/lib/docsTree'
import { buildProjectTree, visibleProjectKeys } from '@/lib/projectTree'
import { handleTreeKeyDown } from '@/components/shared/treeKeys'
import { Collapse } from '@/components/shared/Collapse'

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

  // Roving tree (re-score tasks N-P1-1): one row is the Tab stop — the
  // last-focused one, else the selection, else "All tasks".
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const focusRowKey = useCallback((key: string) => {
    requestAnimationFrame(() => {
      treeRef.current?.querySelector<HTMLElement>(`[data-tree-row][data-key="${CSS.escape(key)}"]`)?.focus()
    })
  }, [])
  const setParentOpen = useCallback((key: string, open: boolean) => {
    const id = key.slice('project:'.length)
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      if (open) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const requestDelete = useCallback((row: HTMLElement) => {
    const key = row.dataset.key ?? ''
    if (key.startsWith('project:')) setConfirmDeleteId(key.slice('project:'.length))
  }, [])
  const onRowKey = useCallback((key: string, row: HTMLElement) => {
    if (key !== 'e') return false
    const id = row.dataset.key?.startsWith('project:') ? row.dataset.key.slice('project:'.length) : null
    const project = id ? projects.find((p) => p.id === id) : undefined
    if (!project) return false
    setEditingProject(project)
    return true
  }, [projects])

  // Big parents (e.g. 🏡 Personal (12)) open collapsed by default so the
  // tree doesn't read as noise on first paint. `projects` loads async
  // (starts empty, refetches after mount), so this can't be a plain
  // `useState` lazy initializer — it runs once more per newly-discovered
  // big parent instead, tracked so a user's manual expand isn't
  // re-collapsed the next time `projects` changes. Adjusted during render
  // (not in an effect) so the first painted frame is already collapsed —
  // an effect would now play the collapse animation on load.
  const [autoCollapsed, setAutoCollapsed] = useState<Set<string>>(new Set())
  const newlyBig = Object.entries(childrenByParent)
    .filter(([id, children]) => children.length > AUTO_COLLAPSE_THRESHOLD && !autoCollapsed.has(id))
    .map(([id]) => id)
  if (newlyBig.length > 0) {
    setAutoCollapsed(new Set([...autoCollapsed, ...newlyBig]))
    setCollapsedParents(new Set([...collapsedParents, ...newlyBig]))
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

  const selectionKey = selectedProjectId === null ? 'all' : selectedProjectId ? `project:${selectedProjectId}` : null
  const visibleKeys = visibleProjectKeys({ roots: rootProjects, childrenByParent, collapsed: collapsedParents })
  const rowKeys = confirmDeleteId ? visibleKeys.filter((k) => k !== `project:${confirmDeleteId}`) : visibleKeys
  const tabStop = pickRovingKey(rowKeys, focusKey, selectionKey)
  const tabIndexFor = (key: string) => (key === tabStop ? 0 : -1)

  function renderProjectRow(
    project: Project,
    opts: { indent?: boolean; hasChildren?: boolean; collapsed?: boolean; parentKey?: string } = {},
  ) {
    const { indent = false, hasChildren = false, collapsed = false, parentKey } = opts
    const count = taskCountByProject[project.id] || 0
    const isSelected = selectedProjectId === project.id
    const isInbox = project.id === 'inbox'

    // Delete confirm
    if (confirmDeleteId === project.id) {
      const cancel = () => { setConfirmDeleteId(null); focusRowKey(`project:${project.id}`) }
      return (
        <div
          key={project.id}
          role="alertdialog"
          aria-label={`Delete ${project.name}?`}
          className={cn('flex items-center gap-1 px-2 py-1', indent && 'pl-8')}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() } }}
        >
          <span className="text-label text-destructive flex-1">Delete {project.name}?</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive"
            aria-label={`Confirm delete ${project.name}`}
            autoFocus
            onClick={() => {
              onDeleteProject(project.id)
              setConfirmDeleteId(null)
              if (selectedProjectId === project.id) onSelectProject(null)
              focusRowKey('all')
            }}
          >
            <Check className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Keep it" onClick={cancel}>
            <X className="size-3" />
          </Button>
        </div>
      )
    }

    const key = `project:${project.id}`
    return (
      <div
        key={project.id}
        className={cn(
          'group flex h-6.5 w-full items-center gap-2 rounded-md pr-1.5 transition-colors duration-(--transition-fast)',
          isSelected ? 'bg-muted' : 'hover:bg-muted/50',
        )}
      >
        <button
          type="button"
          role="treeitem"
          data-tree-row
          data-kind={hasChildren ? 'folder' : 'leaf'}
          data-key={key}
          data-name={project.name}
          data-deletable={isInbox ? 'false' : 'true'}
          data-expanded={hasChildren ? (collapsed ? 'false' : 'true') : undefined}
          data-parent={parentKey}
          tabIndex={tabIndexFor(key)}
          aria-selected={isSelected}
          aria-expanded={hasChildren ? !collapsed : undefined}
          aria-level={indent ? 2 : 1}
          onClick={() => onSelectProject(project.id)}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center rounded-md text-left text-foreground',
            indent ? 'pl-8' : 'pl-2',
            isSelected ? 'text-meta-strong' : 'text-meta',
          )}
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
        </button>

        {/* Mouse targets; the keyboard uses `e` and ⌫ on the row */}
        <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setEditingProject(project)}
            className="relative flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground before:absolute before:-inset-y-2 before:-inset-x-px before:content-['']"
            title="Edit project (e)"
            aria-label={`Edit ${project.name}`}
          >
            <Pencil className="size-2.5" />
          </button>
          {!isInbox && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setConfirmDeleteId(project.id)}
              className="relative flex size-4 items-center justify-center rounded text-destructive/30 hover:text-destructive before:absolute before:-inset-y-2 before:-inset-x-px before:content-['']"
              title="Delete (⌫)"
              aria-label={`Delete ${project.name}`}
            >
              <Trash2 className="size-2.5" />
            </button>
          )}
        </div>

        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => toggleParentCollapsed(project.id)}
            className="flex w-3 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            title={collapsed ? 'Expand (→)' : 'Collapse (←)'}
            aria-label={collapsed ? `Expand ${project.name}` : `Collapse ${project.name}`}
          >
            <ChevronRight className={cn('size-3 transition-transform duration-(--transition-fast) ease-(--ease-entrance)', !collapsed && 'rotate-90')} />
          </button>
        ) : (
          <span className="min-w-3 shrink-0 text-center text-meta tabular-nums text-muted-foreground">{count}</span>
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
      <div
        ref={treeRef}
        role="tree"
        aria-label="Projects"
        className="space-y-0.5"
        onKeyDown={(e) => handleTreeKeyDown(e, (k) => setParentOpen(k, true), (k) => setParentOpen(k, false), requestDelete, onRowKey)}
        onFocus={(e) => {
          const row = e.target as HTMLElement
          if (row.hasAttribute('data-tree-row') && row.dataset.key) setFocusKey(row.dataset.key)
        }}
      >
        {/* All Tasks */}
        <button
          type="button"
          role="treeitem"
          data-tree-row
          data-kind="leaf"
          data-key="all"
          data-deletable="false"
          tabIndex={tabIndexFor('all')}
          aria-selected={selectedProjectId === null}
          aria-level={1}
          onClick={() => onSelectProject(null)}
          className={cn(
            'flex h-6.5 w-full items-center gap-2 rounded-md pl-2 pr-1.5 text-left transition-colors duration-(--transition-fast)',
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
          {/* min-w, not w-3: "15" is 14px and overflowed the fixed 12px slot */}
          <span className="min-w-3 shrink-0 text-center text-meta tabular-nums text-muted-foreground">{totalActive}</span>
        </button>

        {/* Projects — root projects first, each followed by its (one-level)
            children indented pl-8, in a list that animates open and closed.
            The list takes no outer margin (mb-0 beats space-y's zero-
            specificity rule); its pb-0.5 is the gap after the last child, so
            the gap animates with the height instead of jumping at the end. */}
        {rootProjects.flatMap((project) => {
          const children = childrenByParent[project.id] ?? []
          const isCollapsed = collapsedParents.has(project.id)
          const key = `project:${project.id}`
          const rows = [renderProjectRow(project, { hasChildren: children.length > 0, collapsed: isCollapsed })]
          if (children.length > 0) {
            rows.push(
              <Collapse key={`${project.id}:children`} open={!isCollapsed} role="group" data-tree-children={key} className="mb-0" innerClassName="space-y-0.5 pb-0.5">
                {children.map((child) => renderProjectRow(child, { indent: true, parentKey: key }))}
              </Collapse>,
            )
          }
          return rows
        })}
      </div>

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
