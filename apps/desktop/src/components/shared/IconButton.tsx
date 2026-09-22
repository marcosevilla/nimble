import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type IconButtonSize = 'sm' | 'md' | 'lg'
type IconButtonTone = 'muted' | 'destructive' | 'subtle'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize
  tone?: IconButtonTone
}

// Visible box + a 40px-tall hit target via `after:` (make-interfaces
// "minimum hit area"). `inset-x-0` gives the pseudo the button's width (a
// vertical-only inset left it 0px wide, so it added nothing); the horizontal
// axis does not grow because icon buttons sit in gap-0.5 toolbars where a
// wider target would overlap its neighbour.
const sizeClass: Record<IconButtonSize, string> = {
  sm: 'size-5 after:inset-x-0 after:-inset-y-2.5',
  md: 'size-6 after:inset-x-0 after:-inset-y-2',
  lg: 'size-7 after:inset-x-0 after:-inset-y-1.5',
}

const toneClass: Record<IconButtonTone, string> = {
  muted: 'text-muted-foreground hover:text-foreground',
  destructive: 'text-destructive/40 hover:text-destructive',
  subtle: 'text-muted-foreground hover:text-foreground',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', tone = 'muted', className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      className={cn(
        // hover: --hover token, >=1.15:1 on every surface (accent/20 was 1.02:1);
        // focus-visible:opacity-100 so a reveal-on-hover button (opacity-0
        // group-hover:opacity-100) is visible once Tab lands on it (settings P1-3).
        'relative flex shrink-0 items-center justify-center rounded-md transition-colors duration-(--transition-fast) hover:bg-hover focus-visible:opacity-100 after:absolute',
        sizeClass[size],
        toneClass[tone],
        className,
      )}
    >
      {children}
    </button>
  )
})
