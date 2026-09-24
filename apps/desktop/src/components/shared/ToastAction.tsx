import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A sonner toast's action button that Tab reaches in WebKit: sonner's own
 * `action: { label, onClick }` renders a tabindex-less <button>, which the
 * app's WKWebView skips on Tab. Dressed like sonner's action button
 * (inverted popover colours, 24px, 12px/500) with the app's focus ring. */
export function ToastAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={0}
      onClick={onClick}
      className={cn(
        'focus-ring ml-auto flex h-6 shrink-0 cursor-pointer items-center rounded-sm px-2',
        'bg-popover-foreground text-meta-strong text-popover transition-opacity duration-(--transition-fast) hover:opacity-90',
      )}
    >
      {children}
    </button>
  )
}
