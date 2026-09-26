/* User-data swatch palettes (loop 4 P2-19). Projects, goals, habits,
   calendar feeds and capture routes store a raw hex on the row and render it
   as a dot, so these are data, not UI colors — the one sanctioned hex list.
   Labels are the exception: they store a Todoist color *name* (labelColors.ts).
   Every picker names its swatches with swatchName(), never the hex. */

const SWATCH_HEX = {
  indigo: '#6366f1',
  pink: '#ec4899',
  green: '#22c55e',
  amber: '#f59e0b',
  cyan: '#06b6d4',
  rose: '#f43f5e',
  violet: '#8b5cf6',
  teal: '#14b8a6',
  red: '#ef4444',
  blue: '#3b82f6',
  orange: '#f97316',
} as const

type SwatchName = keyof typeof SWATCH_HEX
const pick = (...names: SwatchName[]): string[] => names.map((n) => SWATCH_HEX[n])

/** Each picker keeps its historical order, so stored rows and defaults are unchanged. */
export const PROJECT_COLORS = pick('indigo', 'pink', 'green', 'amber', 'cyan', 'rose', 'violet', 'teal')
export const GOAL_COLORS = pick('amber', 'red', 'green', 'blue', 'violet', 'pink', 'teal', 'orange')
export const FEED_COLORS = pick('indigo', 'pink', 'green', 'amber', 'cyan', 'rose')
export const ROUTE_COLORS = pick('amber', 'blue', 'green', 'pink', 'indigo', 'red', 'cyan')

/** Fallback when a project has no stored color — the same indigo the label
 * importer uses, so an unset project and an unknown label look alike. */
export const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[0]

const NAME_BY_HEX = new Map<string, string>(
  Object.entries(SWATCH_HEX).map(([name, hex]) => [hex, name[0].toUpperCase() + name.slice(1)]),
)

/** "Indigo" for '#6366f1' — the accessible name of a swatch button. An
 *  unknown hex (a color from an import) falls back to the hex itself. */
export function swatchName(hex: string): string {
  return NAME_BY_HEX.get(hex.toLowerCase()) ?? hex
}
