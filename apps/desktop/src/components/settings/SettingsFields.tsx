// Settings building blocks shared by every section (moved out of
// SettingsPage so section components in components/settings/ reuse them).
import { useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta, SectionTitle } from '@/components/shared/typography'
import type { SettingsFailure } from '@/lib/settingsMessage'
import { cn } from '@/lib/utils'

export const SECTION_CLASS = 'space-y-4 scroll-mt-[calc(var(--page-header-h)+1.5rem)]'

export interface SettingField {
  key: string
  label: string
  placeholder: string
  help: string
  type: 'text' | 'password' | 'time'
}

export interface FieldState {
  value: string
  saving: boolean
  saved: boolean
  error: SettingsFailure | null
}

/** Neutral headline + the raw error behind a disclosure (settings P2-16). */
export function FailureNote({ failure }: { failure: SettingsFailure | null }) {
  if (!failure) return null
  return (
    <div className="space-y-1">
      <p className="text-meta text-destructive" role="alert">{failure.message}</p>
      {failure.detail && failure.detail !== failure.message && (
        <details>
          <summary className="cursor-pointer text-label text-muted-foreground">Details</summary>
          <code className="block whitespace-pre-wrap break-all font-mono text-label text-muted-foreground">
            {failure.detail}
          </code>
        </details>
      )}
    </div>
  )
}

export function SettingFieldRow({
  field,
  state,
  onChange,
  onSave,
}: {
  field: SettingField
  state: FieldState
  onChange: (value: string) => void
  onSave: () => void
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = field.type === 'password'

  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={field.key}>{field.label}</FieldLabel>
      <div className="flex items-center gap-2">
        <div className={cn('relative', field.type === 'time' ? 'w-32 flex-none' : 'flex-1')}>
          <Input
            id={field.key}
            type={isPassword && !visible ? 'password' : field.type === 'time' ? 'time' : 'text'}
            placeholder={field.placeholder}
            value={state.value}
            onChange={(e) => onChange(e.target.value)}
            className="pr-10"
          />
          {isPassword && state.value && (
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 py-0.5 text-meta text-muted-foreground transition-colors duration-(--transition-fast) hover:text-foreground"
            >
              {visible ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={state.saving}
        >
          {state.saving ? 'Saving...' : state.saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <Meta as="p">{field.help}</Meta>
      <FailureNote failure={state.error} />
    </div>
  )
}

/** Every settings field's label, one size (text-body-strong). Pass `htmlFor`
 *  for an input, or an `id` for a group that points at it with
 *  aria-labelledby (toggle groups, switches). */
export function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label className={cn('text-body-strong', className)} {...props} />
}

export function SectionHeader({
  title,
  description,
  as = 'h2',
}: {
  title: string
  description?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <div className="space-y-1">
      <SectionTitle as={as} size="lg">{title}</SectionTitle>
      {description && (
        <p className="text-body text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

/** A section's body while brief settings load; `failed` offers a retry
 *  instead of an endless skeleton. */
export function SectionSkeleton({ failed = false, onRetry, rows = 3 }: { failed?: boolean; onRetry?: () => void; rows?: number }) {
  if (failed) {
    return (
      <div className="flex items-center gap-2">
        <Meta as="p">Couldn't load these settings.</Meta>
        {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
        <Skeleton key={i} className="h-8 w-full max-w-md" />
      ))}
    </div>
  )
}
