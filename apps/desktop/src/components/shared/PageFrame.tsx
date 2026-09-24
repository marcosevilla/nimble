import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'

/** The one content column: centered, 960px (`max-w-page`), 24px gutter on
 *  every side. Every page, page header and detail view shares it. Use
 *  directly only where a page owns its own scroller (Docs, detail views);
 *  everything else goes through `PageFrame`. */
export const PageColumn = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function PageColumn(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('mx-auto w-full min-w-0 max-w-page px-6 py-6', className)}
      {...props}
    />
  )
})

interface PageFrameProps extends React.ComponentProps<typeof PageHeader> {
  /** Classes for the content column (spacing between blocks, etc.). */
  bodyClassName?: string
  children: React.ReactNode
}

/** One frame for every page (cross-cutting move 1): the sticky
 *  `PageHeader` band, then one centered column. Loading skeletons render
 *  through the same frame so the header never flickers in. */
export function PageFrame({ bodyClassName, children, ...header }: PageFrameProps) {
  return (
    <>
      <PageHeader {...header} />
      <PageColumn className={bodyClassName}>
        {children}
      </PageColumn>
    </>
  )
}
