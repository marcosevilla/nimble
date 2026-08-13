import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionedTaskList } from '@/components/tasks/SectionedTaskList'
import { STATUSES } from '@/components/tasks/StatusDropdown'
import { PageHeader } from '@/components/shared/PageHeader'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { listSections } from '@/services/tauri'
import type { Project, LocalTask, TaskStatus, Section } from '@nimble/types'

// ── Inline Task Creator ──

function TaskCreator({
  projectId,
  onAdd,
}: {
  projectId: string
  onAdd: (content: string, extra?: { projectId?: string }) => void
}) {
  const [value, setValue] = useState('')

  const handleSubmit = () => {
    const text = value.trim()
    if (!text) return
    onAdd(text, { projectId })
    setValue('')
  }

  return (
    <div className="pt-5 flex items-center gap-2 text-meta text-muted-foreground hover:text-foreground">
      <Plus className="size-3 shrink-0" />
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

interface ProjectDetailPageProps {
  project: Project
  tasks: LocalTask[]
  allProjects: Project[]
  onBack: () => void
  onAddTask: (content: string, extra?: { projectId?: string }) => void
  onDeleteTask: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  onUpdated: () => void
}

export function ProjectDetailPage({
  project,
  tasks,
  allProjects,
  onBack,
  onAddTask,
  onDeleteTask,
  onAddSubtask,
  onUpdated,
}: ProjectDetailPageProps) {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [sections, setSections] = useState<Section[]>([])

  const refreshSections = useCallback(() => {
    listSections(project.id)
      .then(setSections)
      .catch(() => {})
  }, [project.id])

  useEffect(() => {
    refreshSections()
  }, [refreshSections])

  // Sections can be created inline from the task editor (Task 11/13), so
  // refresh the lane list whenever a task mutation comes back, not just on
  // project switch.
  const handleUpdated = useCallback(() => {
    onUpdated()
    refreshSections()
  }, [onUpdated, refreshSections])

  const projectTasks = useMemo(() => {
    return tasks.filter((t) => t.project_id === project.id)
  }, [tasks, project.id])

  const filteredTasks = useMemo(() => {
    if (statusFilter === 'all') return projectTasks
    return projectTasks.filter((t) => t.status === statusFilter)
  }, [projectTasks, statusFilter])

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: projectTasks.length }
    for (const t of projectTasks) {
      counts[t.status] = (counts[t.status] || 0) + 1
    }
    return counts
  }, [projectTasks])

  const topLevelCount = projectTasks.filter((t) => !t.parent_id && !t.completed).length

  const handleAddSubtask = useCallback(
    async (parentId: string, content: string) => {
      onAddSubtask(parentId, content)
    },
    [onAddSubtask],
  )

  const projectTitle = (
    <span className="flex items-center gap-2">
      <span
        className="size-2.5 rounded-full shrink-0"
        style={{ backgroundColor: project.color }}
      />
      {project.name}
    </span>
  )

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
    </>
  )

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-w-0">
      <PageHeader
        title={projectTitle}
        meta={`${topLevelCount} active task${topLevelCount !== 1 ? 's' : ''}`}
        backAction={{ label: 'All Tasks', onClick: onBack }}
        secondary={filterPills}
      />
      <div className="py-6 flex-1 min-w-0">
        <div className="w-full max-w-[600px] mx-auto min-w-0">
        {/* Task list */}
        {filteredTasks.length === 0 ? (
          <p className="text-body text-muted-foreground text-center py-8">
            {statusFilter === 'all'
              ? 'No tasks in this project yet.'
              : `No ${statusFilter.replace('_', ' ')} tasks.`}
          </p>
        ) : (
          <SectionedTaskList
            tasks={filteredTasks}
            sections={sections}
            projects={allProjects}
            projectName={project.name}
            projectColor={project.color}
            onDelete={onDeleteTask}
            onAddSubtask={handleAddSubtask}
            onUpdated={handleUpdated}
          />
        )}

        {/* Inline task creator */}
        <TaskCreator projectId={project.id} onAdd={onAddTask} />
        </div>
      </div>
    </div>
  )
}
