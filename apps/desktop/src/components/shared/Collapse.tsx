import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

/* Height + opacity disclosure for tree children (Agentation pass 3, A3).
   Timing comes from the motion tokens in index.css (--transition-base,
   --ease-entrance), read at render so a Settings or reduced-motion change
   follows; reduced motion is instant. The body clips only while it moves —
   at rest it's overflow-visible so a child row's focus ring never clips —
   and it's inert while leaving so arrow keys skip the rows on their way out.
   Padding goes on `innerClassName`: border-box height can't shrink below
   the element's own padding, so padding on the animated box would leave a
   sliver that snaps away at the end. */

type CollapseProps = {
  open: boolean
  className?: string
  /** Wrapper inside the animated box — put padding and spacing here. */
  innerClassName?: string
  children: ReactNode
  role?: string
  'aria-label'?: string
}

function tokenTransition(reduce: boolean) {
  const root = getComputedStyle(document.documentElement)
  // The built CSS may minify "220ms" to ".22s" — honour the unit.
  const raw = root.getPropertyValue('--transition-base').trim()
  const ms = (parseFloat(raw) || 0) * (raw.endsWith('ms') ? 1 : 1000)
  const bezier = root.getPropertyValue('--ease-entrance').match(/-?[\d.]+/g)?.map(Number)
  return {
    duration: reduce ? 0 : ms / 1000,
    ease: bezier?.length === 4 ? (bezier as [number, number, number, number]) : ('easeOut' as const),
  }
}

function CollapseBody({ className, innerClassName, children, ...rest }: Omit<CollapseProps, 'open'>) {
  const reduce = useReducedMotion() ?? false
  const present = useIsPresent()
  const [moving, setMoving] = useState(false)
  return (
    <motion.div
      {...rest}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={tokenTransition(reduce)}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
      inert={!present || undefined}
      className={cn(className, (moving || !present) && 'overflow-hidden')}
    >
      {innerClassName ? <div className={innerClassName}>{children}</div> : children}
    </motion.div>
  )
}

/** Children list that animates open and closed; mounted through its exit.
 *  Extra props (role, aria-label, data-*) land on the animated element. */
export function Collapse({ open, ...body }: CollapseProps) {
  return <AnimatePresence initial={false}>{open && <CollapseBody key="body" {...body} />}</AnimatePresence>
}
