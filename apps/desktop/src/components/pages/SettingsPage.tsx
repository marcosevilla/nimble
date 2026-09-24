import { GoogleCalendarSection } from '@/components/settings/GoogleCalendarSection'
import { ReminderSection } from '@/components/settings/ReminderSection'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useDataProvider } from '@/services/provider-context'
import type { UpdateStatus, CalendarFeed, CaptureRoute, Document, SyncStatus } from '@nimble/types'
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
import { PageFrame } from '@/components/shared/PageFrame'
import { Label as SectionLabel, Meta, SectionTitle } from '@/components/shared/typography'
import { BackupSection } from '@/components/settings/BackupSection'
import { TodoistSyncSection } from '@/components/settings/TodoistSyncSection'
import { TodoistMigrationSection } from '@/components/settings/TodoistMigrationSection'
import { DocsMigrationSection } from '@/components/settings/DocsMigrationSection'
import { TasksMigrationSection } from '@/components/settings/TasksMigrationSection'
import { VaultSection } from '@/components/settings/VaultSection'
import { LabelManager } from '@/components/settings/LabelManager'
import { Lightbulb, Quote, CheckSquare, FileText, Pencil, Trash2, ChevronDown } from 'lucide-react'
import {
  visibleSections,
  visiblePages,
  sectionsOnPage,
  resolveSettingsPage,
  activeSectionId,
  DEFAULT_SETTINGS_PAGE,
} from '@/lib/settingsSections'
import { useSettingsNavStore } from '@/stores/settingsNavStore'
import { settingsFailure, settingsMessage } from '@/lib/settingsMessage'
import type { SettingsFailure } from '@/lib/settingsMessage'
import { validateRoutePrefix } from '@/lib/captureRoutes'

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
  error: SettingsFailure | null
}

// ── Field definitions by section ──

const INTEGRATIONS_FIELDS: SettingField[] = [
  {
    key: 'todoist_api_token',
    label: 'Todoist API token',
    placeholder: 'Paste your token here',
    help: 'Settings \u2192 Integrations \u2192 Developer \u2192 API token',
    type: 'password',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic API key',
    placeholder: 'sk-ant-...',
    help: 'console.anthropic.com \u2192 API Keys',
    type: 'password',
  },
]

const OBSIDIAN_FIELDS: SettingField[] = [
  {
    key: 'obsidian_vault_path',
    label: 'Vault path',
    placeholder: '~/Obsidian/marcowits',
    help: 'Absolute path to your Obsidian vault folder',
    type: 'text',
  },
]

const ALL_FIELDS = [...INTEGRATIONS_FIELDS, ...OBSIDIAN_FIELDS]

// ── Components ──

/** Neutral headline + the raw error behind a disclosure (settings P2-16). */
function FailureNote({ failure }: { failure: SettingsFailure | null }) {
  if (!failure) return null
  return (
    <div className="space-y-1">
      <p className="text-meta text-destructive" role="alert">{failure.message}</p>
      {failure.detail && failure.detail !== failure.message && (
        <details>
          <summary className="cursor-pointer text-label text-muted-foreground">Details</summary>
          <code className="block whitespace-pre-wrap break-all font-mono text-label text-muted-foreground">
            {failure.detail}
          </code>
        </details>
      )}
    </div>
  )
}

function toastFailure(error: unknown) {
  const failure = settingsFailure(error)
  toast.error(failure.message, failure.detail ? { description: failure.detail } : undefined)
}

function fontLabel(value: ProductFont): string {
  return FONT_OPTIONS.find((f) => f.value === value)?.label ?? value
}

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
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 py-0.5 text-meta text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground"
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
      <FailureNote failure={state.error} />
    </div>
  )
}

function SectionHeader({
  title,
  description,
  as = 'h2',
}: {
  title: string
  description?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <div className="space-y-1">
      <SectionTitle as={as} size="lg">{title}</SectionTitle>
      {description && (
        <p className="text-body text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

// ── Accent theme definitions ──

const ACCENT_THEMES: { value: AccentTheme; label: string }[] = [
  { value: 'warm', label: 'Warm' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'rose', label: 'Rose' },
  { value: 'mono', label: 'Mono' },
  { value: 'forest', label: 'Forest' },
  { value: 'runner', label: 'Runner' },
]

interface ThemeSwatch {
  background: string
  primary: string
  border: string
}

/** Reads each theme's real `--background` / `--primary` / `--border` by
 *  parking a hidden probe under `.theme-*` (+ `.dark` when the app is dark)
 *  and asking the cascade. The picker then shows the token system instead
 *  of six hand-picked saturated dots (settings P2-7). */
function readThemeSwatches(dark: boolean): Record<AccentTheme, ThemeSwatch> {
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  document.body.appendChild(probe)
  const out = {} as Record<AccentTheme, ThemeSwatch>
  for (const t of ACCENT_THEMES) {
    probe.className = cn(`theme-${t.value}`, dark && 'dark')
    const style = getComputedStyle(probe)
    out[t.value] = {
      background: style.getPropertyValue('--background').trim(),
      primary: style.getPropertyValue('--primary').trim(),
      border: style.getPropertyValue('--border').trim(),
    }
  }
  probe.remove()
  return out
}

function useThemeSwatches(): Record<AccentTheme, ThemeSwatch> | null {
  const [swatches, setSwatches] = useState<Record<AccentTheme, ThemeSwatch> | null>(null)
  useEffect(() => {
    const read = () => setSwatches(readThemeSwatches(document.documentElement.classList.contains('dark')))
    read()
    // Mode flips (light/dark/system) and accent swaps both land on <html class>.
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return swatches
}

function AccentPicker({ accent, onChange }: { accent: AccentTheme; onChange: (next: AccentTheme) => void }) {
  const swatches = useThemeSwatches()

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const index = ACCENT_THEMES.findIndex((t) => t.value === accent)
    const next = ACCENT_THEMES[(index + delta + ACCENT_THEMES.length) % ACCENT_THEMES.length]
    onChange(next.value)
    const radios = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios[ACCENT_THEMES.indexOf(next)]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby="accent-label"
      className="flex items-center gap-2"
      onKeyDown={handleKeyDown}
    >
      {ACCENT_THEMES.map((t) => {
        const selected = accent === t.value
        const swatch = swatches?.[t.value]
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t.label}
            tabIndex={selected ? 0 : -1}
            className={cn(
              'flex size-8 items-center justify-center rounded-full border transition-[box-shadow,border-color] duration-(--transition-fast)',
              selected
                ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                : 'hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-background',
            )}
            style={swatch ? { backgroundColor: swatch.background, borderColor: swatch.border } : undefined}
            onClick={() => onChange(t.value)}
          >
            <span
              className="size-3 rounded-full"
              style={swatch ? { backgroundColor: swatch.primary } : undefined}
            />
          </button>
        )
      })}
    </div>
  )
}

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
  const [error, setError] = useState<SettingsFailure | null>(null)

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
      setError({ message: 'Label and URL are required', detail: null })
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
      setError(settingsFailure(e))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (feedId: string) => {
    try {
      await dp.calendar.removeFeed(feedId)
      setFeeds((prev) => prev.filter((f) => f.id !== feedId))
    } catch (e) {
      setError(settingsFailure(e))
    }
  }

  if (loading) {
    return (
      <section id="calendars" className={SECTION_CLASS}>
        <SectionHeader
          title="Calendars"
          description="Add iCal feeds from Google Calendar, Outlook, etc."
        />
        <Skeleton className="h-8" />
      </section>
    )
  }

  return (
    <section id="calendars" className={SECTION_CLASS}>
      <SectionHeader
        title="Calendars"
        description="Add iCal feeds from Google Calendar, Outlook, etc."
      />

      {/* Feed list */}
      <div className="space-y-2">
        {feeds.map((feed) => (
          <div
            key={feed.id}
            className="flex items-center gap-2 rounded-md border px-3 py-2"
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
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-1.5">
            <Label className="text-body-strong">Label</Label>
            <Input
              placeholder="Work calendar"
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
            <div className="flex items-center gap-2" role="radiogroup" aria-label="Calendar color">
              {FEED_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={newColor === color}
                  aria-label={`Color ${color}`}
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-[border-color,scale] duration-(--transition-fast)',
                    newColor === color ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewColor(color)}
                />
              ))}
            </div>
          </div>
          <FailureNote failure={error} />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={adding}>
              {adding ? 'Adding...' : 'Add calendar'}
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
          + Add calendar
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

  // The switch only asks; the restart happens after the AlertDialog confirms.
  const [pending, setPending] = useState<boolean | null>(null)

  const handleToggle = async (on: boolean) => {
    setSwitching(true)
    try {
      await dp.system.toggleDemoMode(on)
      setActive(on)
      toast.message(on ? 'Entering demo mode...' : 'Leaving demo mode...', {
        description: 'Restarting Nimble.',
      })
    } catch (e) {
      toastFailure(e)
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
        onCheckedChange={(on) => setPending(on)}
        disabled={switching}
        aria-label="Toggle demo mode"
      />
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending ? 'Restart into demo mode?' : 'Leave demo mode?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? 'Nimble restarts into a blank throwaway workspace. Your real data stays untouched.'
                : 'Nimble restarts with your real data. Everything created during the demo is discarded.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const on = pending === true
                setPending(null)
                void handleToggle(on)
              }}
            >
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
    const prefixError = validateRoutePrefix(formPrefix, routes, editingId)
    if (prefixError) {
      toast.error(prefixError)
      return
    }
    if (!formLabel.trim()) {
      toast.error('Label is required')
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
      toastFailure(e)
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
      toastFailure(e)
    }
  }

  if (loading) {
    return (
      <section id="capture-routes" className={SECTION_CLASS}>
        <SectionHeader title="Capture routes" description="Prefix routing for quick capture to Docs or Tasks." />
        <Skeleton className="h-8" />
      </section>
    )
  }

  return (
    <section id="capture-routes" className={SECTION_CLASS}>
      <SectionHeader
        title="Capture routes"
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
              className="flex items-center gap-2 rounded-md border px-3 py-2"
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
        <div className="space-y-4 rounded-md border p-4">
          <div className="grid grid-cols-2 gap-4">
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
                  className="flex-1"
                  onClick={() => setFormTargetType(value)}
                >
                  {value === 'doc' ? 'Doc note' : 'Task'}
                </Button>
              ))}
            </div>
          </div>

          {formTargetType === 'doc' && (
            <div className="space-y-1.5">
              <Label className="text-body-strong">Linked doc</Label>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-body hover:bg-hover transition-colors">
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
            <div className="flex items-center gap-2" role="radiogroup" aria-label="Route color">
              {ROUTE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={formColor === color}
                  aria-label={`Color ${color}`}
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-[border-color,scale] duration-(--transition-fast)',
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
            <div className="flex items-center gap-2" role="radiogroup" aria-label="Route icon">
              {ROUTE_ICON_OPTIONS.map((iconName) => {
                const Icon = ROUTE_ICON_MAP[iconName] ?? FileText
                return (
                  <button
                    key={iconName}
                    type="button"
                    role="radio"
                    aria-checked={formIcon === iconName}
                    aria-label={iconName}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md border transition-[border-color,background-color] duration-(--transition-fast)',
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
              {saving ? 'Saving...' : editingId ? 'Update route' : 'Add route'}
            </Button>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          + Add route
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
  const [tursoUrl, setTursoUrl] = useState('')
  const [tursoToken, setTursoToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<SettingsFailure | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  // True when the provider has no sync surface at all, as opposed to having one
  // that is merely unconfigured. See the catch in `load` below.
  const [unavailable, setUnavailable] = useState(false)

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
      } catch (err) {
        // Two very different failures used to land here identically.
        //
        // On the web build these methods REJECT: there is no sync surface in the
        // browser at all, because Turso credentials live in Vercel environment
        // variables server-side and the page reaches the database through
        // /api/turso. Falling through to the default state rendered "Not
        // configured", which reads as "your sync is broken" when in fact it is
        // working — that message is what the whole `unavailable` flag exists to
        // avoid.
        //
        // On desktop the same catch legitimately fires when the sync table does
        // not exist yet, on first run before migration. That case really is
        // unconfigured and should keep saying so.
        if (err instanceof Error && err.name === 'WebNotImplementedError') {
          setUnavailable(true)
        }
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
      setError({ message: 'Both URL and token are required', detail: null })
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
      setError(settingsFailure(e))
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
      setError(settingsFailure(e))
      toastFailure(e)
    } finally {
      setSyncing(false)
    }
  }

  const handleTestConnection = async () => {
    if (!tursoUrl.trim() || !tursoToken.trim()) {
      setError({ message: 'Save Turso URL and token first', detail: null })
      return
    }
    setTesting(true)
    setError(null)
    try {
      await dp.sync.testConnection(tursoUrl.trim(), tursoToken.trim())
      toast.success('Connection successful')
    } catch (e) {
      setError(settingsFailure(e))
      toastFailure(e)
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <section id="sync" className={SECTION_CLASS}>
        <SectionHeader title="Sync" description="Multi-device sync via Turso." />
        <Skeleton className="h-8" />
      </section>
    )
  }

  const isConfigured = status?.turso_configured ?? false
  const isInitialized = status?.remote_initialized ?? false

  // Nothing below this point applies in the browser: there are no credentials to
  // enter, no remote to initialize, and no manual push/pull to run. Render the
  // explanation instead of a form that cannot save and buttons that stay
  // disabled.
  if (unavailable) {
    return (
      <section id="sync" className={SECTION_CLASS}>
        <SectionHeader
          title="Sync"
          description="Sync data across devices using Turso (hosted SQLite). Single-user, last-write-wins."
        />
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-success" />
          <span className="text-body text-muted-foreground">
            Managed server-side — this page is reading and writing Turso already.
            Credentials and sync settings live on the desktop app.
          </span>
        </div>
      </section>
    )
  }

  return (
    <section id="sync" className={SECTION_CLASS}>
      <SectionHeader
        title="Sync"
        description="Sync data across devices using Turso (hosted SQLite). Single-user, last-write-wins."
      />

      {/* Connection status badge */}
      <div className="flex items-center gap-2">
        <span className={cn(
          'size-2 rounded-full',
          isConfigured && isInitialized ? 'bg-success' : isConfigured ? 'bg-warning' : 'bg-muted-foreground/30',
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
            <span className={cn('text-body font-mono', status.pending_changes > 0 && 'text-warning')}>
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
      <div className="space-y-4 rounded-md border p-4">
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
          <Label className="text-body-strong">Auth token</Label>
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
            {testing ? 'Testing...' : 'Test connection'}
          </Button>
        </div>
      </div>

      {/* Initialize Remote Database — only shown when configured but not initialized */}
      {isConfigured && !isInitialized && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-4 space-y-2">
          <p className="text-body text-muted-foreground">
            Remote database needs to be initialized with the app schema before syncing.
            {' '}
            <a href="#maintenance" className="underline underline-offset-2 hover:text-foreground">
              Initialize it under Maintenance
            </a>
            .
          </p>
        </div>
      )}

      {/* Sync actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={handleSyncNow}
          disabled={syncing || !isConfigured || !isInitialized}
        >
          {syncing ? 'Syncing...' : 'Sync now'}
        </Button>
        {syncResult && (
          <span className="text-meta text-muted-foreground">{syncResult}</span>
        )}
      </div>

      <FailureNote failure={error} />
    </section>
  )
}

// ── Sync maintenance (schema init + sync-log seeding; settings P2-1) ──

function SyncMaintenance() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState<'initialize' | 'seed' | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<SettingsFailure | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await dp.sync.getStatus())
    } catch {
      setStatus(null)
    }
  }, [dp])

  useEffect(() => { void refresh() }, [refresh])

  if (!status) {
    return <Meta as="p">Sync tools are available on the desktop app once Turso is set up under Sync.</Meta>
  }
  if (!status.turso_configured) {
    return <Meta as="p">Set up Turso under Sync first.</Meta>
  }

  const run = async (kind: 'initialize' | 'seed') => {
    setBusy(kind)
    setError(null)
    setResult(null)
    try {
      if (kind === 'initialize') {
        await dp.sync.initializeRemote()
        setResult('Remote database initialized')
      } else {
        const count = await dp.sync.seedExisting()
        setResult(`Seeded ${count} existing records to sync log`)
      }
      await refresh()
    } catch (e) {
      setError(settingsFailure(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <Meta as="p">
        {status.remote_initialized
          ? 'The remote database has the app schema. Seeding re-adds existing rows to the sync log if a device missed them.'
          : 'The remote database needs the app schema before the first sync.'}
      </Meta>
      <div className="flex flex-wrap items-center gap-2">
        {!status.remote_initialized && (
          <Button variant="outline" size="sm" onClick={() => run('initialize')} disabled={busy !== null}>
            {busy === 'initialize' ? 'Initializing…' : 'Initialize remote database'}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => run('seed')} disabled={busy !== null}>
          {busy === 'seed' ? 'Seeding…' : 'Seed existing data'}
        </Button>
        {result && <span className="text-meta text-muted-foreground" role="status">{result}</span>}
      </div>
      <FailureNote failure={error} />
    </div>
  )
}

// ── Scroll-spy (settings P2-1) ──

const SECTION_CLASS = 'space-y-4 scroll-mt-[calc(var(--page-header-h)+1.5rem)]'
const SCROLL_SPY_THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20)
const NAV_CLICK_LOCK_MS = 800

function findScroller(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return document.documentElement
}

/** Which `<section id>` sits under the active line (just below the sticky
 *  header). IntersectionObserver wakes the computation; geometry decides,
 *  so short trailing sections still resolve deterministically. A nav click
 *  pins its target for NAV_CLICK_LOCK_MS so smooth-scrolling past other
 *  sections does not flicker the highlight. */
function useSettingsScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null)
  const lockUntil = useRef(0)
  const key = ids.join(',')

  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    if (els.length === 0) return
    const scroller = findScroller(els[0])
    const headerH =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-header-h')) || 41

    const compute = () => {
      if (Date.now() < lockUntil.current) return
      const line = scroller.getBoundingClientRect().top + headerH + 48
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      setActive(activeSectionId(els.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })), line, atEnd))
    }

    const observer = new IntersectionObserver(compute, { threshold: SCROLL_SPY_THRESHOLDS })
    els.forEach((el) => observer.observe(el))
    compute()
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const select = useCallback((id: string) => {
    lockUntil.current = Date.now() + NAV_CLICK_LOCK_MS
    setActive(id)
  }, [])

  return { active, select }
}

// ── Main Page ──

// Sentence-case copy for the appearance mode toggle (no CSS capitalize).
const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'System' } as const

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
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const storedPage = useSettingsNavStore((s) => s.page)
  const showPage = useSettingsNavStore((s) => s.showPage)
  const pendingSection = useSettingsNavStore((s) => s.pendingSection)
  const clearPendingSection = useSettingsNavStore((s) => s.clearPendingSection)
  const contentRef = useRef<HTMLDivElement>(null)
  // The active deep-link scroll pin (see the pendingSection effect below).
  // Lives outside the effect so clearing pendingSection — which re-runs that
  // effect — can't tear it down early; only a later real deep link or unmount
  // does.
  const pinRef = useRef<{ dispose: () => void } | null>(null)

  const backupSupported = dp.backup.supported
  const remindersSupported = dp.reminders.supported
  const googleSupported = dp.googleCalendar.supported
  const sections = useMemo(
    () => visibleSections({ backup: backupSupported, reminders: remindersSupported, googleCalendar: googleSupported }),
    [backupSupported, remindersSupported, googleSupported],
  )

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
          [key]: { ...prev[key], saving: false, error: { message: 'Value cannot be empty', detail: null } },
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
        [key]: { ...prev[key], saving: false, error: settingsFailure(e) },
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
        error: settingsMessage(e),
      })
    } finally {
      setChecking(false)
    }
  }, [dp])

  // One body per SETTINGS_SECTIONS row. The array owns the order; this map
  // only owns the markup. A row without a body renders nothing.
  const bodies: Record<string, React.ReactNode> = {
    appearance: (
      <section id="appearance" className={SECTION_CLASS}>
        <SectionHeader
          title="Appearance"
          description="Choose how Nimble looks on your machine."
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
                  'flex-1',
                  theme === value
                    ? 'bg-card text-foreground shadow-xs hover:bg-card'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setTheme(value)}
              >
                {THEME_LABELS[value]}
              </Button>
            ))}
          </div>
        </div>

        {/* Accent theme selector */}
        <div className="space-y-1.5">
          <SectionLabel as="div" id="accent-label">Accent</SectionLabel>
          <AccentPicker accent={accent} onChange={setAccent} />
          <p className="text-label text-muted-foreground">
            {ACCENT_THEMES.find((t) => t.value === accent)?.label ?? 'Warm'} theme
          </p>
        </div>

        {/* Typography */}
        <div className="space-y-4">
          <SectionLabel as="div">Typography</SectionLabel>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="heading-font" className="text-label text-muted-foreground">
                Heading
              </Label>
              <Select
                value={headingFont}
                onValueChange={(v) => setHeadingFont(v as ProductFont)}
              >
                <SelectTrigger id="heading-font" className="w-full">
                  <SelectValue>{fontLabel(headingFont)}</SelectValue>
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
                  <SelectValue>{fontLabel(bodyFont)}</SelectValue>
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
          <div className="rounded-lg border p-4 space-y-1">
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
    ),

    integrations: (
      <section id="integrations" className={SECTION_CLASS}>
        <SectionHeader
          title="API keys"
          description="API tokens and URLs for connected services. Stored locally on your machine."
        />
        <div className="space-y-4">
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
    ),

    /* Vault path + index status are one feature (settings P2-2): the path
       field first, then the status the path produces. */
    obsidian: (
      <section id="obsidian" className={SECTION_CLASS}>
        <SectionHeader
          title="Obsidian"
          description="Your vault path. Notes are indexed so they're searchable here; files on disk stay the source of truth."
        />
        <div className="space-y-4">
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
        <VaultSection />
      </section>
    ),

    'todoist-sync': (
      <section id="todoist-sync" className={SECTION_CLASS}>
        <SectionHeader
          title="Todoist sync"
          description="Keeps your tasks mirrored in Todoist both ways."
        />
        <TodoistSyncSection />
      </section>
    ),

    'capture-routes': <CaptureRoutesSection />,

    labels: (
      <section id="labels" className={SECTION_CLASS}>
        <SectionHeader
          title="Labels"
          description="Reusable tags for tasks. Colors are for your own visual sorting."
        />
        <LabelManager />
      </section>
    ),

    calendars: <CalendarsSection />,
    sync: <SyncSection />,
    backups: <BackupSection />,
    reminders: <ReminderSection />,
    'google-calendar': <GoogleCalendarSection />,

    demo: (
      <section id="demo" className={SECTION_CLASS}>
        <SectionHeader
          title="Demo mode"
          description="A clean-slate workspace for demos and screen shares. Toggling restarts the app."
        />
        <DemoModeSection />
      </section>
    ),

    about: (
      <section id="about" className={SECTION_CLASS}>
        <SectionHeader title="About" />
        <div className="space-y-4">
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
              {checking ? 'Checking...' : 'Check for updates'}
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
    ),

    /* Lane B mounts <TodayBriefSettings /> here (one root
       <section id="today-brief">). While null, the page stays hidden. */
    'today-brief': null,

    /* One-time migrations and developer verbs, collapsed and last
       (settings P2-1). Each keeps its old id so deep links still land. */
    maintenance: (
      <section id="maintenance" className={SECTION_CLASS}>
        <SectionHeader
          title="Maintenance"
          description="One-time migrations and sync tools. Nothing here is part of a normal day."
        />
        <details
          open={maintenanceOpen}
          className="group rounded-lg border"
          onToggle={(e) => setMaintenanceOpen(e.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-4 py-2 text-body transition-colors duration-(--transition-fast) hover:bg-hover [&::-webkit-details-marker]:hidden">
            Maintenance tools
            <ChevronDown className="size-3 text-muted-foreground transition-transform duration-(--transition-fast) group-open:rotate-180" />
          </summary>
          <div className="space-y-8 border-t px-4 pb-4 pt-4">
            <div id="import-todoist" className="space-y-4">
              <SectionHeader
                as="h3"
                title="Import from Todoist"
                description="One-time migration of your Todoist projects and tasks into the local database. Re-runs upsert in place."
              />
              <TodoistMigrationSection />
            </div>

            <div id="docs-format" className="space-y-4">
              <SectionHeader
                as="h3"
                title="Docs storage format"
                description="Converts all docs from HTML to markdown. A backup of the database is saved first. Run the preview to see which docs contain formatting that may simplify during conversion."
              />
              <DocsMigrationSection />
            </div>

            <div id="tasks-format" className="space-y-4">
              <SectionHeader
                as="h3"
                title="Task descriptions storage format"
                description="Converts task descriptions from HTML to markdown. A backup of the database is saved first. Run the preview to see which descriptions contain formatting that may simplify during conversion."
              />
              <TasksMigrationSection />
            </div>

            <div id="sync-tools" className="space-y-4">
              <SectionHeader as="h3" title="Sync tools" />
              {/* Mounted per expand so it re-reads sync status each time
                  (Turso may have been set up under Sync since). */}
              {maintenanceOpen && <SyncMaintenance />}
            </div>
          </div>
        </details>
      </section>
    ),
  }

  // A section renders only when it has a body; `today-brief` stays null
  // until Lane B mounts its component, which keeps "Today & brief" out of
  // the rail until then.
  const renderable = sections.filter((s) => bodies[s.id] != null)
  const pages = visiblePages(renderable)
  const page = resolveSettingsPage(storedPage, pages) ?? DEFAULT_SETTINGS_PAGE
  const pageSections = sectionsOnPage(renderable, page)
  const { active: activeSection, select: selectSection } = useSettingsScrollSpy(pageSections.map((s) => s.id))

  // A new page starts at its top…
  useEffect(() => {
    if (contentRef.current) findScroller(contentRef.current).scrollTop = 0
  }, [page])

  // …unless a deep link names a section; this effect runs after the one
  // above, so the section wins. Clearing it re-runs only this effect.
  //
  // Async sections (Calendars feeds, Obsidian stats, reminders) can still be
  // loading when this fires, so the page is briefly shorter than its final
  // height and the scroll clamps short of the target. Pin the target back
  // into place on every content resize for a bounded window, or until the
  // user scrolls on their own — whichever comes first. The pin is stored in
  // pinRef, not local effect state, specifically so clearPendingSection()
  // re-running this effect (with pendingSection now null) can't dispose it
  // early; see pinRef's declaration and the unmount effect below.
  useEffect(() => {
    if (!pendingSection) return
    pinRef.current?.dispose()

    const el = document.getElementById(pendingSection)
    if (!el) {
      clearPendingSection()
      return
    }
    el.scrollIntoView({ block: 'start' })
    selectSection(pendingSection)

    const scroller = contentRef.current ? findScroller(contentRef.current) : null
    const RELEASE_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    const release = () => dispose()
    const resizeObserver = new ResizeObserver(() => {
      if (!el.isConnected) {
        dispose()
        return
      }
      el.scrollIntoView({ block: 'start' })
    })
    if (contentRef.current) resizeObserver.observe(contentRef.current)
    const windowTimer = window.setTimeout(dispose, 1000)

    function dispose() {
      resizeObserver.disconnect()
      window.clearTimeout(windowTimer)
      RELEASE_EVENTS.forEach((type) => scroller?.removeEventListener(type, release))
      if (pinRef.current?.dispose === dispose) pinRef.current = null
    }

    RELEASE_EVENTS.forEach((type) => scroller?.addEventListener(type, release, { once: true }))
    pinRef.current = { dispose }
    clearPendingSection()
  }, [pendingSection, page, selectSection, clearPendingSection])

  // Tears the pin down on unmount only — this effect has no deps of its own,
  // so it never re-runs (and thus never fires) while mounted. StrictMode's
  // dev-only double-invoke calls this cleanup once synchronously right after
  // mount, but the pendingSection effect's second setup pass (also forced by
  // StrictMode) recreates the pin immediately after, so the net result after
  // the double-invoke settles is still exactly one live pin.
  useEffect(() => {
    return () => {
      pinRef.current?.dispose()
      pinRef.current = null
    }
  }, [])

  const pageButtonClass = (current: boolean) =>
    cn(
      'rounded-md px-2 py-1 text-left transition-colors duration-(--transition-fast) hover:bg-hover hover:text-foreground',
      current ? 'text-body-strong text-foreground' : 'text-muted-foreground',
    )

  return (
    <PageFrame title="Settings" width="wide" bodyClassName="flex gap-8">
      {/* Left rail — the sub-pages; the current page's sections nest under it */}
      <nav
        aria-label="Settings pages"
        className="sticky top-[calc(var(--page-header-h)+1.5rem)] hidden w-40 shrink-0 self-start md:block"
      >
        <ul className="space-y-0.5 text-body">
          {pages.map((p) => {
            const isCurrent = p.id === page
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => showPage(p.id)}
                  className={cn('block w-full', pageButtonClass(isCurrent))}
                >
                  {p.label}
                </button>
                {isCurrent && pageSections.length > 1 && (
                  <ul aria-label={`${p.label} sections`} className="mt-0.5 mb-1 space-y-0.5">
                    {pageSections.map((s) => {
                      const isActive = activeSection === s.id
                      return (
                        <li key={s.id}>
                          <a
                            href={`#${s.id}`}
                            aria-current={isActive ? 'true' : undefined}
                            onClick={() => selectSection(s.id)}
                            className={cn(
                              'block rounded-md py-1 pl-5 pr-2 transition-colors duration-(--transition-fast) hover:bg-hover hover:text-foreground',
                              isActive ? 'text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {s.label}
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Main content — the current page's sections, in registry order.
          Section offset on every direct child, so the standalone Backups /
          Reminders / Phone alerts components land like the rest. */}
      <div
        ref={contentRef}
        className="flex-1 min-w-0 space-y-8 [&>section]:scroll-mt-[calc(var(--page-header-h)+1.5rem)]"
      >
        {/* Below md the rail is hidden; keep every page reachable */}
        <nav aria-label="Settings pages" className="flex flex-wrap gap-1 md:hidden">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === page ? 'page' : undefined}
              onClick={() => showPage(p.id)}
              className={cn('text-body', pageButtonClass(p.id === page))}
            >
              {p.label}
            </button>
          ))}
        </nav>
        {pageSections.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && !s.standalone && <Separator />}
            {bodies[s.id]}
          </Fragment>
        ))}
      </div>
    </PageFrame>
  )
}
