import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useDataProvider } from '@/services/provider-context'
import { BriefDisplay } from '@/components/shared/BriefDisplay'
import { SectionTitle } from '@/components/shared/typography'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** The legacy markdown brief from the vault, collapsed. The one container
 *  allowed to hide: it renders nothing while loading and when no file exists
 *  for `date` (it exists only for the transition, spec §3.2). */
export function VaultBox({ date }: { date: string }) {
  const dp = useDataProvider()
  const [loaded, setLoaded] = useState<{ date: string; content: string | null } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    dp.dailyState.readDailyBrief(date)
      .then((content) => { if (live) setLoaded({ date, content }) })
      .catch(() => { if (live) setLoaded({ date, content: null }) })
    return () => { live = false }
  }, [dp, date])

  // Keyed by date so a new day never shows the old day's text.
  const content = loaded?.date === date ? loaded.content : null
  if (!content) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="surface-panel px-4 py-2">
      <SectionTitle as="h2">
        <CollapsibleTrigger className="flex items-center gap-1.5 py-1 text-left data-[panel-open]:[&>svg:first-child]:rotate-90">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)" />
          From your vault
        </CollapsibleTrigger>
      </SectionTitle>
      <CollapsibleContent className="overflow-hidden transition-opacity duration-(--transition-fast) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
        <div className="pb-2 pt-1">
          <BriefDisplay markdown={content} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
