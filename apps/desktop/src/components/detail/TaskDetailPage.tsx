import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useDetailStore } from '@/stores/detailStore'
import { useTaskDetail } from '@/hooks/useTaskDetail'
import { useProjects } from '@/hooks/useLocalTasks'
import { useDataProvider } from '@/services/provider-context'
import type { Project, Section, Label } from '@nimble/types'
import { useAppStore } from '@/stores/appStore'
import { useTasksNavStore } from '@/stores/tasksNavStore'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { cn } from '@/lib/utils'
import { StatusDropdown } from '@/components/tasks/StatusDropdown'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkles, Plus, Settings, ChevronLeft } from 'lucide-react'
import { taskToast } from '@/lib/taskToast'
import { predictReschedule } from '@/lib/recurrence'
import { useQuickCreateStore } from '@/stores/quickCreateStore'
import { InlineTitle } from './InlineTitle'
import { TiptapEditor } from '@/components/docs/TiptapEditor'
import { Textarea } from '@/components/ui/textarea'
import { MetadataChips, type ChipValues } from '@/components/tasks/MetadataChips'
import { TaskItem, type TaskItemData } from '@/components/tasks/TaskItem'
import { labelColor } from '@/lib/labelColors'
import { DetailBreadcrumbs } from './DetailBreadcrumbs'
import { TaskActivityLog } from './TaskActivityLog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

export function TaskDetailPage() {
  const dp = useDataProvider()
  const target = useDetailStore((s) => s.target)
  const mode = useDetailStore((s) => s.mode)
  const close = useDetailStore((s) => s.close)
  const drillDown = useDetailStore((s) => s.drillDown)

  const { task, subtasks, project, loading } = useTaskDetail(target?.id ?? null)
  const { task: parentTask } = useTaskDetail(task?.parent_id ?? null)
  const { projects } = useProjects()

  const [breakingDown, setBreakingDown] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const [sections, setSections] = useState<Section[]>([])
  const [labels, setLabels] = useState<Label[]>([])

  useEffect(() => {
    dp.labels.list().then(setLabels).catch(() => setLabels([]))
  }, [dp])

  useEffect(() => {
    if (!task?.project_id) {
      setSections([])
      return
    }
    dp.sections.list(task.project_id).then(setSections).catch(() => setSections([]))
  }, [dp, task?.project_id])

  const labelsMap = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])

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

  // Legacy-HTML path (descFormat === 'html') — UNTOUCHED. Same TiptapEditor,
  // same debounced autosave via onChange, same lastSavedDesc guard. Task 9
  // only replaces the editing surface for the markdown-canonical path below.
  const lastSavedDesc = useRef(task?.description ?? '')
  const handleSaveDescription = useCallback(async (description: string) => {
    if (!task) return
    // Skip if content hasn't actually changed (prevents save loops)
    if (description === lastSavedDesc.current) return
    lastSavedDesc.current = description
    await dp.tasks.update({ id: task.id, description })
    // Don't emit tasksChanged here — avoids refresh loop with Tiptap
  }, [task, dp])

  // Markdown-canonical path (Decision 15): raw string in, raw string out.
  // Never touches Tiptap's markdown serializer on the write side — the
  // display-only <TiptapEditor format="markdown"> below has no onChange, so
  // there is no callback it could even reach.
  const [descEditing, setDescEditing] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const descTextareaRef = useRef<HTMLTextAreaElement>(null)

  const startEditingDescription = useCallback(() => {
    if (!task) return
    setDescDraft(task.description ?? '')
    setDescEditing(true)
  }, [task])

  const cancelEditingDescription = useCallback(() => {
    setDescEditing(false)
    setDescDraft(task?.description ?? '')
  }, [task])

  const saveDescriptionDraft = useCallback(async () => {
    if (!task) return
    setDescEditing(false)
    if (descDraft === (task.description ?? '')) return
    try {
      await dp.tasks.update({ id: task.id, description: descDraft })
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to save description: ${e}`)
    }
  }, [task, dp, descDraft])

  const handleDescKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditingDescription()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      saveDescriptionDraft()
    }
  }, [cancelEditingDescription, saveDescriptionDraft])

  useEffect(() => {
    if (!descEditing) return
    requestAnimationFrame(() => {
      const el = descTextareaRef.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }, [descEditing])

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
    } catch (e) {
      toast.error(`Breakdown failed: ${e}`)
    } finally {
      setBreakingDown(false)
    }
  }, [task, dp])

  // Unified chip patch handler — same dp.tasks.update() call every other
  // field on this page already uses, just routed through MetadataChips'
  // single onChange(patch) contract instead of one handler per field.
  const handleChipChange = useCallback(async (patch: Partial<ChipValues>) => {
    if (!task) return
    const updates: Parameters<typeof dp.tasks.update>[0] = { id: task.id }
    let touched = false

    if (patch.priority !== undefined) {
      updates.priority = patch.priority
      touched = true
    }
    if (patch.due !== undefined) {
      // DueDatePopover always emits the full DueValue (every field, even
      // ones untouched by this interaction) — deriving clear flags from
      // "value is null" instead of "value CHANGED" meant e.g. setting
      // Duration on a task with no due time sent clearDueTime: true, which
      // the Rust backend applies AFTER setting duration_minutes and nulls
      // both. Gate each set/clear on the incoming value actually differing
      // from the task's current value (mirrors the retired TaskEditor's
      // `dueTimeChanged && !dueTime && !!task.due_time` pattern), and only
      // clear a field the task actually has — this also stops the 3-4
      // no-op clear UPDATEs (activity-log + sync churn) on every due patch.
      const due = patch.due
      let dueTouched = false
      if (due.dueDate !== (task.due_date ?? null)) {
        updates.dueDate = due.dueDate ?? undefined
        updates.clearDueDate = due.dueDate === null && !!task.due_date
        dueTouched = true
      }
      if (due.dueTime !== (task.due_time ?? null)) {
        updates.dueTime = due.dueTime ?? undefined
        updates.clearDueTime = due.dueTime === null && !!task.due_time
        dueTouched = true
      }
      if (due.durationMinutes !== (task.duration_minutes ?? null)) {
        updates.durationMinutes = due.durationMinutes ?? undefined
        updates.clearDuration = due.durationMinutes === null && task.duration_minutes != null
        dueTouched = true
      }
      if (due.recurrenceRule !== (task.recurrence_rule ?? null)) {
        updates.recurrenceRule = due.recurrenceRule ?? undefined
        updates.clearRecurrence = due.recurrenceRule === null && !!task.recurrence_rule
        dueTouched = true
      }
      if (dueTouched) touched = true
    }
    if (patch.labelIds !== undefined) {
      updates.labelIds = patch.labelIds
      touched = true
    }
    if (patch.sectionId !== undefined) {
      updates.sectionId = patch.sectionId ?? undefined
      updates.clearSection = patch.sectionId === null
      touched = true
    }
    if (patch.linkedDocId !== undefined) {
      updates.linkedDocId = patch.linkedDocId
      touched = true
    }
    if (!touched) return

    try {
      await dp.tasks.update(updates)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to update task: ${e}`)
    }
  }, [task, dp])

  const chipValues = useMemo<ChipValues>(() => ({
    priority: task?.priority ?? 1,
    due: {
      dueDate: task?.due_date ?? null,
      dueTime: task?.due_time ?? null,
      durationMinutes: task?.duration_minutes ?? null,
      recurrenceRule: task?.recurrence_rule ?? null,
    },
    labelIds: task?.labels ?? [],
    projectId: task?.project_id,
    sectionId: task?.section_id ?? null,
    linkedDocId: task?.linked_doc_id ?? null,
  }), [task])

  // Breadcrumb (Decisions 2/3): full project ancestry chain (via parent_id,
  // walked through useProjects) + the parent task if this is a subtask.
  // Unlike the shared DetailBreadcrumbs (which replays the store's manually
  // pushed drillDown history), this is derived fresh from task/project data
  // every render — correct no matter how the viewer arrived at this task.
  const projectChain = useMemo<Project[]>(() => {
    if (!project) return []
    const chain: Project[] = []
    const seen = new Set<string>()
    let current: Project | null = project
    while (current && !seen.has(current.id)) {
      chain.unshift(current)
      seen.add(current.id)
      current = current.parent_id ? projects.find((p) => p.id === current!.parent_id) ?? null : null
    }
    return chain
  }, [project, projects])

  interface BreadcrumbSegment { label: string; onClick: () => void }

  const breadcrumbSegments = useMemo<BreadcrumbSegment[]>(() => {
    const segments: BreadcrumbSegment[] = projectChain.map((p) => ({
      label: p.name,
      // TasksPage's selected-project is local state (and the component is
      // unmounted while a body-mode detail is open), so the target project
      // travels through the one-shot tasksNavStore handoff instead of a
      // prop or shared selection.
      onClick: () => {
        useTasksNavStore.getState().requestProject(p.id)
        close()
        useAppStore.getState().setCurrentPage('tasks')
      },
    }))
    if (parentTask) {
      segments.push({
        label: parentTask.content,
        onClick: () => useDetailStore.getState().openTask(parentTask.id, mode),
      })
    }
    return segments
  }, [projectChain, parentTask, mode, close])

  const handleMoveToProject = useCallback(async (projectId: string) => {
    if (!task) return
    const targetProject = projects.find((p) => p.id === projectId)
    try {
      await dp.tasks.update({ id: task.id, projectId })
      emitTasksChanged()
      taskToast(`Moved to ${targetProject?.name ?? 'project'}`, task.id)
    } catch (e) {
      toast.error(`Failed to move: ${e}`)
    }
  }, [task, dp, projects])

  const handleDuplicateTask = useCallback(async () => {
    if (!task) return
    try {
      const created = await dp.tasks.create({
        content: task.content,
        description: task.description ?? undefined,
        projectId: task.project_id,
        parentId: task.parent_id ?? undefined,
        priority: task.priority,
        dueDate: task.due_date ?? undefined,
        dueTime: task.due_time ?? undefined,
        durationMinutes: task.duration_minutes ?? undefined,
        recurrenceRule: task.recurrence_rule ?? undefined,
        sectionId: task.section_id ?? undefined,
        labelIds: task.labels.length ? task.labels : undefined,
      })
      if (task.linked_doc_id) {
        await dp.tasks.update({ id: created.id, linkedDocId: task.linked_doc_id })
      }
      emitTasksChanged()
      taskToast('Task duplicated', created.id)
    } catch (e) {
      toast.error(`Failed to duplicate: ${e}`)
    }
  }, [task, dp])

  const handleCopyId = useCallback(() => {
    if (!task) return
    navigator.clipboard.writeText(task.id)
    toast.success('Task ID copied')
  }, [task])

  const handleDeleteTask = useCallback(async () => {
    if (!task) return
    if (!window.confirm('Delete this task?')) return
    try {
      await dp.tasks.delete(task.id)
      emitTasksChanged()
      toast.success('Task deleted')
      close()
    } catch (e) {
      toast.error(`Failed to delete: ${e}`)
    }
  }, [task, dp, close])

  // Recurring tasks reschedule instead of completing (Task 8) — the row's
  // due date just advances, no guilt copy, just a quiet confirmation of
  // where it landed. Predicted client-side (see lib/recurrence) so the
  // toast can fire immediately rather than waiting on a refetch; this
  // mirrors the exact rule the backend is about to apply, so it stays right
  // even if it never gets the chance to double check the server's answer.
  const handleTaskCompleted = useCallback(() => {
    if (!task) return
    const nextDue = predictReschedule(task.recurrence_rule, task.due_date)
    if (!nextDue) return
    taskToast(`Rescheduled to ${format(parseISO(nextDue), 'MMM d')}`, task.id)
  }, [task])

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

  const subtaskItems: TaskItemData[] = subtasks.map((sub) => ({
    id: sub.id,
    content: sub.content,
    priority: sub.priority,
    completed: sub.completed,
    status: sub.status,
    dueDate: sub.due_date,
    description: sub.description,
    source: 'local',
    labels: sub.labels
      .map((id) => labelsMap.get(id))
      .filter((l): l is Label => !!l)
      .map((l) => ({ name: l.name, color: labelColor(l.color) })),
  }))

  return (
    <div className="mx-auto w-full max-w-[600px] pt-[30px] flex flex-col gap-6">
      {/* Top row: breadcrumb (left) + gear trigger (right) — no paperclip
          (Decision 13), no other actions in the right cluster. */}
      <div className="flex items-center justify-between gap-2 min-h-6">
        {breadcrumbSegments.length > 0 ? (
          <div className="flex min-w-0 items-center gap-1">
            <ChevronLeft className="size-3 shrink-0 text-muted-foreground/70" />
            {breadcrumbSegments.map((seg, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {i > 0 && <span className="text-meta text-muted-foreground/70">/</span>}
                <button
                  type="button"
                  onClick={seg.onClick}
                  className="truncate max-w-[160px] text-meta text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {seg.label}
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Task actions"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} className="w-44">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to project…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.filter((p) => p.id !== task.project_id).map((p) => (
                  <DropdownMenuItem key={p.id} className="gap-2" onClick={() => handleMoveToProject(p.id)}>
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
                {projects.filter((p) => p.id !== task.project_id).length === 0 && (
                  <p className="px-1.5 py-1 text-label text-muted-foreground">No other projects</p>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={handleDuplicateTask}>Duplicate task</DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyId}>Copy ID</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActivityOpen(true)}>View activity…</DropdownMenuItem>
            <DropdownMenuItem onClick={handleAIBreakdown}>Break down with AI</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleDeleteTask}>
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status + Title — status icon matches the row size (StatusDropdown's
          default `sm`, same as TaskItem) and is vertically centered against
          the title's line via items-center, not a manual mt- nudge. */}
      <div className="flex items-center gap-2">
        <StatusDropdown taskId={task.id} status={task.status ?? 'todo'} onComplete={handleTaskCompleted} />
        <div className="flex-1 min-w-0">
          <InlineTitle
            value={task.content}
            completed={task.completed}
            onSave={handleSaveTitle}
            className="text-display pl-4"
          />
        </div>
      </div>

      {/* Metadata chips */}
      <MetadataChips
        values={chipValues}
        onChange={handleChipChange}
        context="details"
        projects={projects}
        sections={sections}
        labels={labels}
      />

      {/* Description + Subtasks — 48px gap between the two blocks (frame 79:2009) */}
      <div className="flex flex-col gap-12">
        {/* Description — rich text with @mentions. Markdown-canonical
            (descFormat === 'markdown'): display is a read-only rendered
            markdown view; clicking anywhere swaps to a raw auto-grown
            Textarea seeded with task.description, blur/⌘Enter saves the
            RAW STRING verbatim, Esc reverts. Legacy-HTML tasks keep the
            original always-editable Tiptap surface untouched. */}
        {descFormat === 'markdown' ? (
          descEditing ? (
            <Textarea
              ref={descTextareaRef}
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={saveDescriptionDraft}
              onKeyDown={handleDescKeyDown}
              placeholder="Description"
              rows={1}
              className={cn(
                'min-h-0 resize-none border-none bg-transparent py-0 shadow-none outline-none',
                // -mx-1 px-1 nets to the same visual left edge as the display
                // state's px-0 (net offset 0), but gives the caret/first
                // glyph interior room so it isn't clipped by the page's
                // overflow-x-hidden scroll container (Dashboard.tsx).
                '-mx-1 px-1',
                'text-body placeholder:text-foreground/25',
                'focus-visible:ring-0 focus-visible:border-none',
              )}
            />
          ) : task.description ? (
            // TiptapEditor's shared editorProps force a 200px min-height
            // (sized for the docs editor) — override it for this compact,
            // read-only display so the 48px description→subtask gap below
            // is real space, not swallowed by dead min-height.
            <div onClick={startEditingDescription} className="cursor-text [&_.tiptap-editor]:min-h-0">
              <TiptapEditor key={task.id} content={task.description} format="markdown" />
            </div>
          ) : (
            <p onClick={startEditingDescription} className="text-body text-foreground/25 cursor-text">
              Description
            </p>
          )
        ) : (
          <TiptapEditor
            key={task.id}
            content={task.description ?? ''}
            onChange={handleSaveDescription}
            placeholder="Add a description..."
            format="html"
          />
        )}

        {/* Subtasks */}
        <div className="flex flex-col">
          <p className="text-body-strong pb-1">Subtask</p>

          {subtaskItems.length > 0 && (
            <div className="space-y-0.5">
              {subtaskItems.map((item) => (
                <TaskItem
                  key={item.id}
                  task={item}
                  onOpen={() => drillDown({ type: 'task', id: item.id })}
                  showGrip={false}
                  selectable={false}
                />
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
                <span className="text-meta text-muted-foreground">Breaking down with AI...</span>
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-7 w-full rounded-md" />
                <Skeleton className="h-7 w-5/6 rounded-md" />
                <Skeleton className="h-7 w-4/6 rounded-md" />
                <Skeleton className="h-7 w-5/6 rounded-md" />
              </div>
            </div>
          )}

          {!breakingDown && (
            <div className="pt-1">
              {/* Opens the shared QuickCreateDialog modal, seeded with this
                  task as parent, instead of swapping in an inline composer
                  (Marco QA round 3, item 3). */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    useQuickCreateStore
                      .getState()
                      .openCreate({ projectId: task.project_id, parentId: task.id })
                  }
                  className="flex items-center gap-2 text-left text-meta text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="size-3 shrink-0" />
                  Add subtask
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Activity log — moved off the page body into the gear menu's "View
          activity…" item (Marco QA item 1); reuses the same TaskActivityLog
          component inside a scrollable modal. */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <TaskActivityLog taskId={task.id} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
