import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta } from '@/components/shared/typography'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { SETUP_STEPS, useTodaySetupStore } from '@/stores/todaySetupStore'
import { setupPatch } from '@/lib/briefLayout'
import { setupKey } from '@/lib/keyGuard'
import { hasOpenOverlay } from '@/lib/rowNav'
import { ArrangeStep, GoalsStep, LayoutStep, LocationStep, SourcesStep, TimeStep } from './SetupSteps'
import { SetupPreview } from './SetupPreview'

const TITLES = [
  'Choose a starting layout',
  'Where are you?',
  'When should your brief be ready?',
  'Connect your sources',
  'Set your goals',
  'Arrange your boxes',
] as const

/** The Today setup (addendum §3): six skippable steps, one save at the end. */
export function TodaySetup({ onDone }: { onDone: () => void }) {
  const step = useTodaySetupStore((s) => s.step)
  const draft = useTodaySetupStore((s) => s.draft)
  const go = useTodaySetupStore((s) => s.go)
  const patch = useTodaySetupStore((s) => s.patch)
  const close = useTodaySetupStore((s) => s.close)
  const save = useBriefSettingsStore((s) => s.save)
  const [saving, setSaving] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Each step starts on its heading, so ↵ continues and Tab reaches its controls.
  useEffect(() => { headingRef.current?.focus() }, [step])

  const finish = useCallback(async () => {
    if (!draft || saving) return
    setSaving(true)
    const ok = await save(setupPatch(draft))
    setSaving(false)
    if (ok) {
      close()
      onDone()
    }
  }, [draft, saving, save, close, onDone])

  const next = useCallback(() => {
    if (step < SETUP_STEPS - 1) go(step + 1)
    else void finish()
  }, [step, go, finish])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = setupKey(
        { key: e.key, target: e.target as HTMLElement | null, defaultPrevented: e.defaultPrevented, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, repeat: e.repeat },
        hasOpenOverlay(),
      )
      if (action === 'continue') { e.preventDefault(); next() }
      else if (action === 'skip') { e.preventDefault(); void finish() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, finish])

  if (!draft) return <Skeleton className="h-72 w-full rounded-xl" />
  const props = { draft, onChange: patch, onContinue: next }

  return (
    <section aria-labelledby="today-setup-title" className="@container">
      <div className="grid gap-6 @min-[46rem]:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <div className="surface-panel flex min-w-0 flex-col gap-4 p-5">
          <div className="flex items-center gap-2">
            <Meta as="p" aria-live="polite" className="tabular-nums">Step {step + 1} of {SETUP_STEPS}</Meta>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => go(step - 1)} disabled={step === 0 || saving}>Back</Button>
              <Button variant="ghost" size="sm" onClick={() => void finish()} disabled={saving}>Skip setup</Button>
            </div>
          </div>
          <h2 id="today-setup-title" ref={headingRef} tabIndex={-1} className="text-title outline-none">{TITLES[step]}</h2>
          {step === 0 && <LayoutStep {...props} />}
          {step === 1 && <LocationStep {...props} />}
          {step === 2 && <TimeStep {...props} />}
          {step === 3 && <SourcesStep />}
          {step === 4 && <GoalsStep {...props} />}
          {step === 5 && <ArrangeStep {...props} />}
          <div className="mt-auto flex items-center justify-end gap-3 pt-2">
            <Meta as="p">↵ to continue · Esc to skip setup</Meta>
            <Button onClick={next} disabled={saving}>{step === SETUP_STEPS - 1 ? 'Finish' : 'Continue'}</Button>
          </div>
        </div>
        <SetupPreview draft={draft} className="hidden @min-[46rem]:block" />
      </div>
    </section>
  )
}
