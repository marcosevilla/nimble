import { cn } from '@/lib/utils'
import { PRIORITY_COLORS } from '@/lib/priorities'
import { Check, Plus, PenLine, FolderInput, Sparkles, FileText, X, Loader2 } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { FocusPlayMenu } from '@/components/focus/FocusPlayMenu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { LocalTask, Project, Document, Capture } from '@daily-triage/types'

export type BarMode = 'search' | 'task' | 'capture' | 'breakdown' | 'doc'

interface CommandBarResultsProps {
  query: string
  mode: BarMode
  tasks: LocalTask[]
  docResults: Document[]
  captureResults: Capture[]
  projects: Project[]
  selectedIndex: number
  onComplete: (id: string) => void
  onMove: (id: string, projectId: string) => void
  onBreakDown: (task: LocalTask) => void
  onOpenDoc: (docId: string) => void
  onOpenCapture: (captureId: string) => void
  onCreateTask: () => void
  onCapture: () => void
  onSelect: (index: number) => void
  // Breakdown state
  breakdownTask: LocalTask | null
  breakdownLoading: boolean
  breakdownItems: string[]
  onBreakdownEdit: (index: number, value: string) => void
  onBreakdownRemove: (index: number) => void
  onBreakdownConfirm: () => void
  onBreakdownCancel: () => void
}

export function CommandBarResults({
  query,
  mode,
  tasks,
  docResults,
  captureResults,
  projects,
  selectedIndex,
  onComplete,
  onMove,
  onBreakDown,
  onOpenDoc,
  onOpenCapture,
  onCreateTask,
  onCapture,
  onSelect,
  breakdownTask,
  breakdownLoading,
  breakdownItems,
  onBreakdownEdit,
  onBreakdownRemove,
  onBreakdownConfirm,
  onBreakdownCancel,
}: CommandBarResultsProps) {
  const projectMap: Record<string, Project> = {}
  for (const p of projects) projectMap[p.id] = p

  const docStartIndex = tasks.length
  const captureStartIndex = docStartIndex + docResults.length
  const createIndex = captureStartIndex + captureResults.length
  const captureIndex = createIndex + 1

  // Breakdown mode
  if (breakdownTask) {
    return (
      <div className="animate-in fade-in slide-in-from-top-1 duration-150">
        <div className="rounded-xl border border-border/50 bg-popover shadow-lg overflow-hidden">
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-label text-muted-foreground">
                Breaking down: <span className="text-foreground">{breakdownTask.content}</span>
              </span>
              <button onClick={onBreakdownCancel} className="text-muted-foreground/40 hover:text-muted-foreground">
                <X className="size-3.5" />
              </button>
            </div>
            {breakdownLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center text-body text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Thinking...
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  {breakdownItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-meta text-muted-foreground/40 w-4 text-right shrink-0">{i + 1}</span>
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => onBreakdownEdit(i, e.target.value)}
                        className="flex-1 bg-muted/30 rounded-md px-2 py-1 text-body outline-none focus:ring-1 focus:ring-accent-blue/40"
                      />
                      <button
                        onClick={() => onBreakdownRemove(i)}
                        className="text-muted-foreground/30 hover:text-destructive shrink-0"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={onBreakdownCancel}
                    className="rounded-md px-2.5 py-1 text-meta text-muted-foreground hover:bg-accent/20"
                  >
                    Cancel
                  </button>
                  {/* font-medium kept for contrast on foreground bg */}
                  <button
                    onClick={onBreakdownConfirm}
                    className="rounded-md bg-foreground px-2.5 py-1 text-meta text-background font-medium hover:bg-foreground/90"
                  >
                    Create {breakdownItems.filter(Boolean).length} subtasks
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const showCreate = mode !== 'capture' && mode !== 'doc'
  const showCapture = mode !== 'task' && mode !== 'doc'
  const showTasks = mode !== 'task' && mode !== 'capture' && mode !== 'doc'
  const showDocs = mode === 'search' || mode === 'doc'
  const showCaptures = mode === 'search'

  return (
    <div className="animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="rounded-xl border border-border/50 bg-popover shadow-lg overflow-hidden">
        {/* Search results */}
        {showTasks && tasks.length > 0 && (
          <div className="max-h-52 overflow-y-auto p-1">
            <div className="px-2 py-1">
              <span className="text-label text-muted-foreground/60">
                Tasks
              </span>
            </div>
            {tasks.map((task, i) => (
              <TaskResultRow
                key={task.id}
                task={task}
                project={projectMap[task.project_id]}
                projects={projects}
                isSelected={selectedIndex === i}
                onSelect={() => onSelect(i)}
                onComplete={() => onComplete(task.id)}
                onMove={(projectId) => onMove(task.id, projectId)}
                onBreakDown={() => onBreakDown(task)}
              />
            ))}
          </div>
        )}

        {/* Doc results */}
        {showDocs && docResults.length > 0 && (
          <div className="p-1">
            {tasks.length > 0 && <div className="mx-1 mb-1 border-t border-border/30" />}
            <div className="px-2 py-1">
              <span className="text-label text-muted-foreground/60">
                Docs
              </span>
            </div>
            {docResults.map((doc, i) => {
              const idx = docStartIndex + i
              return (
                <button
                  key={doc.id}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors',
                    selectedIndex === idx ? 'bg-accent/40' : 'hover:bg-accent/20',
                  )}
                  onMouseEnter={() => onSelect(idx)}
                  onClick={() => onOpenDoc(doc.id)}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground/40" />
                  <span className="flex-1 min-w-0 truncate">{doc.title || 'Untitled'}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Note results */}
        {showCaptures && captureResults.length > 0 && (
          <div className="p-1">
            {(tasks.length > 0 || docResults.length > 0) && <div className="mx-1 mb-1 border-t border-border/30" />}
            <div className="px-2 py-1">
              <span className="text-label text-muted-foreground/60">
                Notes
              </span>
            </div>
            {captureResults.map((capture, i) => {
              const idx = captureStartIndex + i
              return (
                <button
                  key={capture.id}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors',
                    selectedIndex === idx ? 'bg-accent/40' : 'hover:bg-accent/20',
                  )}
                  onMouseEnter={() => onSelect(idx)}
                  onClick={() => onOpenCapture(capture.id)}
                >
                  <PenLine className="size-3.5 shrink-0 text-muted-foreground/40" />
                  <span className="flex-1 min-w-0 truncate">{capture.content}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Separator */}
        {(tasks.length > 0 || docResults.length > 0 || captureResults.length > 0) && (showCreate || showCapture) && (
          <div className="mx-2 border-t border-border/30" />
        )}

        {/* Actions */}
        <div className="p-1">
          {showCreate && (
            <button
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors',
                selectedIndex === createIndex ? 'bg-accent/40' : 'hover:bg-accent/20',
              )}
              onMouseEnter={() => onSelect(createIndex)}
              onClick={onCreateTask}
            >
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Create task</span>
              <span className="flex-1 min-w-0 truncate font-medium">"{query}"</span>
              {selectedIndex === createIndex && (
                <kbd className="rounded bg-muted px-1 py-0.5 text-label text-muted-foreground">Enter</kbd>
              )}
            </button>
          )}
          {showCapture && (
            <button
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors',
                selectedIndex === captureIndex ? 'bg-accent/40' : 'hover:bg-accent/20',
              )}
              onMouseEnter={() => onSelect(captureIndex)}
              onClick={onCapture}
            >
              <PenLine className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Save as note</span>
              <span className="flex-1 min-w-0 truncate font-medium">"{query}"</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Task Result Row with inline actions ──

function TaskResultRow({
  task,
  project,
  projects,
  isSelected,
  onSelect,
  onComplete,
  onMove,
  onBreakDown,
}: {
  task: LocalTask
  project?: Project
  projects: Project[]
  isSelected: boolean
  onSelect: () => void
  onComplete: () => void
  onMove: (projectId: string) => void
  onBreakDown: () => void
}) {
  return (
    <div
      className={cn(
        'group/result relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body transition-colors',
        isSelected ? 'bg-accent/40' : 'hover:bg-accent/20',
      )}
      onMouseEnter={onSelect}
    >
      {/* Priority dot */}
      {task.priority > 1 ? (
        <span className={cn('size-2 shrink-0 rounded-full', PRIORITY_COLORS[task.priority])} />
      ) : (
        <span className="w-2 shrink-0" />
      )}

      {/* Content */}
      <span className="flex-1 min-w-0 truncate">{task.content}</span>

      {/* Project badge (when not selected) */}
      {!isSelected && project && project.id !== 'inbox' && (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-label text-muted-foreground">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: project.color }} />
          {project.name}
        </span>
      )}

      {/* Action buttons (when selected) */}
      {isSelected && (
        <div className="flex shrink-0 items-center gap-0.5">
          <ActionButton icon={Check} hint="⌥C" title="Complete" onClick={onComplete} className="text-green-500/70 hover:text-green-500" />
          <FocusPlayMenu task={task} />
          <ActionButton icon={Sparkles} hint="⌥B" title="Break down" onClick={onBreakDown} className="text-purple-400/70 hover:text-purple-400" />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent/30 text-muted-foreground/50 hover:text-muted-foreground">
              <Tooltip>
                <TooltipTrigger className="flex size-6 items-center justify-center">
                  <FolderInput className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-meta">
                  Move to project <kbd className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-label">⌥M</kbd>
                </TooltipContent>
              </Tooltip>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" sideOffset={4} align="end" className="w-36">
              {projects
                .filter((p) => p.id !== task.project_id)
                .map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    className="gap-2"
                    onClick={() => onMove(p.id)}
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

function ActionButton({
  icon: Icon,
  hint,
  title,
  onClick,
  className,
}: {
  icon: typeof Check
  hint: string
  title: string
  onClick: () => void
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={(e) => { e.stopPropagation(); onClick() }}
        className={cn(
          'flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent/30',
          className,
        )}
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="text-meta">
        {title} <kbd className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-label">{hint}</kbd>
      </TooltipContent>
    </Tooltip>
  )
}
