import type { Project } from '@nimble/types'

interface ProjectPickerMenuProps {
  projects: Project[]
  excludeProjectId?: string
  onSelect: (projectId: string) => void
}

export function ProjectPickerMenu({ projects, excludeProjectId, onSelect }: ProjectPickerMenuProps) {
  const filtered = excludeProjectId
    ? projects.filter((p) => p.id !== excludeProjectId)
    : projects

  if (filtered.length === 0) return null

  return (
    <div className="w-36 rounded-lg border border-border/30 bg-popover p-1 shadow-lg">
      {filtered.map((p) => (
        <button
          key={p.id}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body hover:bg-accent/20 transition-colors"
          onClick={() => onSelect(p.id)}
        >
          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="truncate">{p.name}</span>
        </button>
      ))}
    </div>
  )
}
