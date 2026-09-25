import { Meta } from '@/components/shared/typography'
import { BriefBox } from './BriefBox'

/** A box this build doesn't know: a newer Mac version wrote the layout, or
 *  the web client can't render it (addendum §1). */
export function ModulePlaceholder() {
  return (
    <BriefBox title="More in Nimble">
      <Meta as="p">Open in Nimble for Mac to see this box.</Meta>
    </BriefBox>
  )
}
