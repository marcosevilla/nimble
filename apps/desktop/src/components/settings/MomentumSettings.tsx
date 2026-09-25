import { useCallback, useEffect, useState } from 'react'
import type { MomentumSettings as Settings, WeekdayKey } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Meta } from '@/components/shared/typography'
import { emitMomentumChanged } from '@/hooks/useMomentumSummary'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { KARMA_DESCRIPTION, WEEKDAY_OPTIONS, goalTargetsFrom } from '@/lib/momentum'
import { FieldLabel, SECTION_CLASS, SectionHeader, SectionSkeleton } from './SettingsFields'

const FALLBACK = "That didn't save. Try again."

/** Settings → Today & brief → Goals & momentum (addendum §2, Lane C). The
 *  same `goals.*` keys the Today setup's Goals step writes (same 1–100 and
 *  1–700 bounds), plus Pause and the opt-in karma switch. Desktop only
 *  (`requires: 'momentum'`). Messages are neutral: nothing here is red. */
export function MomentumSettings() {
  const dp = useDataProvider()
  const [saved, setSaved] = useState<Settings | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [daily, setDaily] = useState('')
  const [weekly, setWeekly] = useState('')
  const [daysOff, setDaysOff] = useState<WeekdayKey[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = useCallback((s: Settings) => {
    setSaved(s)
    setDaily(String(s.daily_goal))
    setWeekly(String(s.weekly_goal))
    setDaysOff(s.days_off)
  }, [])

  const load = useCallback(() => {
    setLoadFailed(false)
    dp.momentum.getSettings().then(apply).catch(() => setLoadFailed(true))
  }, [dp, apply])

  useEffect(() => { load() }, [load])

  /** Another surface (the box's ⋯, the setup) changed momentum: re-read. */
  const afterWrite = (s: Settings) => {
    apply(s)
    emitMomentumChanged()
    // The setup's Goals step reads goals.* from the brief settings store.
    void useBriefSettingsStore.getState().load(true)
  }

  async function save(karmaEnabled?: boolean) {
    if (!saved) return
    const targets = goalTargetsFrom({ daily, weekly, daysOff, karmaEnabled: karmaEnabled ?? saved.karma_enabled })
    if ('error' in targets) {
      setError(targets.error)
      return
    }
    setBusy(true)
    setError('')
    try {
      afterWrite(await dp.momentum.saveGoals(targets.value))
    } catch (e) {
      setError(typeof e === 'string' ? e : FALLBACK)
    } finally {
      setBusy(false)
    }
  }

  async function setPaused(paused: boolean) {
    setBusy(true)
    setError('')
    try {
      afterWrite(await dp.momentum.setPaused(paused))
    } catch {
      setError(FALLBACK)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="momentum" className={SECTION_CLASS}>
      <SectionHeader title="Goals & momentum" description="Targets for the Momentum box on Today. A missed day changes nothing." />
      {!saved ? (
        <SectionSkeleton failed={loadFailed} onRetry={load} />
      ) : (
        <div className="space-y-4">
          {error && <p role="alert" className="text-body text-foreground">{error}</p>}
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="goal-daily">Daily goal</FieldLabel>
                <Input id="goal-daily" type="text" inputMode="numeric" value={daily}
                  onChange={(e) => setDaily(e.target.value)} disabled={busy} className="w-24 tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="goal-weekly">Weekly goal</FieldLabel>
                <Input id="goal-weekly" type="text" inputMode="numeric" value={weekly}
                  onChange={(e) => setWeekly(e.target.value)} disabled={busy} className="w-24 tabular-nums" />
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel id="momentum-days-off">Days off</FieldLabel>
              <ToggleGroup multiple aria-labelledby="momentum-days-off" value={daysOff} onValueChange={(v) => setDaysOff(v as WeekdayKey[])}>
                {WEEKDAY_OPTIONS.map((d) => (
                  <ToggleGroupItem key={d.value} value={d.value} aria-label={d.name} className="px-2 text-label">{d.short}</ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Meta as="p">Days off count toward nothing. Missing a goal never changes anything the next day.</Meta>
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>Save goals</Button>
          </form>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <FieldLabel htmlFor="momentum-pause">Pause momentum</FieldLabel>
              <Meta as="p">Goals and meters wait until you resume.</Meta>
            </div>
            <Switch id="momentum-pause" aria-label="Pause momentum" checked={saved.paused} disabled={busy}
              onCheckedChange={(v) => void setPaused(v)} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <FieldLabel htmlFor="karma-enabled">Todoist-style karma</FieldLabel>
              <Meta as="p">{KARMA_DESCRIPTION}</Meta>
            </div>
            <Switch id="karma-enabled" aria-label="Todoist-style karma" checked={saved.karma_enabled} disabled={busy}
              onCheckedChange={(v) => void save(v)} />
          </div>
        </div>
      )}
    </section>
  )
}
