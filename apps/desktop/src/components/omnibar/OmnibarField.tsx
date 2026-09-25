import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { pillText, type Pill } from '@/lib/omnibarQuery'
import { Icon } from '@/components/shared/Icon'
import { HighlightField, type HighlightRange } from '@/components/capture/HighlightField'

/** One row: pills first (`kind: value ×`), then the text input. × is a mouse
 *  target; Backspace in the empty field is the keyboard path (Omnibar.tsx).
 *  The input is an ARIA combobox over the results listbox: `listboxId` is
 *  null while no list shows, `activeOptionId` names the highlighted option. */
export function OmnibarField({ pills, value, highlight, inputRef, listboxId, activeOptionId, onChange, onKeyDown, onRemovePill, trailing }: {
  pills: readonly Pill[]
  value: string
  highlight: HighlightRange | null
  inputRef: React.RefObject<HTMLInputElement | null>
  listboxId: string | null
  activeOptionId: string | null
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRemovePill: (index: number) => void
  trailing?: ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border/50 bg-popover px-4 py-1.5 shadow-lg shadow-black/10">
      <Icon icon={Search} className="shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {pills.map((pill, i) => (
          <span
            key={`${pill.kind}:${pill.value}`}
            data-omnibar-pill=""
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-secondary pl-2 pr-1 text-meta text-secondary-foreground"
          >
            {pillText(pill)}
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove ${pillText(pill)}`}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the field
              onClick={() => onRemovePill(i)}
              className="relative flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--transition-fast) hover:bg-hover hover:text-foreground after:absolute after:-inset-1"
            >
              <Icon icon={X} className="size-3" />
            </button>
          </span>
        ))}
        <HighlightField
          fieldRef={inputRef}
          type="text"
          value={value}
          highlight={highlight}
          wrapperClassName="min-w-[8rem] flex-1"
          onChange={onChange}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label="Search or create"
          aria-autocomplete="list"
          aria-expanded={listboxId !== null}
          aria-controls={listboxId ?? undefined}
          aria-activedescendant={activeOptionId ?? undefined}
          // Not "Search or create…": that is LabelPicker's placeholder, and
          // e2e detects an open label picker by it (t2-row-keys AC4).
          placeholder={pills.length > 0 ? '' : 'Search, filter or create…'}
          className="text-body outline-none placeholder:text-muted-foreground"
        />
      </div>
      {trailing}
      <kbd className="rounded-sm border border-border/30 px-1.5 py-0.5 font-mono text-label text-muted-foreground">Esc</kbd>
    </div>
  )
}
