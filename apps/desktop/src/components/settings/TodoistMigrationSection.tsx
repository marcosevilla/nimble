import { useCallback, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type {
  TodoistMigrationOptions,
  TodoistMigrationPreview,
  TodoistMigrationResult,
} from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Label, Meta } from '@/components/shared/typography'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { Download } from 'lucide-react'

const DEFAULT_OPTIONS: TodoistMigrationOptions = {
  flatten_nested_projects: true,
  create_section_projects: true,
  preserve_labels: true,
  preserve_recurring: true,
}

export function TodoistMigrationSection() {
  const dp = useDataProvider()
  const [options, setOptions] = useState<TodoistMigrationOptions>(DEFAULT_OPTIONS)
  const [preview, setPreview] = useState<TodoistMigrationPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [result, setResult] = useState<TodoistMigrationResult | null>(null)

  const handlePreview = useCallback(async () => {
    setPreviewing(true)
    setPreviewError(null)
    try {
      const p = await dp.todoist.previewMigration()
      setPreview(p)
    } catch (e) {
      setPreviewError(String(e))
      setPreview(null)
    } finally {
      setPreviewing(false)
    }
  }, [dp])

  const handleMigrate = useCallback(async () => {
    setMigrating(true)
    try {
      const r = await dp.todoist.migrate(options)
      setResult(r)
      emitTasksChanged()
      const totalCreated = r.projects_created + r.tasks_created
      const totalUpdated = r.projects_updated + r.tasks_updated
      if (totalCreated > 0) {
        toast.success(
          `Imported ${r.tasks_created} task${r.tasks_created !== 1 ? 's' : ''} from Todoist`,
        )
      } else if (totalUpdated > 0) {
        toast.success(`Updated ${totalUpdated} previously-imported items`)
      } else {
        toast.success('Everything already up to date')
      }
      // Refresh the preview numbers
      handlePreview().catch(() => {})
    } catch (e) {
      toast.error(`Migration failed: ${e}`)
    } finally {
      setMigrating(false)
    }
  }, [dp, options, handlePreview])

  const setOption = (key: keyof TodoistMigrationOptions, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-5">
      {/* Preview */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewing}>
            {previewing ? 'Checking…' : preview ? 'Refresh preview' : 'Preview import'}
          </Button>
          {preview && <Meta>Read-only — nothing is imported yet.</Meta>}
        </div>

        {previewError && (
          <p className="text-meta text-destructive">{previewError}</p>
        )}

        {previewing && !preview && (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-56" />
          </div>
        )}

        {preview && (
          <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
            <PreviewRow
              label="Projects"
              created={preview.projects_to_create}
              already={preview.projects_already_migrated}
            />
            <PreviewRow
              label="Tasks"
              created={preview.tasks_to_create}
              already={preview.tasks_already_migrated}
            />
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-label text-muted-foreground pt-1 border-t border-border/20">
              <span>{preview.sections_count} section{preview.sections_count !== 1 ? 's' : ''}</span>
              <span>{preview.tasks_with_labels} with labels</span>
              <span>{preview.tasks_recurring} recurring</span>
              <span>{preview.tasks_with_subtasks} parents with subtasks</span>
            </div>
            {preview.project_names_preview.length > 0 && (
              <details className="pt-1">
                <summary className="text-label text-muted-foreground cursor-pointer hover:text-muted-foreground">
                  Preview project names ({preview.project_names_preview.length})
                </summary>
                <ul className="mt-2 space-y-0.5 text-label text-muted-foreground max-h-40 overflow-y-auto">
                  {preview.project_names_preview.map((name) => (
                    <li key={name} className="truncate">{name}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Options */}
      <div className="space-y-2">
        <Label as="div">Options</Label>
        <div className="space-y-1.5">
          <OptionToggle
            checked={options.flatten_nested_projects}
            onChange={(v) => setOption('flatten_nested_projects', v)}
            label="Flatten nested projects"
            hint='Maps Todoist’s project tree to flat names like "Parent / Child".'
          />
          <OptionToggle
            checked={options.create_section_projects}
            onChange={(v) => setOption('create_section_projects', v)}
            label="Create projects for sections"
            hint='Each Todoist section becomes a local project "Project / Section".'
          />
          <OptionToggle
            checked={options.preserve_labels}
            onChange={(v) => setOption('preserve_labels', v)}
            label="Preserve labels in descriptions"
            hint="Labels (e.g. @waiting, @deep-work) are concatenated into each task’s description as #tags."
          />
          <OptionToggle
            checked={options.preserve_recurring}
            onChange={(v) => setOption('preserve_recurring', v)}
            label="Preserve recurring rule in descriptions"
            hint='The recurrence rule (e.g. "every weekday") is noted in the description. Only the next occurrence becomes a task.'
          />
        </div>
      </div>

      {/* Run */}
      <div className="flex items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button disabled={migrating || !preview} className="gap-1.5">
                <Download className="size-3.5" />
                {migrating ? 'Importing…' : 'Import from Todoist'}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import from Todoist?</AlertDialogTitle>
              <AlertDialogDescription>
                {preview
                  ? `This will create ${preview.projects_to_create} project${preview.projects_to_create !== 1 ? 's' : ''} and ${preview.tasks_to_create} task${preview.tasks_to_create !== 1 ? 's' : ''}, and update ${preview.projects_already_migrated + preview.tasks_already_migrated} previously-imported item${preview.projects_already_migrated + preview.tasks_already_migrated !== 1 ? 's' : ''}. Safe to re-run — duplicates are prevented via external IDs.`
                  : 'Run a preview first to see what will change.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleMigrate}>
                Import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {!preview && <Meta>Run a preview first.</Meta>}
      </div>

      {/* Last result */}
      {result && (
        <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1 text-meta">
          <p className="text-body-strong text-foreground">Last import</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
            <span>Projects created: <span className="tabular-nums text-foreground">{result.projects_created}</span></span>
            <span>Tasks created: <span className="tabular-nums text-foreground">{result.tasks_created}</span></span>
            <span>Projects updated: <span className="tabular-nums text-foreground">{result.projects_updated}</span></span>
            <span>Tasks updated: <span className="tabular-nums text-foreground">{result.tasks_updated}</span></span>
            <span>Recurring preserved: <span className="tabular-nums text-foreground">{result.recurring_preserved}</span></span>
            <span>Labels preserved: <span className="tabular-nums text-foreground">{result.labels_preserved}</span></span>
          </div>
          {result.errors.length > 0 && (
            <details>
              <summary className="text-label text-destructive/80 cursor-pointer mt-2">
                {result.errors.length} warning{result.errors.length !== 1 ? 's' : ''}
              </summary>
              <ul className="mt-1 space-y-0.5 text-label text-destructive/70">
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function PreviewRow({
  label,
  created,
  already,
}: {
  label: string
  created: number
  already: number
}) {
  return (
    <div className="flex items-baseline justify-between text-body">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        <span className={cn(created > 0 ? 'text-accent-blue text-body-strong' : 'text-muted-foreground')}>
          {created} to import
        </span>
        {already > 0 && (
          <span className="text-muted-foreground ml-3">
            {already} already migrated
          </span>
        )}
      </span>
    </div>
  )
}

function OptionToggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/10 transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 cursor-pointer"
      />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-body">{label}</p>
        <p className="text-label text-muted-foreground">{hint}</p>
      </div>
    </label>
  )
}
