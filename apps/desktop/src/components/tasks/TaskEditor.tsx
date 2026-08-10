import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type { LocalTask, Project, Section } from '@nimble/types'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LabelPicker } from '@/components/tasks/LabelPicker'
import { listSections, createSection } from '@/services/tauri'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { X, Plus } from 'lucide-react'
import { PriorityBars } from '@/components/shared/PriorityBars'
import { RECURRENCE_OPTIONS, parseRecurrenceRule, formatRecurrenceBase, recurrenceRulesEqual } from '@/lib/recurrence'

const PRIORITY_OPTIONS = [
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

const DURATION_OPTIONS = [
  { value: '10', label: '10m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
  { value: '45', label: '45m' },
  { value: '60', label: '1h' },
  { value: '90', label: '1h30m' },
  { value: '120', label: '2h' },
]

const NONE = '__none__'

/** Splits a stored recurrence_rule into the canonical base string (for the
 * select), whether it carries a time suffix (for the "at time" toggle), and
 * that time itself (for seeding the due-time input — see below). Rules
 * written from this editor are always canonical; a rule that doesn't parse
 * (e.g. hand-edited or an odd import) is kept verbatim as a "custom" option
 * rather than silently discarded. */
function splitRecurrenceForEditing(rule: string | null): { base: string; atTime: boolean; time: string | null } {
  if (!rule) return { base: '', atTime: false, time: null }
  const parsed = parseRecurrenceRule(rule)
  if (parsed) return { base: formatRecurrenceBase(parsed), atTime: !!parsed.time, time: parsed.time }
  return { base: rule, atTime: false, time: null }
}

function sameLabelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

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
  // A Todoist-imported recurring task can have its time-of-day embedded only
  // in recurrence_rule (copied verbatim from the provider's due.string) with
  // due_time left null (derived independently from due.datetime) — fall
  // back to the rule's own parsed time so the "at time" toggle and the due
  // time input agree with each other from the moment the editor opens,
  // instead of showing "on" + disabled and silently dropping the time on
  // the next unrelated save.
  const initialRecurrence = useMemo(() => splitRecurrenceForEditing(task.recurrence_rule), [task.recurrence_rule])
  const [dueTime, setDueTime] = useState(task.due_time ?? initialRecurrence.time ?? '')
  const [durationMinutes, setDurationMinutes] = useState(
    task.duration_minutes != null ? String(task.duration_minutes) : '',
  )
  const [recurrenceBase, setRecurrenceBase] = useState(initialRecurrence.base)
  const [recurrenceAtTime, setRecurrenceAtTime] = useState(initialRecurrence.atTime)
  const [labelIds, setLabelIds] = useState<string[]>(task.labels)
  const [sectionId, setSectionId] = useState(task.section_id ?? '')
  const [sections, setSections] = useState<Section[]>([])
  const [addingSection, setAddingSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Sections belong to the currently-selected project, not the task's
  // original one — reload whenever the project picker changes, and drop a
  // stale section selection that no longer belongs to the new project.
  useEffect(() => {
    listSections(projectId)
      .then(setSections)
      .catch(() => setSections([]))
  }, [projectId])

  useEffect(() => {
    if (projectId !== task.project_id) setSectionId('')
  }, [projectId, task.project_id])

  // Clearing the due date also clears time/duration client-side — a time or
  // duration with no date is meaningless, and mirrors the backend's
  // clear_due_time (which nulls duration_minutes too).
  const handleDueDateChange = useCallback((value: string) => {
    setDueDate(value)
    if (!value) {
      setDueTime('')
      setDurationMinutes('')
    }
  }, [])

  const composedRecurrenceRule = useMemo(() => {
    if (!recurrenceBase) return ''
    if (recurrenceAtTime && dueTime) return `${recurrenceBase} @ ${dueTime}`
    return recurrenceBase
  }, [recurrenceBase, recurrenceAtTime, dueTime])

  const recurrenceSelectOptions = useMemo(() => {
    if (!recurrenceBase || RECURRENCE_OPTIONS.some((o) => o.value === recurrenceBase)) return RECURRENCE_OPTIONS
    return [...RECURRENCE_OPTIONS, { value: recurrenceBase, label: recurrenceBase }]
  }, [recurrenceBase])

  // Baseline dueTime is the same fallback used to seed the state above
  // (task.due_time, or the recurrence rule's own embedded time when the
  // column itself is empty) — comparing against the raw task.due_time here
  // would falsely flag "dirty" the moment a recurrence rule supplies the
  // only time-of-day this task has (see initialRecurrence's seeding above).
  const initialDueTime = task.due_time ?? initialRecurrence.time ?? ''
  const dueTimeChanged = dueTime !== initialDueTime
  // Semantic, not textual, comparison — a stored rule like the Todoist
  // import's "every day at 9am" and this editor's recomposed canonical
  // "every day @ 09:00" describe the same rule and must not be treated as
  // an edit (that's exactly what silently truncated the time before: a
  // false "dirty" from formatting alone meant ANY unrelated save rewrote
  // the rule using whatever local state happened to be sitting in dueTime).
  const recurrenceChanged = !recurrenceRulesEqual(composedRecurrenceRule, task.recurrence_rule ?? '')

  // Track changes
  useEffect(() => {
    const changed =
      content !== task.content ||
      description !== (task.description ?? '') ||
      projectId !== task.project_id ||
      priority !== task.priority ||
      dueDate !== (task.due_date ?? '') ||
      dueTimeChanged ||
      durationMinutes !== (task.duration_minutes != null ? String(task.duration_minutes) : '') ||
      recurrenceChanged ||
      sectionId !== (task.section_id ?? '') ||
      !sameLabelSet(labelIds, task.labels)
    setDirty(changed)
  }, [content, description, projectId, priority, dueDate, dueTimeChanged, durationMinutes, recurrenceChanged, sectionId, labelIds, task])

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const labelsChanged = !sameLabelSet(labelIds, task.labels)
      const updated = await dp.tasks.update({
        id: task.id,
        content: content.trim() || undefined,
        description: description.trim() || undefined,
        projectId: projectId !== task.project_id ? projectId : undefined,
        priority: priority !== task.priority ? priority : undefined,
        dueDate: dueDate || undefined,
        clearDueDate: !dueDate && !!task.due_date,
        // Gated on dueTimeChanged (against the recurrence-aware baseline
        // above), not just truthiness — otherwise a due time seeded purely
        // from an untouched recurrence rule would get written into the
        // due_time column on every unrelated save.
        dueTime: dueTimeChanged && dueTime ? dueTime : undefined,
        clearDueTime: dueTimeChanged && !dueTime && !!task.due_time,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        clearDuration: !durationMinutes && task.duration_minutes != null,
        // Gated on recurrenceChanged (semantic comparison) so an untouched
        // rule is never rewritten just because its canonical recomposition
        // differs textually from the stored (e.g. imported) string.
        recurrenceRule: recurrenceChanged && composedRecurrenceRule ? composedRecurrenceRule : undefined,
        clearRecurrence: recurrenceChanged && !composedRecurrenceRule && !!task.recurrence_rule,
        sectionId: sectionId !== (task.section_id ?? '') ? sectionId || undefined : undefined,
        clearSection: !sectionId && !!task.section_id,
        labelIds: labelsChanged ? labelIds : undefined,
      })
      onUpdated(updated)
      onClose()
    } catch (e) {
      toast.error(`Failed to update: ${e}`)
    } finally {
      setSaving(false)
    }
  }, [
    dirty, saving, task, content, description, projectId, priority, dueDate, dueTime, dueTimeChanged,
    durationMinutes, composedRecurrenceRule, recurrenceChanged, sectionId, labelIds, onUpdated, onClose, dp,
  ])

  // Guards against a double-submit if Enter and the resulting blur (input
  // unmounts once addingSection flips false) both try to fire this.
  const creatingSectionRef = useRef(false)
  const handleCreateSection = useCallback(async () => {
    if (creatingSectionRef.current) return
    const name = newSectionName.trim()
    if (!name) {
      setAddingSection(false)
      return
    }
    creatingSectionRef.current = true
    try {
      const section = await createSection(projectId, name)
      setSections((prev) => [...prev, section])
      setSectionId(section.id)
    } catch (e) {
      toast.error(`Failed to create section: ${e}`)
    } finally {
      creatingSectionRef.current = false
      setAddingSection(false)
      setNewSectionName('')
    }
  }, [newSectionName, projectId])

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

        {/* Due date + time */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Due date</label>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => handleDueDateChange(e.target.value)}
              className="h-7 text-meta w-auto"
            />
            {dueDate && (
              <Input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="h-7 text-meta w-auto"
                aria-label="Due time"
              />
            )}
            {dueDate && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleDueDateChange('')}
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

      {/* Scheduling + organization row */}
      <div className="flex flex-wrap gap-4">
        {/* Duration */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Duration</label>
          <div className="flex items-center gap-1">
            <Select
              value={durationMinutes || NONE}
              onValueChange={(v) => setDurationMinutes(!v || v === NONE ? '' : v)}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {DURATION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {durationMinutes && (
              <Button variant="ghost" size="icon-xs" onClick={() => setDurationMinutes('')}>
                <X className="size-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Recurrence */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Repeat</label>
          <div className="flex items-center gap-2">
            <Select
              value={recurrenceBase || NONE}
              onValueChange={(v) => setRecurrenceBase(!v || v === NONE ? '' : v)}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {recurrenceSelectOptions
                  .filter((opt) => opt.value)
                  .map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {recurrenceBase && (
              <label className="flex items-center gap-1.5 text-label text-muted-foreground">
                <Switch
                  size="sm"
                  checked={recurrenceAtTime}
                  onCheckedChange={setRecurrenceAtTime}
                  disabled={!dueTime}
                />
                at time
              </label>
            )}
          </div>
        </div>

        {/* Labels */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Labels</label>
          <LabelPicker value={labelIds} onChange={setLabelIds} />
        </div>

        {/* Section */}
        <div className="space-y-1">
          <label className="text-label text-muted-foreground">Section</label>
          {addingSection ? (
            <Input
              autoFocus
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleCreateSection() }
                if (e.key === 'Escape') { e.preventDefault(); setAddingSection(false); setNewSectionName('') }
              }}
              onBlur={handleCreateSection}
              placeholder="New section name"
              className="h-7 text-meta w-auto"
            />
          ) : (
            <div className="flex items-center gap-1">
              {sections.length > 0 && (
                <Select
                  value={sectionId || NONE}
                  onValueChange={(v) => setSectionId(!v || v === NONE ? '' : v)}
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <button
                onClick={() => setAddingSection(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-label text-muted-foreground hover:border-border hover:text-foreground transition-colors"
              >
                <Plus className="size-3" />
                {sections.length === 0 ? 'New section' : ''}
              </button>
            </div>
          )}
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
