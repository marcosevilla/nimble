import type { ComponentType } from 'react'
import type { Brief, BriefLayoutEntry } from '@nimble/types'
import { WeatherModule, WeatherStrip } from './modules/WeatherModule'
import { ScheduleModule, ScheduleStrip } from './modules/ScheduleModule'
import { PrioritiesModule, PrioritiesStrip } from './modules/PrioritiesModule'
import { DueTodayBox } from './modules/DueTodayBox'
import { StillOpenModule } from './modules/StillOpenModule'
import { HabitsBox } from './modules/HabitsBox'
import { NotesBox } from './modules/NotesBox'
import { VaultModule } from './modules/VaultModule'

/** live = today, interactive · snapshot = a past morning, frozen (reads
 *  `payload` = `snapshot[id]`, and `brief`) · preview = today's live data,
 *  read-only, under draft settings (the setup). */
export type BriefMode = 'live' | 'snapshot' | 'preview'

export interface BriefBoxProps {
  mode: BriefMode
  /** The brief's own date (today for live and preview). */
  date: string
  /** Resolved options from the module's `config_schema`. */
  config: Record<string, unknown>
  payload?: unknown
  brief?: Brief | null
}

export interface BriefStripProps {
  config: Record<string, unknown>
}

/** Custom options UI; without it the Boxes list renders `config_schema`. */
export interface BriefModuleSettingsProps {
  entry: BriefLayoutEntry
  onChange: (config: Record<string, unknown>) => void
}

export interface BriefModuleView {
  Box: ComponentType<BriefBoxProps>
  /** Its compact-strip segment; modules without one stay boxes when compact. */
  Strip?: ComponentType<BriefStripProps>
  Settings?: ComponentType<BriefModuleSettingsProps>
  /** 'header': renders in the brief header row (the weather chip), never as a box. */
  slot?: 'header'
}

/** The frontend half of the module registry (Rust: nimble-core/src/brief/mod.rs).
 *  Same ids. An id missing here renders ModulePlaceholder. */
export const BRIEF_MODULES: Record<string, BriefModuleView> = {
  weather: { Box: WeatherModule, Strip: WeatherStrip, slot: 'header' },
  schedule: { Box: ScheduleModule, Strip: ScheduleStrip },
  priorities: { Box: PrioritiesModule, Strip: PrioritiesStrip },
  due_today: { Box: DueTodayBox },
  still_open: { Box: StillOpenModule },
  habits: { Box: HabitsBox },
  notes: { Box: NotesBox },
  vault: { Box: VaultModule },
}

export function briefModuleInfo(id: string): { slot?: 'header'; strip: boolean } {
  const view = BRIEF_MODULES[id]
  return { slot: view?.slot, strip: !!view?.Strip }
}
