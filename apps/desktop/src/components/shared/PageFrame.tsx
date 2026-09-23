import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'

type PageWidth = 'default' | 'wide'

const WIDTH_CLASS: Record<PageWidth, string> = {
  default: 'max-w-page', // 640
  wide: 'max-w-page-wide', // 768 — Settings and the document editor only
}

interface PageColumnProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: PageWidth
}

/** The one content column: centered, 640px (768 `wide`), 24px gutter on
 *  every side. Use directly only where a page owns its own scroller (Docs);
 *  everything else goes through `PageFrame`. */
export const PageColumn = forwardRef<HTMLDivElement, PageColumnProps>(function PageColumn(
  { width = 'default', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('mx-auto w-full min-w-0 px-6 py-6', WIDTH_CLASS[width], className)}
      {...props}
    />
  )
})

interface PageFrameProps extends React.ComponentProps<typeof PageHeader> {
  width?: PageWidth
  /** Classes for the content column (spacing between blocks, etc.). */
  bodyClassName?: string
  children: React.ReactNode
}

/** One frame for every page (cross-cutting move 1): the sticky
 *  `PageHeader` band, then one centered column. Loading skeletons render
 *  through the same frame so the header never flickers in. */
export function PageFrame({ width, bodyClassName, children, ...header }: PageFrameProps) {
  return (
    <>
      <PageHeader width={width ?? 'default'} {...header} />
      <PageColumn width={width} className={bodyClassName}>
        {children}
      </PageColumn>
    </>
  )
}
