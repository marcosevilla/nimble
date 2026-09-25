import { VaultBox } from '../VaultBox'
import type { BriefBoxProps } from '../briefModules'

export function VaultModule({ date }: BriefBoxProps) {
  return <VaultBox date={date} />
}
