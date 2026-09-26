import { useState, useRef, useCallback, useEffect, useId } from 'react'

interface InlineDescriptionProps {
  value: string | null
  onSave: (value: string) => void
}

export function InlineDescription({ value, onSave }: InlineDescriptionProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()

  useEffect(() => { setDraft(value ?? '') }, [value])

  const startEditing = useCallback(() => {
    setEditing(true)
    setDraft(value ?? '')
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
      }
    })
  }, [value])

  const save = useCallback(() => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== (value ?? '').trim()) onSave(trimmed)
  }, [draft, value, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setDraft(value ?? '') }
    if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); save() }
  }, [save, value])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  }, [])

  if (editing) {
    return (
      <>
        {/* leading-relaxed: deliberate prose override — description is read like body copy */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleInput}
          onBlur={save}
          onKeyDown={handleKeyDown}
          placeholder="Add a description..."
          aria-label="Description"
          // field-ghost: the shared ghost-field focus well (index.css);
          // -my-1 cancels its py-1 so display → edit doesn't move the page.
          className="field-ghost -my-1 w-full resize-none text-body text-muted-foreground leading-relaxed placeholder:text-muted-foreground"
          rows={2}
        />
      </>
    )
  }

  return (
    <>
      {/* leading-relaxed: deliberate prose override — rendered description is read like body copy */}
      {/* Click-to-edit, keyboard too (loop 4 P2-13): a Tab stop, Enter /
          Space to edit. With text it's a named group plus an Enter hint, so
          the text itself is what's read (a button's label would replace
          it); empty, the placeholder is the button and its name. */}
      <p
        role={value ? 'group' : 'button'}
        tabIndex={0}
        aria-label={value ? 'Description' : undefined}
        aria-describedby={value ? hintId : undefined}
        onClick={startEditing}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditing() }
        }}
        className="focus-ring text-body leading-relaxed cursor-text hover:bg-hover rounded-md -mx-1 px-1 transition-colors min-h-[24px]"
      >
        {value ? (
          <span className="text-muted-foreground">{value}</span>
        ) : (
          <span className="text-muted-foreground">Add a description...</span>
        )}
        {value && <span id={hintId} className="sr-only">Press Enter to edit.</span>}
      </p>
    </>
  )
}
