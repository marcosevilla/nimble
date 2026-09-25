import { BRIEF_MODULES, type BriefBoxProps, type BriefStripProps } from './briefModules'
import { ModulePlaceholder } from './ModulePlaceholder'

/** One module's box by id; an unknown id renders the neutral placeholder. */
export function ModuleBox({ id, ...props }: BriefBoxProps & { id: string }) {
  const Box = BRIEF_MODULES[id]?.Box ?? ModulePlaceholder
  return <Box {...props} />
}

/** One module's compact-strip segment, or nothing. */
export function ModuleStrip({ id, config }: BriefStripProps & { id: string }) {
  const Strip = BRIEF_MODULES[id]?.Strip
  return Strip ? <Strip config={config} /> : null
}
