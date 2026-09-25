import { useCallback, useMemo, useState } from 'react'
import { isKeepAsTextKey, parseCaptureDate, type ParsedCaptureDate } from '@/lib/captureDate'

/** Date parsing for one capture field. `content` is the part after any
 *  route prefix and must be a suffix of `full`. Only task-bound captures
 *  pass `enabled`. ⌫ right after the date keeps its words as text; that
 *  choice sticks until the field is cleared. */
export function useCaptureDate(full: string, content: string, enabled: boolean) {
  const [ignored, setIgnored] = useState<string[]>([])
  // Clearing the field forgets every "keep as text" choice.
  const [lastFull, setLastFull] = useState(full)
  if (full !== lastFull) {
    setLastFull(full)
    if (!full.trim() && ignored.length > 0) setIgnored([])
  }

  const date: ParsedCaptureDate | null = useMemo(
    () => (enabled && content.trim() ? parseCaptureDate(content, new Date(), ignored) : null),
    [enabled, content, ignored],
  )
  const offset = full.length - content.length
  const highlight = useMemo(
    () => (date ? { start: offset + date.start, end: offset + date.end } : null),
    [date, offset],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
      if (!date || !highlight) return false
      const el = e.currentTarget
      const keep = isKeepAsTextKey({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
        spanEnd: highlight.end,
        value: full,
      })
      if (!keep) return false
      e.preventDefault()
      setIgnored((prev) => [...prev, date.matchText.toLowerCase()])
      return true
    },
    [date, highlight, full],
  )

  /** Parse now even where the field isn't task-bound yet — Enter acting on a
   *  fresh Create task row the highlight never reached (Omnibar). Honours the
   *  "keep as text" choices. */
  const parseNow = useCallback(
    (): ParsedCaptureDate | null => (content.trim() ? parseCaptureDate(content, new Date(), ignored) : null),
    [content, ignored],
  )

  return { date, highlight, onKeyDown, parseNow }
}
