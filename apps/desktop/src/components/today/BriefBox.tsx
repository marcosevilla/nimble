import { SectionTitle } from '@/components/shared/typography'

/** The frame every brief container shares: one SectionTitle row (title,
 *  optional count, optional right-aligned action) over the body. Boxes never
 *  unmount for want of data — they show a calm one-line empty state. */
export function BriefBox({
  title,
  count,
  action,
  children,
}: {
  title: string
  count?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="surface-panel space-y-2 p-4">
      <SectionTitle as="h2" count={count} action={action}>
        {title}
      </SectionTitle>
      <div>{children}</div>
    </section>
  )
}
