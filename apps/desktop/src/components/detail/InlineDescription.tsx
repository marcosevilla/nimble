import { useState, useRef, useCallback, useEffect } from 'react'

interface InlineDescriptionProps {
  value: string | null
  onSave: (value: string) => void
}

export function InlineDescription({ value, onSave }: InlineDescriptionProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
          className="w-full resize-none bg-transparent text-body text-muted-foreground leading-relaxed outline-none placeholder:text-muted-foreground"
          rows={2}
        />
      </>
    )
  }

  return (
    <>
      {/* leading-relaxed: deliberate prose override — rendered description is read like body copy */}
      <p
        onClick={startEditing}
        className="text-body leading-relaxed cursor-text hover:bg-accent/10 rounded-md -mx-1 px-1 transition-colors min-h-[24px]"
      >
        {value ? (
          <span className="text-muted-foreground">{value}</span>
        ) : (
          <span className="text-muted-foreground">Add a description...</span>
        )}
      </p>
    </>
  )
}
