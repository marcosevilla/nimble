import { useEffect, type KeyboardEvent } from 'react'
import { Check, MapPin } from 'lucide-react'
import type { BriefGoals, Weekday } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Meta } from '@/components/shared/typography'
import { FieldLabel } from '@/components/settings/SettingsFields'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { openSettings } from '@/stores/settingsNavStore'
import { applyPreset, PRESETS, type PresetId, type SetupDraft } from '@/lib/briefLayout'
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

export function GoalsStep({ draft, onChange, onContinue }: StepProps) {
  const setGoals = (patch: Partial<BriefGoals>) => onChange({ goals: { ...draft.goals, ...patch } })
  const numberField = (id: string, label: string, value: number, max: number, apply: (n: number) => void) => (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= 1 && n <= max) apply(n)
        }}
        onKeyDown={enterContinues(onContinue)}
        className="w-24"
      />
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        {numberField('setup-goal-daily', 'Tasks a day', draft.goals.daily, 100, (daily) => setGoals({ daily }))}
        {numberField('setup-goal-weekly', 'Tasks a week', draft.goals.weekly, 700, (weekly) => setGoals({ weekly }))}
      </div>
      <div className="space-y-1.5">
        <FieldLabel id="setup-days-off">Days off</FieldLabel>
        <ToggleGroup multiple aria-labelledby="setup-days-off" value={draft.goals.days_off} onValueChange={(v) => setGoals({ days_off: v as Weekday[] })}>
          {DAYS.map((d) => <ToggleGroupItem key={d.id} value={d.id} className="px-2 text-label">{d.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <Meta as="p">Days off count toward nothing. Missing a goal never changes anything the next day.</Meta>
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
