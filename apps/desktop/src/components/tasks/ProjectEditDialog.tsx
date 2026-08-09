import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Project } from '@nimble/types'

const PROJECT_COLORS = [
  '#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#f43f5e', '#8b5cf6', '#14b8a6',
]

interface ProjectEditDialogProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRename: (id: string, name: string) => void
  onUpdateColor: (id: string, color: string) => void
}

export function ProjectEditDialog({
  project,
  open,
  onOpenChange,
  onRename,
  onUpdateColor,
}: ProjectEditDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])

  useEffect(() => {
    if (project) {
      setName(project.name)
      setColor(project.color)
    }
  }, [project])

  const handleSave = () => {
    if (!project) return
    const trimmed = name.trim()
    if (trimmed && trimmed !== project.name) onRename(project.id, trimmed)
    if (color !== project.color) onUpdateColor(project.id, color)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name" className="text-meta">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-meta">Color</Label>
            <div className="flex items-center gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-6 rounded-full border-2 transition-all',
                    color === c
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:border-muted-foreground/50',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Set color ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
