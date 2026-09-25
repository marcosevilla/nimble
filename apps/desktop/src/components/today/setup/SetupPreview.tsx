import { MapPin } from 'lucide-react'
import { Label, Meta } from '@/components/shared/typography'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { arrangeBrief, type SetupDraft } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { ModuleBox } from '../ModuleBox'
import { briefModuleInfo } from '../briefModules'
import { useBriefLive } from '../briefLive'

/** The real brief under the draft settings (UX checkpoint 2): today's live
 *  data, modules in `preview` mode, `inert` so nothing inside is focusable
 *  or clickable. A city picked in step 2 isn't fetched until Finish, so the
 *  chip says so instead of showing the old city's weather. */
export function SetupPreview({ draft, className }: { draft: SetupDraft; className?: string }) {
  const live = useBriefLive()
  const saved = useBriefSettingsStore((s) => s.settings?.location ?? null)
  const locationChanged = (draft.location?.name ?? null) !== (saved?.name ?? null)
  const { header, body } = arrangeBrief(draft.modules, briefModuleInfo, false)
  const today = live?.today ?? ''
  return (
    <div data-setup-preview className={cn('min-w-0 space-y-2', className)}>
      <Label as="p">Preview</Label>
      <div inert className="max-h-[calc(100vh-var(--page-header-h)-6rem)] space-y-4 overflow-y-auto rounded-xl">
        {header.length > 0 && (
          <div className="flex items-center gap-2">
            {header.map((e) =>
              e.id === 'weather' && locationChanged && draft.location ? (
                <span key={e.id} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-meta text-muted-foreground">
                  <MapPin className="size-3.5" aria-hidden /> {draft.location.name} · weather after setup
                </span>
              ) : (
                <ModuleBox key={e.id} id={e.id} mode="preview" date={today} config={e.config} />
              ),
            )}
          </div>
        )}
        {body.map((e) => (
          <ModuleBox key={e.id} id={e.id} mode="preview" date={today} config={e.config} />
        ))}
        {header.length + body.length === 0 && <Meta as="p">No boxes are on. Turn some on in the last step.</Meta>}
      </div>
    </div>
  )
}
