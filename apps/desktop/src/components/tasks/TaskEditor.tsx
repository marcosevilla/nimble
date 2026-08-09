import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type { LocalTask, Project } from '@nimble/types'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { PriorityBars } from '@/components/shared/PriorityBars'

const PRIORITY_OPTIONS = [
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

interface TaskEditorProps {
  task: LocalTask
  projects: Project[]
  onClose: () => void
  onUpdated: (task: LocalTask) => void
}

export function TaskEditor({ task, projects, onClose, onUpdated }: TaskEditorProps) {
  const dp = useDataProvider()
  const [content, setContent] = useState(task.content)
  const [description, setDescription] = useState(task.description ?? '')
  const [projectId, setProjectId] = useState(task.project_id)
  const [priority, setPriority] = useState(task.priority)
  const [dueDate, setDueDate] = useState(task.due_date ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Track changes
  useEffect(() => {
    const changed =
      content !== task.content ||
      description !== (task.description ?? '') ||
      projectId !== task.project_id ||
      priority !== task.priority ||
      dueDate !== (task.due_date ?? '')
    setDirty(changed)
  }, [content, description, projectId, priority, dueDate, task])

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const updated = await dp.tasks.update({
        id: task.id,
        content: content.trim() || undefined,
        description: description.trim() || undefined,
        projectId: projectId !== task.project_id ? projectId : undefined,
        priority: priority !== task.priority ? priority : undefined,
        dueDate: dueDate || undefined,
        clearDueDate: !dueDate && !!task.due_date,
      })
      onUpdated(updated)
      onClose()
    } catch (e) {
      toast.error(`Failed to update: ${e}`)
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, task, content, description, projectId, priority, dueDate, onUpdated, onClose, dp])

  // Save on Cmd+Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [handleSave, onClose],
  )

  return (
    <div
      className="rounded-lg border bg-card p-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-label text-muted-foreground">Edit task</span>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-3" />
        </Button>
      </div>

      {/* Title */}
      <Input
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="text-body-strong"
        placeholder="Task name"
      />

      {/* Description */}
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add a description..."
        className="text-body min-h-[60px]"
      />

      {/* Metadata row */}
      <div className="flex flex-wrap gap-4">
        {/* Priority */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Priority</label>
          <div className="flex gap-1">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPriority(opt.value)}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-0.5 text-label transition-colors',
                  priority === opt.value
                    ? 'bg-accent/40 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/20',
                )}
              >
                <PriorityBars priority={opt.value} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Due date */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Due date</label>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-7 text-meta w-auto"
            />
            {dueDate && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setDueDate('')}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Project */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Project</label>
          <div className="flex flex-wrap gap-1">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setProjectId(p.id)}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-0.5 text-label transition-colors',
                  projectId === p.id
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-label text-muted-foreground">
          {dirty ? '⌘Enter to save' : 'No changes'}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
