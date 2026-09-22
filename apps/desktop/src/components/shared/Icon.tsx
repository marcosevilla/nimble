import type { LucideIcon, LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'

/* Shell icon defaults (shell audit P3-5). Lucide has no context for
   defaults, so this thin wrapper fixes what drifted across the shell:
   one stroke weight (1.75 — between 400-weight meta text and 500-weight
   body-strong) and two sizes, 14px `inline` beside text and 16px `nav`
   in the rail and toolbars. Colour comes from `className` / currentColor.
   Icons are decorative by default; the owning control carries the name. */

export type IconSize = 'inline' | 'nav'

interface IconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon
  size?: IconSize
}

export function Icon({ icon: Glyph, size = 'inline', className, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <Glyph
      aria-hidden
      strokeWidth={strokeWidth}
      className={cn(size === 'nav' ? 'size-4' : 'size-3.5', 'shrink-0', className)}
      {...props}
    />
  )
}
