import { useCallback, useEffect, useRef, useState } from 'react'
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

  // Re-entry guard (a ref: disabling a control mid-save would drop
  // keyboard focus to <body>).
  const writing = useRef(false)

  async function write(run: () => Promise<Settings>, fallback = FALLBACK) {
    if (writing.current) return
    writing.current = true
    setError('')
    try {
      afterWrite(await run())
    } catch (e) {
      setError(typeof e === 'string' ? e : fallback)
    } finally {
      writing.current = false
    }
  }

  /** The goal form: daily, weekly, days off (karma unchanged). */
  function saveGoals() {
    if (!saved) return
    const targets = goalTargetsFrom({ daily, weekly, daysOff, karmaEnabled: saved.karma_enabled })
    if ('error' in targets) {
      setError(targets.error)
      return
    }
    void write(() => dp.momentum.saveGoals(targets.value))
  }

  /** The karma switch saves only karma: the goals as saved, not the form. */
  function setKarma(on: boolean) {
    if (!saved) return
    void write(() => dp.momentum.saveGoals({
      daily: saved.daily_goal, weekly: saved.weekly_goal, days_off: saved.days_off, karma_enabled: on,
    }))
  }

  function setPaused(paused: boolean) {
    void write(() => dp.momentum.setPaused(paused))
  }

  return (
    <section id="momentum" className={SECTION_CLASS}>
      <SectionHeader title="Goals & momentum" description="Targets for the Momentum box on Today. Each day and week start fresh." />
      {!saved ? (
        <SectionSkeleton failed={loadFailed} onRetry={load} />
      ) : (
        <div className="space-y-4">
          {error && <p role="alert" className="text-body text-foreground">{error}</p>}
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveGoals() }}>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="goal-daily">Daily goal</FieldLabel>
                <Input id="goal-daily" type="text" inputMode="numeric" value={daily}
                  onChange={(e) => setDaily(e.target.value)} className="w-24 tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="goal-weekly">Weekly goal</FieldLabel>
                <Input id="goal-weekly" type="text" inputMode="numeric" value={weekly}
                  onChange={(e) => setWeekly(e.target.value)} className="w-24 tabular-nums" />
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel id="momentum-days-off">Days off</FieldLabel>
              <ToggleGroup multiple aria-labelledby="momentum-days-off" value={daysOff} onValueChange={(v) => setDaysOff(v as WeekdayKey[])}>
                {WEEKDAY_OPTIONS.map((d) => (
                  <ToggleGroupItem key={d.value} value={d.value} aria-label={d.name} className="px-2 text-label">{d.short}</ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Meta as="p">Days off count toward nothing. Each day and week start fresh.</Meta>
            </div>
            <Button type="submit" size="sm" variant="outline">Save goals</Button>
          </form>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <FieldLabel htmlFor="momentum-pause">Pause momentum</FieldLabel>
              <Meta as="p">Goals and meters wait until you resume.</Meta>
            </div>
            <Switch id="momentum-pause" aria-label="Pause momentum" checked={saved.paused}
              onCheckedChange={(v) => setPaused(v)} />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <FieldLabel htmlFor="karma-enabled">Todoist-style karma</FieldLabel>
              <Meta as="p">{KARMA_DESCRIPTION}</Meta>
            </div>
            <Switch id="karma-enabled" aria-label="Todoist-style karma" checked={saved.karma_enabled}
              onCheckedChange={(v) => setKarma(v)} />
          </div>
        </div>
      )}
    </section>
  )
}
