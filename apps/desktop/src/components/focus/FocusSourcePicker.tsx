import { useState, type ReactNode } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/shared/IconButton'
import { Caption, Meta } from '@/components/shared/typography'
import { dueLabel, sourceLabel } from '@/lib/focusQueueIntents'
import type { FocusSource, LocalTask, Project } from '@nimble/types'

const LOCAL = 'local'
const TODAY = 'today'

const sourceKey = (source: FocusSource) => (source.kind === 'project' ? `project:${source.project_id}` : source.kind)

function sourceFromKey(key: string): FocusSource {
  if (key === TODAY) return { kind: 'today' }
  if (key === LOCAL) return { kind: 'local' }
  return { kind: 'project', project_id: key.slice('project:'.length) }
}

interface FocusSourcePickerProps {
  source: FocusSource
  projects: Project[]
  onSourceChange: (source: FocusSource) => void
  /** Candidates in this source not already queued. */
  newCount: number
  onQueueThese: () => void
  /** Why queue writes are unavailable (button stays visible, disabled). */
  blockedReason: string | null
  doneCount: number
  /** Replica/sync note, e.g. "Last synced 9:41 AM". */
  syncNote: string | null
  /** Secondary footer controls (e.g. mute). */
  trailing?: ReactNode
}

/**
 * Bottom-anchored footer: the source selector browses candidates only — it
 * never replaces or reorders the shared queue. "Queue these" is the explicit
 * append. Completion count and sync state sit on the right.
 */
export function FocusSourcePicker({
  source,
  projects,
  onSourceChange,
  newCount,
  onQueueThese,
  blockedReason,
  doneCount,
  syncNote,
  trailing,
}: FocusSourcePickerProps) {
  const label = sourceLabel(source, projects)
  return (
    <footer className="flex min-w-0 items-center justify-between gap-2 border-t border-border px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Focus candidates: ${label}`}
            className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-meta-strong text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground focus-ring"
          >
            <span className="max-w-36 truncate">{label}</span>
            <ChevronDown className="size-3 shrink-0" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="max-h-64 w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Browse candidates</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sourceKey(source)} onValueChange={(key) => onSourceChange(sourceFromKey(String(key)))}>
                <DropdownMenuRadioItem value={TODAY}>Today</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value={LOCAL}>Local only</DropdownMenuRadioItem>
                {projects.length > 0 && <DropdownMenuSeparator />}
                {projects.map((project) => (
                  <DropdownMenuRadioItem key={project.id} value={`project:${project.id}`}>
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="xs"
          variant="ghost"
          disabled={blockedReason != null || newCount === 0}
          title={blockedReason ?? (newCount === 0 ? 'Everything here is already queued' : 'Append these to the end of the queue')}
          onClick={onQueueThese}
        >
          {`Queue these (${newCount})`}
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {doneCount > 0 && <Caption>{`${doneCount} done`}</Caption>}
        {syncNote && <Caption title={syncNote}>{syncNote}</Caption>}
        {trailing}
      </div>
    </footer>
  )
}

interface FocusStillOpenDrawerProps {
  tasks: LocalTask[]
  today: string
  blockedReason: string | null
  /** Explicit add; flagged as still-open in the queue entry. */
  onAdd: (taskIds: string[]) => void
}

/** Collapsed "Still open" drawer: earlier open work is added only on request. */
export function FocusStillOpenDrawer({ tasks, today, blockedReason, onAdd }: FocusStillOpenDrawerProps) {
  const [open, setOpen] = useState(false)
  if (tasks.length === 0) return null
  return (
    <section aria-label="Still open" className="border-t border-border">
      <div className="flex items-center justify-between px-4 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md text-meta-strong text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground focus-ring"
        >
          {`Still open · ${tasks.length}`}
          <ChevronDown className={open ? 'size-3 rotate-180' : 'size-3'} aria-hidden />
        </button>
        {open && (
          <Button size="xs" variant="ghost" disabled={blockedReason != null} title={blockedReason ?? undefined} onClick={() => onAdd(tasks.map((t) => t.id))}>
            Queue all
          </Button>
        )}
      </div>
      {open && (
        <ul className="max-h-44 overflow-y-auto">
          {tasks.map((task) => (
            <li key={task.id} className="flex min-w-0 items-center gap-2 px-4 py-1">
              <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">{task.content}</span>
              <Meta className="shrink-0">{dueLabel(task, today)}</Meta>
              <IconButton
                size="md"
                aria-label={`Add ${task.content} to queue`}
                disabled={blockedReason != null}
                title={blockedReason ?? undefined}
                onClick={() => onAdd([task.id])}
                className="focus-ring disabled:opacity-50"
              >
                <Plus className="size-3" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
