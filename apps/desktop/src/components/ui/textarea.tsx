import * as React from "react"

import { cn } from "@/lib/utils"
import type { FieldVariant } from "@/components/ui/input"

/** Same two variants as `Input`: `default` boxed, `ghost` borderless with a
 * focus well. Both auto-grow via field-sizing-content. */
const TEXTAREA_VARIANTS: Record<FieldVariant, string> = {
  default:
    "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 focus-ring-inset disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  // Widened into its 8px bleed, not shifted (see Input's ghost variant).
  ghost: "field-ghost min-h-0 w-[calc(100%+1rem)] resize-none placeholder:text-muted-foreground-subtle",
}

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & { variant?: FieldVariant }) {
  return (
    <textarea
      data-slot="textarea"
      data-variant={variant}
      className={cn(
        "flex field-sizing-content text-body transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        TEXTAREA_VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
