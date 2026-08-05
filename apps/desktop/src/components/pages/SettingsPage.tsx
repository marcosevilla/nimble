import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useDataProvider } from '@/services/provider-context'
import type { UpdateStatus, CalendarFeed, CaptureRoute, Document, SyncStatus } from '@daily-triage/types'
import { useAppStore } from '@/stores/appStore'
import { useTheme } from '@/hooks/useTheme'
import type { AccentTheme } from '@/hooks/useTheme'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FONT_OPTIONS } from '@/lib/fonts'
import type { ProductFont } from '@/lib/fonts'
import { IconButton } from '@/components/shared/IconButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { Label as SectionLabel, Meta, SectionTitle } from '@/components/shared/typography'
import { TodoistSyncSection } from '@/components/settings/TodoistSyncSection'
import { TodoistMigrationSection } from '@/components/settings/TodoistMigrationSection'
import { DocsMigrationSection } from '@/components/settings/DocsMigrationSection'
import { Lightbulb, Quote, CheckSquare, FileText, Pencil, Trash2, ChevronDown } from 'lucide-react'

// ── Types ──

interface SettingField {
  key: string
  label: string
  placeholder: string
  help: string
  type: 'text' | 'password'
}

interface FieldState {
  value: string
  saving: boolean
  saved: boolean
  error: string | null
}

// ── Field definitions by section ──

const INTEGRATIONS_FIELDS: SettingField[] = [
  {
    key: 'todoist_api_token',
    label: 'Todoist API Token',
    placeholder: 'Paste your token here',
    help: 'Settings \u2192 Integrations \u2192 Developer \u2192 API token',
    type: 'password',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic API Key',
    placeholder: 'sk-ant-...',
    help: 'console.anthropic.com \u2192 API Keys',
    type: 'password',
  },
]

const OBSIDIAN_FIELDS: SettingField[] = [
  {
    key: 'obsidian_vault_path',
    label: 'Vault Path',
    placeholder: '~/Obsidian/marcowits',
    help: 'Absolute path to your Obsidian vault folder',
    type: 'text',
  },
]

const FOCUS_FIELDS: SettingField[] = [
  {
    key: 'focus_break_minutes',
    label: 'Break Duration (minutes)',
    placeholder: '5',
    help: 'Default break length between Pomodoro rounds (e.g., 5, 10, 15)',
    type: 'text',
  },
  {
    key: 'focus_abandon_status',
    label: 'Status on Abandon',
    placeholder: 'todo',
    help: 'What status a task gets when you stop a focus session (todo or in_progress)',
    type: 'text',
  },
]

const ALL_FIELDS = [...INTEGRATIONS_FIELDS, ...OBSIDIAN_FIELDS, ...FOCUS_FIELDS]

// ── Components ──

function SettingFieldRow({
  field,
  state,
  onChange,
  onSave,
}: {
  field: SettingField
  state: FieldState
  onChange: (value: string) => void
  onSave: () => void
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = field.type === 'password'

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.key} className="text-body-strong">
        {field.label}
      </Label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id={field.key}
            type={isPassword && !visible ? 'password' : 'text'}
            placeholder={field.placeholder}
            value={state.value}
            onChange={(e) => onChange(e.target.value)}
            className="pr-10"
          />
          {isPassword && state.value && (
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-meta text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {visible ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={state.saving}
        >
          {state.saving ? 'Saving...' : state.saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <Meta as="p">{field.help}</Meta>
      {state.error && (
        <p className="text-meta text-destructive">{state.error}</p>
      )}
    </div>
  )
}

function SectionHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="space-y-1">
      <SectionTitle as="h2">{title}</SectionTitle>
      {description && (
        <p className="text-body text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

// ── Accent theme definitions ──

const ACCENT_THEMES: { value: AccentTheme; label: string; swatch: string }[] = [
  { value: 'warm', label: 'Warm', swatch: 'oklch(0.65 0.15 75)' },
  { value: 'ocean', label: 'Ocean', swatch: 'oklch(0.55 0.18 230)' },
  { value: 'rose', label: 'Rose', swatch: 'oklch(0.58 0.18 350)' },
  { value: 'mono', label: 'Mono', swatch: 'oklch(0.45 0 0)' },
  { value: 'forest', label: 'Forest', swatch: 'oklch(0.50 0.15 155)' },
  { value: 'runner', label: 'Runner', swatch: 'oklch(0.60 0.13 50)' },
]

// ── Color presets for calendar feeds ──

const FEED_COLORS = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#22c55e', // green
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#f43f5e', // rose
]

// ── Calendar Feeds Section ──

function CalendarsSection() {
  const dp = useDataProvider()
  const [feeds, setFeeds] = useState<CalendarFeed[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newColor, setNewColor] = useState(FEED_COLORS[0])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await dp.calendar.getFeeds()
        setFeeds(data)
      } catch {
        // Table might not exist yet on first run
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dp])

  const handleAdd = async () => {
    if (!newLabel.trim() || !newUrl.trim()) {
      setError('Label and URL are required')
      return
    }
    setAdding(true)
    setError(null)
    try {
      const feed = await dp.calendar.addFeed(newLabel.trim(), newUrl.trim(), newColor)
      setFeeds((prev) => [...prev, feed])
      setNewLabel('')
      setNewUrl('')
      setNewColor(FEED_COLORS[0])
      setShowForm(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (feedId: string) => {
    try {
      await dp.calendar.removeFeed(feedId)
      setFeeds((prev) => prev.filter((f) => f.id !== feedId))
    } catch (e) {
      setError(String(e))
    }
  }

  if (loading) {
    return (
      <section id="calendars" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Calendars"
          description="Add iCal feeds from Google Calendar, Outlook, etc."
        />
        <Skeleton className="h-8" />
      </section>
    )
  }

  return (
    <section id="calendars" className="space-y-4 scroll-mt-6">
      <SectionHeader
        title="Calendars"
        description="Add iCal feeds from Google Calendar, Outlook, etc."
      />

      {/* Feed list */}
      <div className="space-y-2">
        {feeds.map((feed) => (
          <div
            key={feed.id}
            className="flex items-center gap-3 rounded-md border px-3 py-2"
          >
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: feed.color }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-body-strong">{feed.label}</p>
              <p className="text-meta text-muted-foreground truncate">
                {feed.url}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-meta text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove "{feed.label}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the feed and all its cached events. You'll need to re-add the iCal URL to restore it. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleRemove(feed.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove feed
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
        {feeds.length === 0 && (
          <p className="text-body text-muted-foreground">
            No calendars configured yet.
          </p>
        )}
      </div>

      {/* Add form */}
      {showForm ? (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label className="text-body-strong">Label</Label>
            <Input
              placeholder="Work Calendar"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-body-strong">iCal URL</Label>
            <Input
              placeholder="https://calendar.google.com/calendar/ical/..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
            />
            <p className="text-meta text-muted-foreground">
              Google Calendar: Settings &rarr; Calendar &rarr; "Secret address in iCal format"
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-body-strong">Color</Label>
            <div className="flex items-center gap-2">
              {FEED_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`h-6 w-6 rounded-full border-2 transition-all ${
                    newColor === color
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:border-muted-foreground/50'
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewColor(color)}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-meta text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={adding}>
              {adding ? 'Adding...' : 'Add Calendar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          + Add Calendar
        </Button>
      )}
    </section>
  )
}

// ── Demo Mode Section ──

function DemoModeSection() {
  const dp = useDataProvider()
  const [active, setActive] = useState(false)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    dp.system.getDemoStatus().then(setActive).catch(() => {})
  }, [dp])

  const handleToggle = async (on: boolean) => {
    setSwitching(true)
    try {
      await dp.system.toggleDemoMode(on)
      setActive(on)
      toast.message(on ? 'Entering demo mode...' : 'Leaving demo mode...', {
        description: 'Restarting Daily Triage.',
      })
    } catch (e) {
      toast.error(`Failed to toggle demo mode: ${e}`)
      setSwitching(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div className="space-y-1">
        <SectionLabel as="div">{active ? 'Demo mode is on' : 'Demo mode'}</SectionLabel>
        <Meta as="p">
          {active
            ? 'Showing a blank throwaway workspace. Toggle off to restart with your real data — everything created during the demo is discarded.'
            : 'Restarts into a blank throwaway workspace — no tasks, captures, docs, goals, calendar, or integrations. Your real data stays untouched and comes back when you toggle off.'}
        </Meta>
      </div>
      <Switch
        checked={active}
        onCheckedChange={handleToggle}
        disabled={switching}
        aria-label="Toggle demo mode"
      />
    </div>
  )
}

// ── Status Colors Section ──

const COLOR_OPTIONS = [
  { label: 'Gray', value: 'text-muted-foreground/50', preview: 'bg-gray-400' },
  { label: 'Blue', value: 'text-blue-500', preview: 'bg-blue-500' },
  { label: 'Amber', value: 'text-amber-500', preview: 'bg-amber-500' },
  { label: 'Red', value: 'text-red-500', preview: 'bg-red-500' },
  { label: 'Green', value: 'text-green-500', preview: 'bg-green-500' },
  { label: 'Purple', value: 'text-purple-500', preview: 'bg-purple-500' },
  { label: 'Cyan', value: 'text-cyan-500', preview: 'bg-cyan-500' },
  { label: 'Pink', value: 'text-pink-500', preview: 'bg-pink-500' },
  { label: 'Orange', value: 'text-orange-500', preview: 'bg-orange-500' },
]

const STATUS_DEFAULTS: Record<string, { label: string; defaultColor: string }> = {
  backlog: { label: 'Backlog', defaultColor: 'Gray' },
  todo: { label: 'Todo', defaultColor: 'Blue' },
  in_progress: { label: 'In Progress', defaultColor: 'Amber' },
  blocked: { label: 'Blocked', defaultColor: 'Red' },
  complete: { label: 'Complete', defaultColor: 'Green' },
}

function StatusColorsSection() {
  return (
    <section id="status-colors" className="space-y-4 scroll-mt-6">
      <SectionHeader
        title="Status Colors"
        description="Current color assignments for task statuses."
      />
      <div className="space-y-2">
        {Object.entries(STATUS_DEFAULTS).map(([status, config]) => (
          <div key={status} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <span className={cn('size-3 rounded-full', COLOR_OPTIONS.find((c) => c.label === config.defaultColor)?.preview)} />
              <span className="text-body">{config.label}</span>
            </div>
            <span className="text-meta text-muted-foreground">{config.defaultColor}</span>
          </div>
        ))}
      </div>
      <p className="text-label text-muted-foreground">
        Color customization coming soon. These are the current defaults.
      </p>
    </section>
  )
}

// ── Route icon map for settings ──

const ROUTE_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Lightbulb,
  Quote,
  CheckSquare,
  FileText,
}

const ROUTE_ICON_OPTIONS = ['FileText', 'Lightbulb', 'Quote', 'CheckSquare']

const ROUTE_COLORS = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#22c55e', // green
  '#ec4899', // pink
  '#6366f1', // indigo
  '#ef4444', // red
  '#06b6d4', // cyan
]

// ── Capture Routes Section ──

function CaptureRoutesSection() {
  const dp = useDataProvider()
  const [routes, setRoutes] = useState<CaptureRoute[]>([])
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [formPrefix, setFormPrefix] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formTargetType, setFormTargetType] = useState<'doc' | 'task'>('doc')
  const [formColor, setFormColor] = useState(ROUTE_COLORS[0])
  const [formIcon, setFormIcon] = useState('FileText')
  const [formDocId, setFormDocId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      dp.captureRoutes.list(),
      dp.docs.getDocuments(),
    ]).then(([r, d]) => {
      setRoutes(r)
      setDocs(d)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [dp])

  const resetForm = () => {
    setFormPrefix('')
    setFormLabel('')
    setFormTargetType('doc')
    setFormColor(ROUTE_COLORS[0])
    setFormIcon('FileText')
    setFormDocId(null)
    setEditingId(null)
    setShowForm(false)
  }

  const startEdit = (route: CaptureRoute) => {
    setEditingId(route.id)
    setFormPrefix(route.prefix)
    setFormLabel(route.label)
    setFormTargetType(route.target_type as 'doc' | 'task')
    setFormColor(route.color)
    setFormIcon(route.icon)
    setFormDocId(route.doc_id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formPrefix.trim() || !formLabel.trim()) {
      toast.error('Prefix and label are required')
      return
    }
    if (!formPrefix.startsWith('/')) {
      toast.error('Prefix must start with /')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await dp.captureRoutes.update({
          id: editingId,
          prefix: formPrefix.trim(),
          targetType: formTargetType,
          docId: formDocId ?? '',
          label: formLabel.trim(),
          color: formColor,
          icon: formIcon,
        })
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === editingId
              ? { ...r, prefix: formPrefix.trim(), target_type: formTargetType, doc_id: formDocId, label: formLabel.trim(), color: formColor, icon: formIcon }
              : r
          )
        )
        toast.success('Route updated')
      } else {
        const route = await dp.captureRoutes.create({
          prefix: formPrefix.trim(),
          targetType: formTargetType,
          docId: formDocId ?? undefined,
          label: formLabel.trim(),
          color: formColor,
          icon: formIcon,
        })
        setRoutes((prev) => [...prev, route])
        toast.success('Route created')
      }
      resetForm()
    } catch (e) {
      toast.error(`Failed: ${e}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await dp.captureRoutes.delete(id)
      setRoutes((prev) => prev.filter((r) => r.id !== id))
      toast.success('Route deleted')
    } catch (e) {
      toast.error(`Failed: ${e}`)
    }
  }

  if (loading) {
    return (
      <section id="capture-routes" className="space-y-4 scroll-mt-6">
        <SectionHeader title="Capture Routes" description="Prefix routing for quick capture to Docs or Tasks." />
        <Skeleton className="h-8" />
      </section>
    )
  }

  return (
    <section id="capture-routes" className="space-y-4 scroll-mt-6">
      <SectionHeader
        title="Capture Routes"
        description="Type a prefix in the Inbox input to route captures to a Doc or create a Task."
      />

      {/* Route list */}
      <div className="space-y-2">
        {routes.map((route) => {
          const IconComponent = ROUTE_ICON_MAP[route.icon] ?? FileText
          const linkedDoc = docs.find((d) => d.id === route.doc_id)
          return (
            <div
              key={route.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
            >
              <span
                className="flex size-6 items-center justify-center rounded-md"
                style={{ backgroundColor: route.color + '20', color: route.color }}
              >
                <IconComponent className="size-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-body-strong">{route.label}</span>
                  <code className="rounded bg-muted px-1 py-0.5 text-label font-mono text-muted-foreground">
                    {route.prefix}
                  </code>
                  <span className="text-label text-muted-foreground">
                    {route.target_type === 'task' ? 'Creates task' : linkedDoc ? `Doc: ${linkedDoc.title}` : 'Auto-creates doc'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  onClick={() => startEdit(route)}
                  aria-label="Edit route"
                >
                  <Pencil className="size-3" />
                </IconButton>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <IconButton
                        tone="destructive"
                        aria-label="Delete route"
                      >
                        <Trash2 className="size-3" />
                      </IconButton>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete the "{route.label}" route?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Captures starting with <code className="font-mono">{route.prefix}</code> will no longer route to {route.target_type === 'task' ? 'a task' : linkedDoc ? `"${linkedDoc.title}"` : 'this doc'}. Existing captures stay where they are. This can't be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(route.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete route
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )
        })}
        {routes.length === 0 && (
          <p className="text-body text-muted-foreground">No capture routes configured yet.</p>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm ? (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-body-strong">Prefix</Label>
              <Input
                placeholder="/i"
                value={formPrefix}
                onChange={(e) => setFormPrefix(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-body-strong">Label</Label>
              <Input
                placeholder="Ideas"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-body-strong">Type</Label>
            <div className="flex items-center gap-1 rounded-lg border p-1">
              {(['doc', 'task'] as const).map((value) => (
                <Button
                  key={value}
                  variant={formTargetType === value ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 capitalize"
                  onClick={() => setFormTargetType(value)}
                >
                  {value === 'doc' ? 'Doc Note' : 'Task'}
                </Button>
              ))}
            </div>
          </div>

          {formTargetType === 'doc' && (
            <div className="space-y-1.5">
              <Label className="text-body-strong">Linked Doc</Label>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-body hover:bg-accent/10 transition-colors">
                  <span className={cn(formDocId ? 'text-foreground' : 'text-muted-foreground')}>
                    {formDocId ? docs.find((d) => d.id === formDocId)?.title ?? 'Unknown' : 'Auto-create on first use'}
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuItem onClick={() => setFormDocId(null)}>
                    <span className="text-muted-foreground">Auto-create on first use</span>
                  </DropdownMenuItem>
                  {docs.map((doc) => (
                    <DropdownMenuItem key={doc.id} onClick={() => setFormDocId(doc.id)}>
                      <FileText className="size-3 mr-2 text-muted-foreground" />
                      {doc.title || 'Untitled'}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-body-strong">Color</Label>
            <div className="flex items-center gap-2">
              {ROUTE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-all',
                    formColor === color ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setFormColor(color)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-body-strong">Icon</Label>
            <div className="flex items-center gap-2">
              {ROUTE_ICON_OPTIONS.map((iconName) => {
                const Icon = ROUTE_ICON_MAP[iconName] ?? FileText
                return (
                  <button
                    key={iconName}
                    type="button"
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md border transition-all',
                      formIcon === iconName ? 'border-foreground bg-accent' : 'border-border/30 hover:border-muted-foreground/50',
                    )}
                    onClick={() => setFormIcon(iconName)}
                  >
                    <Icon className="size-4" />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update Route' : 'Add Route'}
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          + Add Route
        </Button>
      )}
    </section>
  )
}

// ── Sync Section ──

function SyncSection() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [tursoUrl, setTursoUrl] = useState('')
  const [tursoToken, setTursoToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const refreshStatus = async () => {
    try {
      const newStatus = await dp.sync.getStatus()
      setStatus(newStatus)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const [url, token, syncStatus] = await Promise.all([
          dp.settings.get('turso_url'),
          dp.settings.get('turso_token'),
          dp.sync.getStatus(),
        ])
        if (url) setTursoUrl(url)
        if (token) setTursoToken(token)
        setStatus(syncStatus)
      } catch {
        // Sync table might not exist on first run before migration
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dp])

  // Auto-refresh pending changes every 30s
  useEffect(() => {
    const interval = setInterval(refreshStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleSaveConfig = async () => {
    if (!tursoUrl.trim() || !tursoToken.trim()) {
      setError('Both URL and token are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await dp.sync.configure(tursoUrl.trim(), tursoToken.trim())
      setSaved(true)
      await refreshStatus()
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    setError(null)
    setSyncResult(null)
    try {
      const pushed = await dp.sync.push()
      const pulled = await dp.sync.pull()
      await refreshStatus()
      const msg = `Pushed ${pushed}, pulled ${pulled}`
      setSyncResult(msg)
      toast.success(`Synced: ${msg}`)
      setTimeout(() => setSyncResult(null), 5000)
    } catch (e) {
      setError(String(e))
      toast.error(`Sync failed: ${e}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleTestConnection = async () => {
    if (!tursoUrl.trim() || !tursoToken.trim()) {
      setError('Save Turso URL and token first')
      return
    }
    setTesting(true)
    setError(null)
    try {
      await dp.sync.testConnection(tursoUrl.trim(), tursoToken.trim())
      toast.success('Connection successful')
    } catch (e) {
      setError(`Connection failed: ${e}`)
      toast.error(`Connection failed: ${e}`)
    } finally {
      setTesting(false)
    }
  }

  const handleInitializeRemote = async () => {
    setInitializing(true)
    setError(null)
    try {
      await dp.sync.initializeRemote()
      await refreshStatus()
      toast.success('Remote database initialized')
    } catch (e) {
      setError(`Initialization failed: ${e}`)
      toast.error(`Initialization failed: ${e}`)
    } finally {
      setInitializing(false)
    }
  }

  if (loading) {
    return (
      <section id="sync" className="space-y-4 scroll-mt-6">
        <SectionHeader title="Sync" description="Multi-device sync via Turso." />
        <Skeleton className="h-8" />
      </section>
    )
  }

  const isConfigured = status?.turso_configured ?? false
  const isInitialized = status?.remote_initialized ?? false

  return (
    <section id="sync" className="space-y-4 scroll-mt-6">
      <SectionHeader
        title="Sync"
        description="Sync data across devices using Turso (hosted SQLite). Single-user, last-write-wins."
      />

      {/* Connection status badge */}
      <div className="flex items-center gap-2">
        <span className={cn(
          'size-2 rounded-full',
          isConfigured && isInitialized ? 'bg-green-500' : isConfigured ? 'bg-amber-500' : 'bg-muted-foreground/30',
        )} />
        <span className="text-body text-muted-foreground">
          {isConfigured && isInitialized ? 'Connected' : isConfigured ? 'Configured — needs initialization' : 'Not configured'}
        </span>
      </div>

      {/* Device ID + stats */}
      {status && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-body text-muted-foreground">Device ID</span>
            <code className="rounded bg-muted px-2 py-0.5 text-meta font-mono text-muted-foreground">
              {status.device_id.slice(0, 8)}...
            </code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body text-muted-foreground">Pending changes</span>
            <span className={cn('text-body font-mono', status.pending_changes > 0 && 'text-amber-500')}>
              {status.pending_changes}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body text-muted-foreground">Last synced</span>
            <span className="text-body font-mono">
              {status.last_sync ?? 'Never'}
            </span>
          </div>
        </div>
      )}

      {/* Turso config */}
      <div className="space-y-3 rounded-md border p-3">
        <div className="space-y-1.5">
          <Label className="text-body-strong">Turso URL</Label>
          <Input
            placeholder="libsql://your-db-name.turso.io"
            value={tursoUrl}
            onChange={(e) => { setTursoUrl(e.target.value); setSaved(false) }}
          />
          <p className="text-meta text-muted-foreground">
            Your Turso database HTTP URL (starts with libsql:// or https://)
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-body-strong">Auth Token</Label>
          <Input
            type="password"
            placeholder="eyJ..."
            value={tursoToken}
            onChange={(e) => { setTursoToken(e.target.value); setSaved(false) }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveConfig}
            disabled={saving}
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={testing || !tursoUrl.trim() || !tursoToken.trim()}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>
        </div>
      </div>

      {/* Initialize Remote Database — only shown when configured but not initialized */}
      {isConfigured && !isInitialized && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <p className="text-body text-muted-foreground">
            Remote database needs to be initialized with the app schema before syncing.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleInitializeRemote}
            disabled={initializing}
          >
            {initializing ? 'Initializing...' : 'Initialize Remote Database'}
          </Button>
        </div>
      )}

      {/* Sync actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={handleSyncNow}
          disabled={syncing || !isConfigured || !isInitialized}
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              setError(null)
              const count = await dp.sync.seedExisting()
              setSyncResult(`Seeded ${count} existing records to sync log`)
              await refreshStatus()
              setTimeout(() => setSyncResult(null), 5000)
            } catch (e) {
              setError(`Seed failed: ${e}`)
            }
          }}
          disabled={syncing || !isConfigured}
        >
          Seed Existing Data
        </Button>
        {syncResult && (
          <span className="text-meta text-muted-foreground">{syncResult}</span>
        )}
      </div>

      {error && <p className="text-meta text-destructive">{error}</p>}
    </section>
  )
}

// ── Main Page ──

export function SettingsPage() {
  const dp = useDataProvider()
  const { theme, setTheme, accent, setAccent, headingFont, setHeadingFont, bodyFont, setBodyFont } = useTheme()
  const setSetupComplete = useAppStore((s) => s.setSetupComplete)
  const [fields, setFields] = useState<Record<string, FieldState>>(() => {
    const initial: Record<string, FieldState> = {}
    for (const f of ALL_FIELDS) {
      initial[f.key] = { value: '', saving: false, saved: false, error: null }
    }
    return initial
  })
  const [resetting, setResetting] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)

  // Load current values on mount
  useEffect(() => {
    async function load() {
      for (const field of ALL_FIELDS) {
        try {
          const val = await dp.settings.get(field.key)
          if (val !== null) {
            setFields((prev) => ({
              ...prev,
              [field.key]: { ...prev[field.key], value: val },
            }))
          }
        } catch {
          // Setting not found — leave empty
        }
      }
    }
    load()
  }, [dp])

  const updateFieldValue = useCallback((key: string, value: string) => {
    setFields((prev) => ({
      ...prev,
      [key]: { ...prev[key], value, saved: false, error: null },
    }))
  }, [])

  const saveField = useCallback(async (key: string) => {
    setFields((prev) => ({
      ...prev,
      [key]: { ...prev[key], saving: true, error: null },
    }))

    try {
      const value = fields[key]?.value?.trim()
      if (!value) {
        setFields((prev) => ({
          ...prev,
          [key]: { ...prev[key], saving: false, error: 'Value cannot be empty' },
        }))
        return
      }
      await dp.settings.set(key, value)
      setFields((prev) => ({
        ...prev,
        [key]: { ...prev[key], saving: false, saved: true },
      }))
      // Clear the "Saved" after 2 seconds
      setTimeout(() => {
        setFields((prev) => ({
          ...prev,
          [key]: { ...prev[key], saved: false },
        }))
      }, 2000)
    } catch (e) {
      setFields((prev) => ({
        ...prev,
        [key]: { ...prev[key], saving: false, error: String(e) },
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields])

  const handleReset = useCallback(async () => {
    setResetting(true)
    try {
      await dp.settings.clearAll()
      setSetupComplete(false)
    } catch (e) {
      console.error('Failed to reset settings:', e)
    } finally {
      setResetting(false)
    }
  }, [setSetupComplete, dp])

  const handleCheckForUpdates = useCallback(async () => {
    setChecking(true)
    setUpdateStatus(null)
    try {
      const status = await dp.system.checkForUpdates()
      setUpdateStatus(status)
    } catch (e) {
      setUpdateStatus({
        current_version: '0.1.0',
        latest_version: null,
        update_available: false,
        release_url: null,
        error: String(e),
      })
    } finally {
      setChecking(false)
    }
  }, [dp])

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto flex max-w-3xl gap-8 p-6 w-full">
      {/* Left rail — section navigation */}
      <nav className="sticky top-16 hidden w-40 shrink-0 self-start md:block">
        <ul className="space-y-0.5 text-body">
          <li>
            <a href="#appearance" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Appearance
            </a>
          </li>
          <li>
            <a href="#integrations" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Integrations
            </a>
          </li>
          <li>
            <a href="#todoist-sync" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Todoist sync
            </a>
          </li>
          <li>
            <a href="#import-todoist" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Import from Todoist
            </a>
          </li>
          <li>
            <a href="#docs-format" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Docs storage format
            </a>
          </li>
          <li>
            <a href="#focus" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Focus Mode
            </a>
          </li>
          <li>
            <a href="#obsidian" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Obsidian
            </a>
          </li>
          <li>
            <a href="#calendars" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Calendars
            </a>
          </li>
          <li>
            <a href="#status-colors" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Status Colors
            </a>
          </li>
          <li>
            <a href="#capture-routes" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Capture Routes
            </a>
          </li>
          <li>
            <a href="#sync" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Sync
            </a>
          </li>
          <li>
            <a href="#demo" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Demo Mode
            </a>
          </li>
          <li>
            <a href="#about" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              About
            </a>
          </li>
        </ul>
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-8">
      {/* Appearance */}
      <section id="appearance" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Appearance"
          description="Choose how Daily Triage looks on your machine."
        />

        {/* Mode selector */}
        <div className="space-y-1.5">
          <SectionLabel as="div">Mode</SectionLabel>
          <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
            {(['light', 'dark', 'system'] as const).map((value) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className={cn(
                  'flex-1 capitalize',
                  theme === value
                    ? 'bg-card text-foreground shadow-xs hover:bg-card'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setTheme(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>

        {/* Accent theme selector */}
        <div className="space-y-1.5">
          <SectionLabel as="div">Accent</SectionLabel>
          <div className="flex items-center gap-2">
            {ACCENT_THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={cn(
                  'group relative flex size-8 items-center justify-center rounded-full border-2 transition-all',
                  accent === t.value
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:border-muted-foreground/50',
                )}
                style={{ backgroundColor: t.swatch }}
                onClick={() => setAccent(t.value)}
                title={t.label}
              >
                {accent === t.value && (
                  <svg className="size-3.5 text-white drop-shadow-sm" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          <p className="text-label text-muted-foreground">
            {ACCENT_THEMES.find((t) => t.value === accent)?.label ?? 'Warm'} theme
          </p>
        </div>

        {/* Typography */}
        <div className="space-y-3">
          <SectionLabel as="div">Typography</SectionLabel>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="heading-font" className="text-label text-muted-foreground">
                Heading
              </Label>
              <Select
                value={headingFont}
                onValueChange={(v) => setHeadingFont(v as ProductFont)}
              >
                <SelectTrigger id="heading-font" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((font) => (
                    <SelectItem
                      key={font.value}
                      value={font.value}
                      style={{ fontFamily: font.stack }}
                    >
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="body-font" className="text-label text-muted-foreground">
                Body
              </Label>
              <Select
                value={bodyFont}
                onValueChange={(v) => setBodyFont(v as ProductFont)}
              >
                <SelectTrigger id="body-font" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((font) => (
                    <SelectItem
                      key={font.value}
                      value={font.value}
                      style={{ fontFamily: font.stack }}
                    >
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preview reads the same runtime CSS vars the rest of the app uses —
              font-heading → var(--font-heading), font-sans → var(--font-sans).
              When setHeadingFont/setBodyFont updates :root, the preview follows
              automatically. One source of truth, no manual stack reconstruction. */}
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-title">The quick brown fox jumps</p>
            <p className="text-body">
              Over the lazy dog. Body text for UI labels and content.
            </p>
            <p className="font-mono text-meta text-muted-foreground">
              Geist Mono for code and numbers
            </p>
          </div>
        </div>
      </section>

      <Separator />

      {/* Integrations */}
      <section id="integrations" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Integrations"
          description="API tokens and URLs for connected services. Stored locally on your machine."
        />
        <div className="space-y-5">
          {INTEGRATIONS_FIELDS.map((field) => (
            <SettingFieldRow
              key={field.key}
              field={field}
              state={fields[field.key]}
              onChange={(v) => updateFieldValue(field.key, v)}
              onSave={() => saveField(field.key)}
            />
          ))}
        </div>
      </section>

      <Separator />

      {/* Todoist sync */}
      <section id="todoist-sync" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Todoist sync"
          description="Two-way sync between local tasks and Todoist, running automatically once turned on."
        />
        <TodoistSyncSection />
      </section>

      <Separator />

      {/* Import from Todoist */}
      <section id="import-todoist" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Import from Todoist"
          description="One-time migration of your Todoist projects and tasks into the local database. Re-runs upsert in place."
        />
        <TodoistMigrationSection />
      </section>

      <Separator />

      {/* Docs storage format */}
      <section id="docs-format" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Docs storage format"
          description="Converts all docs from HTML to markdown. A backup of the database is saved first. Run the preview to see which docs contain formatting that may simplify during conversion."
        />
        <DocsMigrationSection />
      </section>

      <Separator />

      {/* Focus Mode */}
      <section id="focus" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Focus Mode"
          description="Configure Pomodoro and focus session behavior."
        />
        <div className="space-y-5">
          {FOCUS_FIELDS.map((field) => (
            <SettingFieldRow
              key={field.key}
              field={field}
              state={fields[field.key]}
              onChange={(v) => updateFieldValue(field.key, v)}
              onSave={() => saveField(field.key)}
            />
          ))}
        </div>
      </section>

      <Separator />

      {/* Status Colors */}
      <StatusColorsSection />

      <Separator />

      {/* Capture Routes */}
      <CaptureRoutesSection />

      <Separator />

      {/* Calendars */}
      <CalendarsSection />

      <Separator />

      {/* Sync */}
      <SyncSection />

      <Separator />

      {/* Obsidian */}
      <section id="obsidian" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Obsidian"
          description="Path to your Obsidian vault for Today.md and session logs."
        />
        <div className="space-y-5">
          {OBSIDIAN_FIELDS.map((field) => (
            <SettingFieldRow
              key={field.key}
              field={field}
              state={fields[field.key]}
              onChange={(v) => updateFieldValue(field.key, v)}
              onSave={() => saveField(field.key)}
            />
          ))}
        </div>
      </section>

      <Separator />

      {/* Demo Mode */}
      <section id="demo" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Demo Mode"
          description="A clean-slate workspace for demos and screen shares. Toggling restarts the app."
        />
        <DemoModeSection />
      </section>

      <Separator />

      {/* About */}
      <section id="about" className="space-y-4 scroll-mt-6">
        <SectionHeader title="About" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-body text-muted-foreground">Version</span>
            <span className="text-body font-mono">
              {updateStatus?.current_version ?? '0.1.0'}
            </span>
          </div>

          {/* Update check */}
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckForUpdates}
              disabled={checking}
            >
              {checking ? 'Checking...' : 'Check for Updates'}
            </Button>
            {updateStatus && !updateStatus.error && !updateStatus.update_available && (
              <p className="text-meta text-muted-foreground">
                You're up to date (v{updateStatus.current_version})
              </p>
            )}
            {updateStatus?.update_available && (
              <p className="text-meta text-foreground">
                Update available: v{updateStatus.latest_version}
                {updateStatus.release_url && (
                  <>
                    {' — '}
                    <button
                      type="button"
                      className="underline text-primary hover:text-primary/80 transition-colors"
                      onClick={() => dp.system.openUrl(updateStatus.release_url!)}
                    >
                      Download
                    </button>
                  </>
                )}
              </p>
            )}
            {updateStatus?.error && (
              <p className="text-meta text-destructive">{updateStatus.error}</p>
            )}
          </div>

          <Separator />
          <div className="space-y-2">
            <p className="text-body text-muted-foreground">
              Clear all saved settings and return to the setup screen.
            </p>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive" disabled={resetting}>
                    {resetting ? 'Resetting...' : 'Reset all settings'}
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears every saved setting — API keys (Todoist, Anthropic), calendar feeds, Obsidian vault path, focus preferences, and appearance — and sends you back to the setup screen. Your tasks, captures, and docs stay. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleReset}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Reset everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </section>
      </div>
      </div>
    </>
  )
}
