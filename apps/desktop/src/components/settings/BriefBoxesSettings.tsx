import { useEffect } from 'react'
import { BoxesList } from '@/components/today/BoxesList'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { SECTION_CLASS, SectionHeader, SectionSkeleton } from './SettingsFields'

/** Settings → Today & brief → Boxes (addendum §2). Each change saves the
 *  whole list; the store serializes saves, so rapid edits land in order. */
export function BriefBoxesSettings() {
  const settings = useBriefSettingsStore((s) => s.settings)
  const status = useBriefSettingsStore((s) => s.status)
  const save = useBriefSettingsStore((s) => s.save)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  return (
    <section id="today-boxes" className={SECTION_CLASS}>
      <SectionHeader title="Boxes" description="Which boxes your brief shows, in what order, and what each one shows. Drag a row, or press ⌥↑ and ⌥↓." />
      {!settings ? (
        <SectionSkeleton rows={6} failed={status === 'error'} onRetry={() => void useBriefSettingsStore.getState().load(true)} />
      ) : (
        <BoxesList entries={settings.modules} manifests={settings.manifests} onChange={(modules) => void save({ modules })} />
      )}
    </section>
  )
}
