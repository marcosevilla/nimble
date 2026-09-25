import { useEffect, useState, type KeyboardEvent } from 'react'
import { Check, MapPin } from 'lucide-react'
import type { BriefGoals, Weekday } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Meta } from '@/components/shared/typography'
import { FieldLabel } from '@/components/settings/SettingsFields'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { openSettings } from '@/stores/settingsNavStore'
import { applyPreset, parseGoal, PRESETS, type PresetId, type SetupDraft } from '@/lib/briefLayout'
import { daysOffError } from '@/lib/momentum'
import { useTodaySetupStore } from '@/stores/todaySetupStore'
import { BoxesList } from '../BoxesList'
import { CitySearch } from '../CitySearch'

export interface StepProps {
  draft: SetupDraft
  onChange: (patch: Partial<SetupDraft>) => void
  onContinue: () => void
}

/** ↵ in a field that has no other use for it continues. */
function enterContinues(onContinue: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
      e.preventDefault()
      onContinue()
    }
  }
}

export function LayoutStep({ draft, onChange }: StepProps) {
  return (
    <div className="space-y-2">
      <Meta as="p">Pick a starting point. You can change every box later.</Meta>
      <ToggleGroup
        orientation="vertical"
        aria-label="Starting layout"
        value={draft.preset ? [draft.preset] : []}
        onValueChange={(v) => {
          const id = v[0] as PresetId | undefined
          if (id) onChange({ preset: id, modules: applyPreset(draft.modules, id) })
        }}
        className="w-full gap-2 bg-transparent p-0"
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem
            key={p.id}
            value={p.id}
            className="h-auto w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left data-pressed:border-primary"
          >
            <span className="text-body-strong">{p.name}</span>
            <span className="whitespace-normal text-meta text-muted-foreground">{p.description}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export function LocationStep({ draft, onChange }: StepProps) {
  return (
    <div className="space-y-3">
      {draft.location && (
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body">{draft.location.name}</span>
          <Button variant="ghost" size="sm" onClick={() => onChange({ location: null })}>Remove</Button>
        </div>
      )}
      <CitySearch label={draft.location ? 'Change city' : 'Search for a city'} onPick={(location) => onChange({ location })} />
      <Meta as="p">Used only for the weather chip. Skip it and the chip reads “Add location”.</Meta>
    </div>
  )
}

export function TimeStep({ draft, onChange, onContinue }: StepProps) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor="setup-brief-time">Brief time</FieldLabel>
      <Input
        id="setup-brief-time"
        type="time"
        value={draft.time}
        onChange={(e) => { if (e.target.value) onChange({ time: e.target.value }) }}
        onKeyDown={enterContinues(onContinue)}
        className="w-32"
      />
      <Meta as="p">Nimble prepares your brief at this time if it’s open. Otherwise it’s ready a few seconds after you open it.</Meta>
    </div>
  )
}

const SOURCES = [
  { key: 'calendar', name: 'Calendar', detail: 'Events for your schedule.', section: 'calendars' },
  { key: 'tasks', name: 'Todoist sync', detail: 'Keeps your tasks mirrored in Todoist.', section: 'todoist-sync' },
  { key: 'vault', name: 'Obsidian vault', detail: 'Your past markdown briefs.', section: 'obsidian' },
  { key: 'ai', name: 'Anthropic key', detail: 'AI priorities. Without it, the brief sorts by priority.', section: 'integrations' },
] as const

export function SourcesStep() {
  const sources = useBriefSettingsStore((s) => s.settings?.sources)
  // Back from Settings → Connections: re-read what's connected now.
  useEffect(() => { void useBriefSettingsStore.getState().load(true) }, [])
  return (
    <div className="space-y-2">
      <Meta as="p">Everything here is optional. The brief works with whatever is connected.</Meta>
      <ul className="divide-y divide-border/50 rounded-lg border">
        {SOURCES.map((s) => {
          const connected = !!sources?.[s.key]
          return (
            <li key={s.key} className="flex min-w-0 items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-body-strong">{s.name}</p>
                <Meta as="p" className="truncate">{s.detail}</Meta>
              </div>
              {connected ? (
                <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                  <Check className="size-3.5" aria-hidden /> Connected
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => openSettings(s.section)}>Connect</Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const DAYS: { id: Weekday; label: string }[] = [
  { id: 'mon', label: 'Mon' }, { id: 'tue', label: 'Tue' }, { id: 'wed', label: 'Wed' }, { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' }, { id: 'sat', label: 'Sat' }, { id: 'sun', label: 'Sun' },
]

const GOAL_FIELDS = [
  { key: 'daily', id: 'setup-goal-daily', label: 'Tasks a day', max: 100 },
  { key: 'weekly', id: 'setup-goal-weekly', label: 'Tasks a week', max: 700 },
] as const
type GoalKey = (typeof GOAL_FIELDS)[number]['key']

/** Goals keep exactly what was typed. A value that isn't a whole number in
 *  range stays in the field with an inline hint (on blur, or on Continue,
 *  which then stays on this step); the draft keeps the last valid number. */
export function GoalsStep({ draft, onChange, onContinue }: StepProps) {
  const setGoals = (patch: Partial<BriefGoals>) => onChange({ goals: { ...draft.goals, ...patch } })
  const showHints = useTodaySetupStore((s) => s.showHints)
  const setInvalid = useTodaySetupStore((s) => s.setInvalid)
  const [text, setText] = useState<Partial<Record<GoalKey, string>>>({})
  const [blurred, setBlurred] = useState<Partial<Record<GoalKey, boolean>>>({})
  const textOf = (k: GoalKey, t = text) => t[k] ?? String(draft.goals[k])
  const change = (k: GoalKey, max: number, raw: string) => {
    const next = { ...text, [k]: raw }
    setText(next)
    const n = parseGoal(raw, max)
    if (n !== null) setGoals({ [k]: n })
    setInvalid(GOAL_FIELDS.some((f) => parseGoal(textOf(f.key, next), f.max) === null) || daysOffError(draft.goals.days_off) !== null)
  }
  const daysError = daysOffError(draft.goals.days_off)
  const changeDays = (days: Weekday[]) => {
    setGoals({ days_off: days })
    setInvalid(GOAL_FIELDS.some((f) => parseGoal(textOf(f.key), f.max) === null) || daysOffError(days) !== null)
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        {GOAL_FIELDS.map((f) => {
          const bad = parseGoal(textOf(f.key), f.max) === null
          const hint = bad && (blurred[f.key] || showHints)
          return (
            <div key={f.key} className="space-y-1.5">
              <FieldLabel htmlFor={f.id}>{f.label}</FieldLabel>
              <Input
                id={f.id}
                type="text"
                inputMode="numeric"
                value={textOf(f.key)}
                aria-invalid={bad || undefined}
                aria-describedby={hint ? `${f.id}-hint` : undefined}
                onChange={(e) => change(f.key, f.max, e.target.value)}
                onBlur={() => setBlurred((b) => ({ ...b, [f.key]: true }))}
                onKeyDown={enterContinues(onContinue)}
                className="w-24"
              />
              {hint && (
                <p id={`${f.id}-hint`} role="alert" className="text-meta text-destructive">
                  Whole number, 1–{f.max}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <div className="space-y-1.5">
        <FieldLabel id="setup-days-off">Days off</FieldLabel>
        <ToggleGroup multiple aria-labelledby="setup-days-off" aria-describedby={daysError ? 'setup-days-off-hint' : undefined}
          value={draft.goals.days_off} onValueChange={(v) => changeDays(v as Weekday[])}>
          {DAYS.map((d) => <ToggleGroupItem key={d.id} value={d.id} className="px-2 text-label">{d.label}</ToggleGroupItem>)}
        </ToggleGroup>
        {daysError && <p id="setup-days-off-hint" role="alert" className="text-meta text-destructive">{daysError}</p>}
        <Meta as="p">Days off count toward nothing. Each day and week start fresh.</Meta>
      </div>
    </div>
  )
}

export function ArrangeStep({ draft, onChange }: StepProps) {
  const manifests = useBriefSettingsStore((s) => s.settings?.manifests ?? [])
  return (
    <div className="space-y-2">
      <Meta as="p">Turn boxes on or off and put them in the order you read them. Drag, or press ⌥↑ and ⌥↓.</Meta>
      <BoxesList entries={draft.modules} manifests={manifests} onChange={(modules) => onChange({ modules, preset: null })} label="Boxes" />
    </div>
  )
}
