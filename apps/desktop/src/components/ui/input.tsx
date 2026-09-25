import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/** `default` — the boxed field (border, inset focus ring).
 * `ghost` — borderless document-text field; focus shows a filled well
 * (`.field-ghost` in index.css). Pick one; don't strip the box by hand. */
export type FieldVariant = "default" | "ghost"

const INPUT_VARIANTS: Record<FieldVariant, string> = {
  default:
    "h-8 w-full rounded-lg border border-input bg-card shadow-xs px-2.5 py-1 focus-ring-inset disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  // The well bleeds 8px each side (-mx-2 in .field-ghost), so the box is
  // 1rem wider than the column: widened, not shifted.
  ghost: "field-ghost w-[calc(100%+1rem)] placeholder:text-muted-foreground-subtle",
}

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & { variant?: FieldVariant }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-variant={variant}
      className={cn(
        "min-w-0 text-body transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        INPUT_VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
}

export { Input }
