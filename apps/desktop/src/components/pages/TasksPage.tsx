import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { SortableTaskList } from '@/components/tasks/SortableTaskList'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Plus, PanelLeftOpen } from 'lucide-react'
import { STATUSES } from '@/components/tasks/StatusDropdown'
import { ProjectSidebar } from '@/components/tasks/ProjectSidebar'
import { ProjectDetailPage } from '@/components/tasks/ProjectDetailPage'
import { IconButton } from '@/components/shared/IconButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { useLayoutStore } from '@/stores/layoutStore'
import { LabelChip } from '@/components/tasks/LabelPicker'
import { listLabels } from '@/services/tauri'
import type { TaskStatus, LocalTask, Label } from '@nimble/types'

// ── Inline Task Creator ──

function TaskCreator({
  projectId,
  onAdd,
}: {
  projectId: string
  onAdd: (content: string, extra?: { projectId?: string; dueDate?: string; priority?: number }) => void
}) {
  const [value, setValue] = useState('')

  const handleSubmit = () => {
    const text = value.trim()
    if (!text) return
    onAdd(text, { projectId })
    setValue('')
  }

  return (
    <div className="flex items-center gap-2 py-1 pl-2">
      <Plus className="size-3.5 text-muted-foreground shrink-0" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
        }}
        placeholder="Add a task..."
        className="h-7 text-body border-none shadow-none bg-transparent px-0 focus-visible:ring-0"
      />
    </div>
  )
}

// ── Project Section (for All Tasks view) ──

function ProjectSection({
  projectName,
  projectColor,
  projectId,
  tasks,
  onAddTask,
  onDelete,
  onAddSubtask,
  onUpdated,
  allProjects,
  defaultOpen,
}: {
  projectName: string
  projectColor: string
  projectId: string
  tasks: LocalTask[]
  onAddTask: (content: string, extra?: { projectId?: string }) => void
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  onUpdated?: () => void
  allProjects: import('@nimble/types').Project[]
  defaultOpen: boolean
}) {
  const topLevel = tasks.filter((t) => !t.parent_id)

  return (
    <CollapsibleSection
      title={projectName}
      count={topLevel.filter((t) => !t.completed).length}
      defaultOpen={defaultOpen}
      variant="nested"
      icon={
        <span
          className="size-2.5 rounded-full shrink-0"
          style={{ backgroundColor: projectColor }}
        />
      }
    >
      <div>
        <SortableTaskList
          tasks={tasks}
          allTasks={tasks}
          projects={allProjects}
          projectName={projectName}
          projectColor={projectColor}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          onUpdated={onUpdated}
        />
        <TaskCreator projectId={projectId} onAdd={onAddTask} />
      </div>
    </CollapsibleSection>
  )
}

// ── All Tasks View (original content) ──

function AllTasksView({
  projects,
  filteredTasks,
  statusFilter,
  setStatusFilter,
  statusCounts,
  visibleLabels,
  selectedLabelIds,
  toggleLabelFilter,
  tasksByProject,
  bestProject,
  handleAddTask,
  handleAddSubtask,
  remove,
  refresh,
}: {
  projects: import('@nimble/types').Project[]
  filteredTasks: LocalTask[]
  statusFilter: TaskStatus | 'all'
  setStatusFilter: (v: TaskStatus | 'all') => void
  statusCounts: Record<string, number>
  visibleLabels: Label[]
  selectedLabelIds: string[]
  toggleLabelFilter: (id: string) => void
  tasksByProject: Record<string, LocalTask[]>
  bestProject: string
  handleAddTask: (content: string, extra?: { projectId?: string }) => void
  handleAddSubtask: (parentId: string, content: string) => void
  remove: (id: string) => void
  refresh: () => void
}) {
  const filterPills = (
    <>
      <button
        onClick={() => setStatusFilter('all')}
        className={cn(
          'rounded-md px-2 py-1 text-meta transition-colors',
          statusFilter === 'all'
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/20',
        )}
      >
        All
        <span className="ml-1 text-label text-muted-foreground">{statusCounts.all || 0}</span>
      </button>
      {STATUSES.map((s) => {
        const SIcon = s.icon
        const count = statusCounts[s.value] || 0
        if (count === 0 && statusFilter !== s.value) return null
        return (
          <button
            key={s.value}
            onClick={() => setStatusFilter(statusFilter === s.value ? 'all' : s.value)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-meta transition-colors',
              statusFilter === s.value
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/20',
            )}
          >
            <SIcon className={cn('size-3', s.iconColor)} />
            {s.label}
            <span className="text-label text-muted-foreground">{count}</span>
          </button>
        )
      })}
      {visibleLabels.length > 0 && (
        <>
          <div className="mx-1 h-4 w-px bg-border/20" />
          {visibleLabels.map((label) => (
            <LabelChip
              key={label.id}
              label={label}
              selected={selectedLabelIds.includes(label.id)}
              onClick={() => toggleLabelFilter(label.id)}
            />
          ))}
        </>
      )}
    </>
  )

  return (
    // scrollbar-gutter keeps centered content from shifting when the
    // classic 6px scrollbar appears after async content loads
    <div className="flex-1 overflow-y-auto flex flex-col min-w-0 [scrollbar-gutter:stable]">
      <PageHeader
        title="Tasks"
        meta={`${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''}${statusFilter !== 'all' ? ` · ${statusFilter.replace('_', ' ')}` : ''}`}
        secondary={filterPills}
      />
      <div className="py-6 flex-1">
        <div className="w-full space-y-3">
        {/* Project sections */}
        {filteredTasks.length === 0 && statusFilter === 'all' ? (
          <p className="text-body text-muted-foreground text-center py-8">
            No tasks yet. Press <kbd className="rounded border border-border/30 px-1.5 py-0.5 text-meta font-mono">Q</kbd> to create one.
          </p>
        ) : (
          projects.map((project) => (
            <ProjectSection
              key={project.id}
              projectName={project.name}
              projectColor={project.color}
              projectId={project.id}
              tasks={tasksByProject[project.id] || []}
              onAddTask={handleAddTask}
              onDelete={remove}
              onAddSubtask={handleAddSubtask}
              onUpdated={refresh}
              allProjects={projects}
              defaultOpen={project.id === bestProject}
            />
          ))
        )}
        </div>
      </div>
    </div>
  )
}

// ── Tasks Page ──

export function TasksPage() {
  const { projects, loading: projectsLoading, addProject, renameProject, updateProjectColor, removeProject } = useProjects()
  const { tasks, loading: tasksLoading, addTask, remove, refresh } = useLocalTasks()
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [labels, setLabels] = useState<Label[]>([])
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([])

  const sidebarCollapsed = useLayoutStore((s) => s.tasksProjectSidebarCollapsed)
  const setSidebarCollapsed = useLayoutStore((s) => s.setTasksProjectSidebarCollapsed)

  const loading = projectsLoading || tasksLoading

  useEffect(() => {
    listLabels().then(setLabels).catch(() => {})
  }, [])

  // Only surface labels that are actually applied to something — an empty
  // label taxonomy in the filter row is just noise.
  const usedLabelIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of tasks) for (const l of t.labels) set.add(l)
    return set
  }, [tasks])

  const visibleLabels = useMemo(
    () => labels.filter((l) => usedLabelIds.has(l.id)),
    [labels, usedLabelIds],
  )

  const toggleLabelFilter = useCallback((id: string) => {
    setSelectedLabelIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }, [])

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      // Multi-select OR: a task matches if it carries ANY selected label.
      if (selectedLabelIds.length > 0 && !t.labels.some((l) => selectedLabelIds.includes(l))) return false
      return true
    })
  }, [tasks, statusFilter, selectedLabelIds])

  // Status counts for filter pills
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length }
    for (const t of tasks) {
      counts[t.status] = (counts[t.status] || 0) + 1
    }
    return counts
  }, [tasks])

  const handleAddSubtask = useCallback(
    async (parentId: string, content: string) => {
      const parent = tasks.find((t) => t.id === parentId)
      await addTask(content, { parentId, projectId: parent?.project_id })
      refresh()
    },
    [tasks, addTask, refresh],
  )

  const handleAddTask = useCallback(
    async (content: string, extra?: { projectId?: string }) => {
      await addTask(content, extra)
    },
    [addTask],
  )

  // Group filtered tasks by project
  const tasksByProject = useMemo(() => {
    const grouped: Record<string, typeof tasks> = {}
    for (const task of filteredTasks) {
      if (!grouped[task.project_id]) grouped[task.project_id] = []
      grouped[task.project_id].push(task)
    }
    return grouped
  }, [filteredTasks])

  // Default-expand only the project with most in-progress tasks (or Inbox as fallback)
  const bestProject = useMemo(() => {
    let best = 'inbox'
    let bestCount = -1
    for (const project of projects) {
      const inProgress = (tasksByProject[project.id] || []).filter(
        (t) => t.status === 'in_progress'
      ).length
      if (inProgress > bestCount) {
        bestCount = inProgress
        best = project.id
      }
    }
    return best
  }, [projects, tasksByProject])

  // Find the selected project object
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null
    return projects.find((p) => p.id === selectedProjectId) ?? null
  }, [selectedProjectId, projects])

  if (loading) {
    return (
      <div className="flex flex-1 h-full overflow-hidden">
        <div className="space-y-3 p-6 flex-1">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Project sidebar */}
      {sidebarCollapsed ? (
        <div className="flex flex-col items-center border-r border-border/20 bg-muted/10 py-2 px-1">
          <IconButton
            onClick={() => setSidebarCollapsed(false)}
            size="lg"
            title="Expand project sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </IconButton>
        </div>
      ) : (
        <ProjectSidebar
          projects={projects}
          tasks={tasks}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onAddProject={addProject}
          onRenameProject={renameProject}
          onUpdateProjectColor={updateProjectColor}
          onDeleteProject={removeProject}
        />
      )}

      {/* Main content */}
      {selectedProject ? (
        <ProjectDetailPage
          project={selectedProject}
          tasks={tasks}
          allProjects={projects}
          onBack={() => setSelectedProjectId(null)}
          onAddTask={handleAddTask}
          onDeleteTask={remove}
          onAddSubtask={handleAddSubtask}
          onUpdated={refresh}
        />
      ) : (
        <AllTasksView
          projects={projects}
          filteredTasks={filteredTasks}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          statusCounts={statusCounts}
          visibleLabels={visibleLabels}
          selectedLabelIds={selectedLabelIds}
          toggleLabelFilter={toggleLabelFilter}
          tasksByProject={tasksByProject}
          bestProject={bestProject}
          handleAddTask={handleAddTask}
          handleAddSubtask={handleAddSubtask}
          remove={remove}
          refresh={refresh}
        />
      )}
    </div>
  )
}
