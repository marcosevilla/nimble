// Todoist-style named colors for labels.
//
// `nimble-core`'s `labels` table stores a color *name* (e.g. "orange",
// "gray" — see `db::labels::get_or_create_label_by_name`'s literal
// `'gray'` default), not a hex value, mirroring how Todoist itself names
// project/label colors. This map is the frontend mirror of the hex table
// in `nimble-core/src/api/todoist_migration.rs::todoist_color_to_hex` —
// keep the two in sync if either changes so a label's color resolves to
// the same swatch everywhere.
//
// Native project colors (`ProjectSidebar`/`ProjectEditDialog`) are a
// separate, unrelated scheme: those store raw hex strings directly rather
// than named colors, so there's no existing name->hex map to reuse for
// labels — this file is that map's first home in the TS codebase.
const LABEL_COLOR_HEX: Record<string, string> = {
  berry_red: '#b8255f',
  red: '#db4035',
  orange: '#ff9933',
  yellow: '#fad000',
  olive_green: '#afb83b',
  lime_green: '#7ecc49',
  green: '#299438',
  mint_green: '#6accbc',
  teal: '#158fad',
  sky_blue: '#14aaf5',
  light_blue: '#96c3eb',
  blue: '#4073ff',
  grape: '#884dff',
  violet: '#af38eb',
  lavender: '#eb96eb',
  magenta: '#e05194',
  salmon: '#ff8d85',
  charcoal: '#808080',
  // Rust's map only has "grey"; `get_or_create_label_by_name` writes the
  // US spelling ("gray") as its default, so both keys are covered here to
  // avoid falling through to DEFAULT_HEX for that common case.
  grey: '#b8b8b8',
  gray: '#b8b8b8',
  taupe: '#ccac93',
}

const DEFAULT_HEX = '#6366f1'

/** Resolves a stored label color name to its hex swatch. Unknown/legacy
 * names fall back to the same indigo default the Rust importer uses. */
export function labelColor(name: string): string {
  return LABEL_COLOR_HEX[name] ?? DEFAULT_HEX
}

/** Curated subset of the full palette for color pickers — enough variety
 * without overwhelming a small swatch grid. */
export const LABEL_COLOR_OPTIONS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'grape',
  'violet',
  'magenta',
  'gray',
] as const

/** Matches the backend's own default for newly-minted labels
 * (`get_or_create_label_by_name`), so labels created from the UI's
 * "no match, create it" flow land on the same default as ones created by
 * Todoist sync. */
export const DEFAULT_LABEL_COLOR = 'gray'
