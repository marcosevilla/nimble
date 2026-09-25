import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Meta } from '@/components/shared/typography'
import { Textarea } from '@/components/ui/textarea'
import { useDataProvider } from '@/services/provider-context'
import { BriefBox } from '../BriefBox'
import { useBriefLive } from '../briefLive'
import type { BriefBoxProps } from '../briefModules'

type Draft = { date: string; text: string }

/** Today's scratchpad (`briefs.notes`), saved 600 ms after typing stops and
 *  flushed if the page unmounts first. Past days read-only. */
export function NotesBox({ mode, brief }: BriefBoxProps) {
  const dp = useDataProvider()
  const live = useBriefLive()
  const today = live?.today ?? null
  const stored = mode === 'snapshot' ? brief?.notes ?? null : live?.brief?.notes ?? null
  const [draft, setDraft] = useState<Draft | null>(null)
  const pending = useRef<Draft | null>(null)
  const writable = mode === 'live' && dp.briefSettings.supported
  const value = draft && draft.date === today ? draft.text : stored ?? ''

  useEffect(() => {
    if (!draft) return
    pending.current = draft
    const timer = setTimeout(() => {
      pending.current = null
      dp.brief.setNotes(draft.date, draft.text).catch(() => toast.error("Notes didn't save. Try again."))
    }, 600)
    return () => clearTimeout(timer)
  }, [dp, draft])

  useEffect(() => {
    const box = pending
    return () => {
      const last = box.current
      if (last) void dp.brief.setNotes(last.date, last.text).catch(() => {})
    }
  }, [dp])

  return (
    <BriefBox title="Notes">
      {mode === 'snapshot' ? (
        stored ? <p className="whitespace-pre-wrap text-body">{stored}</p> : <Meta as="p">No notes that day.</Meta>
      ) : mode === 'preview' ? (
        <Meta as="p">A scratchpad for the day.</Meta>
      ) : (
        <Textarea
          aria-label="Notes for today"
          placeholder="A scratchpad for the day"
          value={value}
          readOnly={!writable}
          onChange={(e) => today && setDraft({ date: today, text: e.target.value })}
          className="min-h-20 resize-y"
        />
      )}
    </BriefBox>
  )
}
