import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useDetailStore } from '@/stores/detailStore'
import { useTaskDetail } from '@/hooks/useTaskDetail'
import { useProjects } from '@/hooks/useLocalTasks'
import { useDataProvider } from '@/services/provider-context'
import type { LocalTask as LocalTaskType, Document } from '@nimble/types'
import { useDocsStore } from '@/stores/docsStore'
import { useAppStore } from '@/stores/appStore'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { cn } from '@/lib/utils'
import { StatusDropdown } from '@/components/tasks/StatusDropdown'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkles, FileText, X as XIcon } from 'lucide-react'
import { InlineTitle } from './InlineTitle'
import { TiptapEditor } from '@/components/docs/TiptapEditor'
import { DetailBreadcrumbs } from './DetailBreadcrumbs'
import { TaskActionBar } from './TaskActionBar'
import { TaskActivityLog } from './TaskActivityLog'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { IconButton } from '@/components/shared/IconButton'
import { PanelRight, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

import { PRIORITY_LABELS } from '@/lib/priorities'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { Meta } from '@/components/shared/typography'

export function TaskDetailPage() {
  const dp = useDataProvider()
  const target = useDetailStore((s) => s.target)
  const switchMode = useDetailStore((s) => s.switchMode)
  const close = useDetailStore((s) => s.close)
  const drillDown = useDetailStore((s) => s.drillDown)

  const { task, subtasks, project, loading } = useTaskDetail(target?.id ?? null)
  const { projects } = useProjects()

  const [subInput, setSubInput] = useState('')
  const [subInputFocused, setSubInputFocused] = useState(false)
  const [breakingDown, setBreakingDown] = useState(false)
  const [linkedDocTitle, setLinkedDocTitle] = useState<string | null>(null)

  // Load linked doc title
  useEffect(() => {
    if (task?.linked_doc_id) {
      dp.docs.getDocument(task.linked_doc_id).then((doc) => setLinkedDocTitle(doc?.title ?? null)).catch(() => setLinkedDocTitle(null))
    } else {
      setLinkedDocTitle(null)
    }
  }, [task?.linked_doc_id, dp])

  const handleSaveTitle = useCallback(async (content: string) => {
    if (!task) return
    await dp.tasks.update({ id: task.id, content })
    emitTasksChanged()
  }, [task, dp])

  // Task 12 fix (review finding 1): unconditional markdown mode is a
  // corrupting load path for descriptions the one-time backfill hasn't
  // converted yet — loading an HTML description through the markdown parser
  // renders literal tag soup, and the next debounced save would persist that
  // garbled text as the new "markdown". Sniff per-row with the same
  // `<`-prefix heuristic the backfill migration uses (db::tasks::
  // preview_tasks_markdown_migration), so an un-migrated task keeps loading
  // and saving as HTML — lossless round-trip via TiptapEditor's HTML
  // path — until the Settings backfill converts it.
  //
  // Frozen for the life of this task view: keyed on `task?.id` only, not
  // `task?.description`, so a debounced save mid-edit (which changes
  // `task.description` to the just-saved value) can never flip the format
  // out from under an open editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately not reacting to description changes, see comment above
  const descFormat = useMemo<'html' | 'markdown'>(() => {
    const initial = task?.description ?? ''
    return initial.trim().startsWith('<') ? 'html' : 'markdown'
  }, [task?.id])

  const lastSavedDesc = useRef(task?.description ?? '')
  const handleSaveDescription = useCallback(async (description: string) => {
    if (!task) return
    // Skip if content hasn't actually changed (prevents save loops)
    if (description === lastSavedDesc.current) return
    lastSavedDesc.current = description
    await dp.tasks.update({ id: task.id, description })
    // Don't emit tasksChanged here — avoids refresh loop with Tiptap
  }, [task, dp])

  const handleAIBreakdown = useCallback(async () => {
    if (!task) return
    setBreakingDown(true)
    try {
      const subtaskTitles = await dp.ai.breakDownTask(task.content, task.description ?? undefined)
      let created = 0
      for (const content of subtaskTitles) {
        try {
          await dp.tasks.create({ content, parentId: task.id, projectId: task.project_id })
          created++
        } catch { /* skip */ }
      }
      dp.activity.log('task_breakdown_applied', task.id, { subtask_count: created }).catch(() => {})
      toast.success(`Created ${created} subtasks`)
      emitTasksChanged()
      setSubInputFocused(false)
    } catch (e) {
      toast.error(`Breakdown failed: ${e}`)
    } finally {
      setBreakingDown(false)
    }
  }, [task, dp])

  const handleAddSubtask = useCallback(async () => {
    if (!task || !subInput.trim()) return
    try {
      await dp.tasks.create({ content: subInput.trim(), parentId: task.id, projectId: task.project_id })
      emitTasksChanged()
      setSubInput('')
    } catch (e) {
      toast.error(`Failed to add subtask: ${e}`)
    }
  }, [task, subInput, dp])

  const handlePriorityChange = useCallback(async (priority: number) => {
    if (!task) return
    await dp.tasks.update({ id: task.id, priority })
    emitTasksChanged()
  }, [task, dp])

  if (loading) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    )
  }

  if (!task) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <p className="text-body text-muted-foreground">Task not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header: breadcrumbs + actions */}
      <div className="flex items-start justify-between">
        <DetailBreadcrumbs />
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton
            onClick={() => switchMode('sidebar')}
            size="lg"
            tone="subtle"
            title="Pin to sidebar"
          >
            <PanelRight className="size-4" />
          </IconButton>
          <Popover>
            <PopoverTrigger className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors">
              <MoreHorizontal className="size-4" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" sideOffset={4} className="w-44 gap-0 p-1">
              <TaskActionBar task={task} projects={projects} onDeleted={close} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Project + metadata row */}
      <div className="flex items-center gap-3 flex-wrap text-body">
        {project && (
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: project.color }} />
            <Meta>{project.name}</Meta>
          </div>
        )}
        <Popover>
          <PopoverTrigger className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-meta text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors">
            <PriorityBars priority={task.priority} />
            {PRIORITY_LABELS[task.priority].label}
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" sideOffset={4} className="w-36 gap-0 p-1">
            {[1, 2, 3, 4].map((p) => (
              <button
                key={p}
                onClick={() => handlePriorityChange(p)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body transition-colors',
                  task.priority === p ? 'bg-accent/40' : 'hover:bg-accent/20',
                )}
              >
                <PriorityBars priority={p} />
                {PRIORITY_LABELS[p].label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {task.due_date && (
          <Meta as="time">Due {format(parseISO(task.due_date), 'MMM d')}</Meta>
        )}
      </div>

      {/* Status + Title */}
      <div className="flex items-start gap-3">
        <div className="mt-1">
          <StatusDropdown taskId={task.id} status={task.status ?? 'todo'} size="md" />
        </div>
        <div className="flex-1 min-w-0">
          <InlineTitle value={task.content} completed={task.completed} onSave={handleSaveTitle} />
        </div>
      </div>

      {/* Description */}
      {/* Description — rich text with @mentions. Markdown-canonical: local_tasks.description
          is markdown for every description saved from here forward (Todoist sync/import and
          R3's CLI already write it verbatim, no conversion layer). Pre-existing HTML
          descriptions keep loading/saving as HTML (descFormat above) until the Settings
          backfill converts them — see Task 12 fix report. */}
      <TiptapEditor
        key={task.id}
        content={task.description ?? ''}
        onChange={handleSaveDescription}
        placeholder="Add a description..."
        format={descFormat}
      />

      {/* Subtasks */}
      <div className="space-y-2">
        {subtasks.length > 0 && (
          <div className="space-y-0.5">
            {subtasks.map((sub) => (
              <div
                key={sub.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/10 transition-colors"
              >
                <StatusDropdown taskId={sub.id} status={sub.status ?? 'todo'} />
                <button
                  onClick={() => drillDown({ type: 'task', id: sub.id })}
                  className={cn(
                    'flex-1 min-w-0 truncate text-left text-body hover:text-foreground transition-colors',
                    sub.completed && 'text-muted-foreground line-through',
                  )}
                >
                  {sub.content}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* AI breakdown loading state */}
        {breakingDown && (
          <div className="space-y-2 py-2 animate-in fade-in duration-300">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                <Sparkles className="size-3.5 text-purple-500 ai-star-1" />
                <Sparkles className="size-3 text-purple-400 ai-star-2" />
                <Sparkles className="size-2.5 text-purple-300 ai-star-3" />
              </div>
              <Meta>Breaking down with AI...</Meta>
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-7 w-full rounded-md" />
              <Skeleton className="h-7 w-5/6 rounded-md" />
              <Skeleton className="h-7 w-4/6 rounded-md" />
              <Skeleton className="h-7 w-5/6 rounded-md" />
            </div>
          </div>
        )}

        {/* Add subtask */}
        {!breakingDown && <div>
          {subInputFocused || subInput ? (
            <div className="space-y-1">
              <input
                value={subInput}
                onChange={(e) => setSubInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask() }
                  if (e.key === 'Escape') { setSubInput(''); setSubInputFocused(false) }
                  if (e.key === 'b' && e.metaKey) { e.preventDefault(); handleAIBreakdown() }
                }}
                onBlur={() => { if (!subInput) setSubInputFocused(false) }}
                placeholder="Add a subtask..."
                className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground py-1"
                autoFocus
              />
              <p className="text-label text-muted-foreground">
                or break down with AI <kbd className="rounded bg-muted/40 px-1 py-0.5 font-mono text-label">{'\u2318'}B</kbd>
              </p>
            </div>
          ) : (
            <p
              onClick={() => setSubInputFocused(true)}
              className="text-body text-muted-foreground cursor-text hover:text-muted-foreground transition-colors py-1"
            >
              Add a subtask...
            </p>
          )}
        </div>}
      </div>

      {/* Linked doc */}
      <LinkedDocSection task={task} linkedDocTitle={linkedDocTitle} />

      {/* Separator */}
      <div className="border-t border-border/30" />

      {/* Activity log */}
      <TaskActivityLog taskId={task.id} />
    </div>
  )
}

// ── Linked Doc Section ──

function LinkedDocSection({ task, linkedDocTitle }: { task: LocalTaskType; linkedDocTitle: string | null }) {
  const dp = useDataProvider()
  const [showPicker, setShowPicker] = useState(false)
  const [docs, setDocs] = useState<Document[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  const loadDocs = useCallback(async () => {
    try {
      const allDocs = await dp.docs.getDocuments()
      setDocs(allDocs)
    } catch { /* skip */ }
  }, [dp])

  useEffect(() => {
    if (showPicker) loadDocs()
  }, [showPicker, loadDocs])

  const filtered = searchQuery.trim()
    ? docs.filter((d) => d.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : docs

  const handleLink = useCallback(async (docId: string) => {
    try {
      await dp.tasks.update({ id: task.id, linkedDocId: docId })
      emitTasksChanged()
      setShowPicker(false)
      setSearchQuery('')
    } catch (e) {
      toast.error(`Failed to link doc: ${e}`)
    }
  }, [task.id, dp])

  const handleUnlink = useCallback(async () => {
    try {
      await dp.tasks.update({ id: task.id, linkedDocId: null })
      emitTasksChanged()
    } catch { /* skip */ }
  }, [task.id, dp])

  if (task.linked_doc_id && linkedDocTitle) {
    return (
      <div className="flex items-center gap-2">
        <FileText className="size-3 shrink-0 text-muted-foreground" />
        <button
          onClick={() => {
            useDocsStore.getState().selectDoc(task.linked_doc_id!)
            useAppStore.getState().setCurrentPage('docs')
          }}
          className="text-meta text-accent-blue hover:underline"
        >
          {linkedDocTitle}
        </button>
        <button onClick={handleUnlink} className="text-muted-foreground hover:text-foreground">
          <XIcon className="size-3" />
        </button>
      </div>
    )
  }

  if (showPicker) {
    return (
      <div className="space-y-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowPicker(false); setSearchQuery('') } }}
          placeholder="Search docs..."
          className="w-full bg-transparent text-body outline-none border-b border-border/20 py-1 placeholder:text-muted-foreground"
          autoFocus
        />
        <div className="max-h-32 overflow-y-auto space-y-0.5">
          {filtered.slice(0, 8).map((doc) => (
            <button
              key={doc.id}
              onClick={() => handleLink(doc.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-body hover:bg-accent/20 transition-colors"
            >
              <FileText className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{doc.title || 'Untitled'}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-meta text-muted-foreground py-1">No docs found</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <p
      onClick={() => setShowPicker(true)}
      className="text-meta text-muted-foreground cursor-pointer hover:text-muted-foreground transition-colors"
    >
      Link a doc...
    </p>
  )
}
