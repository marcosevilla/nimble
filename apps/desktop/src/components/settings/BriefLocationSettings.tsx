import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Label as SectionLabel, Meta } from '@/components/shared/typography'
import { CitySearch } from '@/components/today/CitySearch'
import { useDataProvider } from '@/services/provider-context'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { configValue, setModuleConfig } from '@/lib/briefLayout'
import { SECTION_CLASS, SectionHeader, SectionSkeleton } from './SettingsFields'

const UNITS = [
  { value: 'auto', label: 'Auto' },
  { value: 'F', label: '°F' },
  { value: 'C', label: '°C' },
] as const

/** Settings → Today & brief → Location & weather (addendum §2): the city
 *  (geocoded in Rust), units and rain notes (the weather module's config,
 *  the same values the Boxes list edits), and the CC BY 4.0 attribution. */
export function BriefLocationSettings() {
  const dp = useDataProvider()
  const settings = useBriefSettingsStore((s) => s.settings)
  const status = useBriefSettingsStore((s) => s.status)
  const save = useBriefSettingsStore((s) => s.save)
  const [changing, setChanging] = useState(false)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const weather = settings?.modules.find((m) => m.id === 'weather')
  const setWeather = (patch: Record<string, unknown>) => {
    if (settings) void save({ modules: setModuleConfig(settings.modules, 'weather', patch) })
  }

  return (
    <section id="today-location" className={SECTION_CLASS}>
      <SectionHeader title="Location & weather" description="Used for the weather chip at the top of your brief." />
      {!settings ? (
        <SectionSkeleton failed={status === 'error'} onRetry={() => void useBriefSettingsStore.getState().load(true)} />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <SectionLabel as="div">Location</SectionLabel>
            {settings.location && !changing ? (
              <div className="flex min-w-0 items-center gap-2">
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body">{settings.location.name}</span>
                <Button variant="outline" size="sm" onClick={() => setChanging(true)}>Change</Button>
                <Button variant="ghost" size="sm" onClick={() => void save({ location: null })}>Remove</Button>
              </div>
            ) : (
              <CitySearch
                autoFocus={changing}
                onPick={(location) => { setChanging(false); void save({ location }) }}
                onCancel={settings.location ? () => setChanging(false) : undefined}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <SectionLabel as="div" id="weather-units-label">Units</SectionLabel>
            <ToggleGroup
              aria-labelledby="weather-units-label"
              value={[String(weather?.config.units ?? 'auto')]}
              onValueChange={(v) => { if (v[0]) setWeather({ units: v[0] }) }}
            >
              {UNITS.map((u) => <ToggleGroupItem key={u.value} value={u.value}>{u.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span id="rain-notes-label" className="text-body-strong">Rain notes</span>
              <Meta as="p">Flags a timed event when rain is likely at that hour.</Meta>
            </div>
            <Switch
              aria-labelledby="rain-notes-label"
              checked={configValue(weather?.config, 'rain_notes', true)}
              onCheckedChange={(on) => setWeather({ rain_notes: on })}
            />
          </div>
          <Meta as="p">
            Weather data by{' '}
            <button
              type="button"
              className="focus-ring rounded-sm underline underline-offset-2 hover:text-foreground"
              onClick={() => void dp.system.openUrl('https://open-meteo.com/')}
            >
              Open-Meteo.com
            </button>
            , licensed CC BY 4.0.
          </Meta>
        </div>
      )}
    </section>
  )
}
