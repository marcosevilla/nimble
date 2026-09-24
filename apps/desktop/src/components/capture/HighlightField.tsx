import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type Ref } from 'react'
import { cn } from '@/lib/utils'

export interface HighlightRange {
  start: number
  end: number
}

/* Metrics the mirror must share with the field so the tint lands exactly
   under the matched characters. Copied from the live field, so any font
   setting or class change carries over. */
const MIRRORED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontFeatureSettings', 'fontVariationSettings', 'fontVariantNumeric',
  'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing',
] as const

function mirrorMetrics(field: HTMLElement): CSSProperties {
  const cs = getComputedStyle(field)
  const out: Record<string, string> = { borderStyle: 'solid', borderColor: 'transparent' }
  for (const p of MIRRORED) out[p] = cs[p]
  return out as CSSProperties
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement

/** Assigns a callback or object ref. Kept outside the component so the
 *  `.current` write isn't seen as mutating a component prop in place. */
function assignRef(ref: Ref<FieldEl> | undefined, el: FieldEl | null) {
  if (typeof ref === 'function') ref(el)
  else if (ref) (ref as React.MutableRefObject<FieldEl | null>).current = el
}

interface CommonProps {
  value: string
  highlight: HighlightRange | null
  wrapperClassName?: string
  fieldRef?: Ref<FieldEl>
}

// Discriminated on `multiline` so the rest-props spread onto <input>/<textarea>
// below keeps element-specific event types (onChange, onScroll, …) intact —
// no `any`/`as never` needed to bridge the two HTML attribute sets.
type InputProps = CommonProps & {
  multiline?: false
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'ref'>

type TextareaProps = CommonProps & {
  multiline: true
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'ref'>

type HighlightFieldProps = InputProps | TextareaProps

/** Strips the field's own props, leaving only what should be spread onto the
 *  DOM element. Generic over `T` so calling it on an already-narrowed branch
 *  of `HighlightFieldProps` keeps that branch's specific attribute types
 *  (onChange/onScroll/… typed for <input> or <textarea>, not a lossy union). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit them
function restProps<T extends CommonProps & { multiline?: boolean; className?: string }>({ value, highlight, wrapperClassName, multiline, fieldRef, className, ...rest }: T) {
  return rest
}

/** An input (or textarea) that tints `highlight` inside its own text. A
 *  mirror sits behind the transparent field with the same metrics and
 *  scroll position; only the tinted span paints. */
export function HighlightField(props: HighlightFieldProps) {
  const { value, highlight, wrapperClassName, className } = props
  const multiline = props.multiline ?? false
  const fieldEl = useRef<FieldEl | null>(null)
  const mirrorEl = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<CSSProperties>({})
  const fieldRef = props.fieldRef

  const setRefs = useCallback((el: FieldEl | null) => {
    fieldEl.current = el
    assignRef(fieldRef, el)
  }, [fieldRef])

  const sync = useCallback(() => {
    const f = fieldEl.current
    const m = mirrorEl.current
    if (!f || !m) return
    m.scrollLeft = f.scrollLeft
    m.scrollTop = f.scrollTop
  }, [])

  const hasHighlight = highlight !== null
  useLayoutEffect(() => {
    if (hasHighlight && fieldEl.current) setMetrics(mirrorMetrics(fieldEl.current))
  }, [hasHighlight])
  // After every value/caret change the browser may scroll the field; follow it.
  useLayoutEffect(() => {
    if (!hasHighlight) return
    sync()
    const id = requestAnimationFrame(sync)
    return () => cancelAnimationFrame(id)
  }, [value, highlight?.start, highlight?.end, hasHighlight, sync])

  const start = highlight ? Math.max(0, Math.min(highlight.start, value.length)) : 0
  const end = highlight ? Math.max(start, Math.min(highlight.end, value.length)) : 0
  const fieldClassName = cn('relative block w-full bg-transparent', className)

  const mirror = hasHighlight ? (
    <div
      ref={mirrorEl}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden text-transparent"
      style={{
        ...metrics,
        whiteSpace: multiline ? 'pre-wrap' : 'pre',
        overflowWrap: multiline ? 'break-word' : 'normal',
        ...(multiline ? { scrollbarGutter: 'stable' } : null),
      }}
    >
      {value.slice(0, start)}
      <mark className="rounded-[3px] bg-primary/15 text-transparent">{value.slice(start, end)}</mark>
      {value.slice(end)}
      {multiline ? '​' : null}
    </div>
  ) : null

  let field: JSX.Element
  if (props.multiline) {
    // Narrowed to TextareaProps here, so `rest` carries textarea-typed handlers.
    const rest = restProps(props)
    field = (
      <textarea
        {...rest}
        ref={setRefs}
        value={value}
        className={fieldClassName}
        style={{ ...rest.style, scrollbarGutter: 'stable' }}
        onScroll={(e) => {
          sync()
          rest.onScroll?.(e)
        }}
        onSelect={(e) => {
          requestAnimationFrame(sync)
          rest.onSelect?.(e)
        }}
      />
    )
  } else {
    // Narrowed to InputProps here, so `rest` carries input-typed handlers.
    const rest = restProps(props)
    field = (
      <input
        {...rest}
        ref={setRefs}
        value={value}
        className={fieldClassName}
        onScroll={(e) => {
          sync()
          rest.onScroll?.(e)
        }}
        onSelect={(e) => {
          requestAnimationFrame(sync)
          rest.onSelect?.(e)
        }}
      />
    )
  }

  return (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      {mirror}
      {field}
    </div>
  )
}
