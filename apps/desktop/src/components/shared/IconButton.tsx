import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type IconButtonSize = 'sm' | 'md' | 'lg'
type IconButtonTone = 'muted' | 'destructive' | 'subtle'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize
  tone?: IconButtonTone
}

const sizeClass: Record<IconButtonSize, string> = {
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-7',
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
        'flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent/20',
        sizeClass[size],
        toneClass[tone],
        className,
      )}
    >
      {children}
    </button>
  )
})
