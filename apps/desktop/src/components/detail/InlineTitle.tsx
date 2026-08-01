import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface InlineTitleProps {
  value: string
  completed?: boolean
  onSave: (value: string) => void
}

export function InlineTitle({ value, completed, onSave }: InlineTitleProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  const startEditing = useCallback(() => {
    setEditing(true)
    setDraft(value)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [value])

  const save = useCallback(() => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setDraft(value)
  }, [draft, value, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setDraft(value) }
  }, [save, value])

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent text-title outline-none"
      />
    )
  }

  return (
    <h1
      onClick={startEditing}
      className={cn(
        'text-title cursor-text hover:bg-accent/10 rounded-md -mx-1 px-1 transition-colors',
        completed && 'text-muted-foreground line-through',
      )}
    >
      {value}
    </h1>
  )
}
