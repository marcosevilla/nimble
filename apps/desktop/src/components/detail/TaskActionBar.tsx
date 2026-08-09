import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Trash2, FolderInput, Sparkles, Play } from 'lucide-react'
import { useFocusStore } from '@/stores/focusStore'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { toast } from 'sonner'
import { taskToast } from '@/lib/taskToast'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { LocalTask, Project } from '@nimble/types'

interface TaskActionBarProps {
  task: LocalTask
  projects: Project[]
  onDeleted: () => void
}

export function TaskActionBar({ task, projects, onDeleted }: TaskActionBarProps) {
  const dp = useDataProvider()
  const [breaking, setBreaking] = useState(false)
  const focusActive = useFocusStore((s) => s.isActive)

  const handleMove = useCallback(async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    try {
      await dp.tasks.update({ id: task.id, projectId })
      taskToast(`Moved to ${project?.name ?? 'project'}`, task.id)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to move: ${e}`)
    }
  }, [task.id, projects, dp])

  const handleBreakDown = useCallback(async () => {
    setBreaking(true)
    try {
      const subtasks = await dp.ai.breakDownTask(task.content, task.description ?? undefined)
      let created = 0
      for (const content of subtasks) {
        try {
          await dp.tasks.create({ content, parentId: task.id, projectId: task.project_id })
          created++
        } catch { /* skip */ }
      }
      dp.activity.log('task_breakdown_applied', task.id, { subtask_count: created }).catch(() => {})
      taskToast(`Created ${created} subtasks`, task.id)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Breakdown failed: ${e}`)
    } finally {
      setBreaking(false)
    }
  }, [task, dp])

  const handleDelete = useCallback(async () => {
    try {
      await dp.tasks.delete(task.id)
      emitTasksChanged()
      toast.success('Task deleted')
      onDeleted()
    } catch (e) {
      toast.error(`Failed to delete: ${e}`)
    }
  }, [task.id, onDeleted, dp])

  const handleFocus = useCallback(() => {
    // Open the focus play menu by dispatching to the store
    useFocusStore.getState().beginSetup(task)
  }, [task])

  // Menu variant — vertical list for popover
  return (
    <div className="flex flex-col">
      {/* Focus */}
      {!task.completed && !focusActive && (
        <MenuItem icon={Play} label="Start focus" onClick={handleFocus} />
      )}

      {/* Break down */}
      <MenuItem
        icon={Sparkles}
        label={breaking ? 'Breaking down...' : 'Break down with AI'}
        onClick={handleBreakDown}
        disabled={breaking}
      />

      {/* Move to project */}
      <DropdownMenu>
        <DropdownMenuTrigger className="w-full">
          <MenuItem icon={FolderInput} label="Move to project" onClick={() => {}} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" sideOffset={4} className="w-36">
          {projects
            .filter((p) => p.id !== task.project_id)
            .map((p) => (
              <DropdownMenuItem
                key={p.id}
                className="gap-2"
                onClick={() => handleMove(p.id)}
              >
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Separator */}
      <div className="mx-1.5 my-1 border-t border-border/20" />

      {/* Delete */}
      <MenuItem
        icon={Trash2}
        label="Delete"
        onClick={handleDelete}
        className="text-destructive/60 hover:text-destructive"
      />
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  icon: typeof Trash2
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent/20',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {children}
    </button>
  )
}
