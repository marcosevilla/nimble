import { useEffect, useState } from 'react'
import type { BriefEffort, BriefModel } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Meta } from '@/components/shared/typography'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { openSettings } from '@/stores/settingsNavStore'
import type { SettingsFailure } from '@/lib/settingsMessage'
import { FieldLabel, SECTION_CLASS, SectionHeader, SectionSkeleton, SettingFieldRow, type SettingField } from './SettingsFields'

const TIME_FIELD: SettingField = {
  key: 'brief.time',
  label: 'Brief time',
  placeholder: '06:30',
  help: "Nimble prepares your brief at this time if it's open. Otherwise it's ready a few seconds after you open it.",
  type: 'time',
}
const MODELS: { value: BriefModel; label: string }[] = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
]
const EFFORTS: { value: BriefEffort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

/** Settings → Today & brief → Brief (addendum §2): brief time, the model
 *  and effort that write it (with the no-key note), and Run setup again
 *  (Task 8). */
export function TodayBriefSettings() {
  const settings = useBriefSettingsStore((s) => s.settings)
  const status = useBriefSettingsStore((s) => s.status)
  const save = useBriefSettingsStore((s) => s.save)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const [timeDraft, setTimeDraft] = useState<string | null>(null)
  const [timeSaving, setTimeSaving] = useState(false)
  const [timeSaved, setTimeSaved] = useState(false)
  const [timeError, setTimeError] = useState<SettingsFailure | null>(null)

  const saveTime = async () => {
    if (timeDraft === null) return
    setTimeSaving(true)
    const ok = await save({ time: timeDraft }, { silent: true })
    setTimeSaving(false)
    setTimeError(ok ? null : useBriefSettingsStore.getState().lastFailure)
    if (ok) {
      setTimeDraft(null)
      setTimeSaved(true)
      setTimeout(() => setTimeSaved(false), 2000)
    }
  }

  return (
    <section id="today-brief" className={SECTION_CLASS}>
      <SectionHeader title="Brief" description="When your brief is ready and which model writes it." />
      {!settings ? (
        <SectionSkeleton failed={status === 'error'} onRetry={() => void useBriefSettingsStore.getState().load(true)} />
      ) : (
        <div className="space-y-4">
          <SettingFieldRow
            field={TIME_FIELD}
            state={{ value: timeDraft ?? settings.time, saving: timeSaving, saved: timeSaved, error: timeError }}
            onChange={(v) => { setTimeDraft(v); setTimeSaved(false); setTimeError(null) }}
            onSave={() => void saveTime()}
          />
          <div className="space-y-1.5">
            <FieldLabel htmlFor="brief-model">AI model</FieldLabel>
            <Select value={settings.model} onValueChange={(v) => { if (v) void save({ model: v as BriefModel }) }}>
              <SelectTrigger id="brief-model" className="w-64">
                <SelectValue>{MODELS.find((m) => m.value === settings.model)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel id="brief-effort-label">Effort</FieldLabel>
            <ToggleGroup
              aria-labelledby="brief-effort-label"
              value={[settings.effort]}
              onValueChange={(v) => { const next = v[0] as BriefEffort | undefined; if (next) void save({ effort: next }) }}
            >
              {EFFORTS.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <Meta as="p">Low is fastest, about 10 seconds and 5¢ a day with Opus 5.5.</Meta>
          </div>
          {!settings.sources.ai && (
            <div className="flex flex-wrap items-center gap-2">
              <Meta as="p">No Anthropic key yet, so the brief sorts by priority without AI.</Meta>
              <Button variant="ghost" size="sm" onClick={() => openSettings('integrations')}>Add a key</Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
